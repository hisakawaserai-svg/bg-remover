/**
 * PolygonEditor — 「四角タップ追加 → ハンドルで多角形に変形」方式。
 *
 * 画面レイアウト:
 *   上部: 画像キャンバス (flex:1)
 *   下部: 固定バー (~60px) ← undo/redo・モード・削除・書き出し
 *
 * appMode:
 *   'draw'  … 画像タップで四角を追加
 *   'move'  … ピンチズーム・パン。選択中ならハンドル操作
 *
 * ハンドル操作 (move モード):
 *   - ハンドルをドラッグ → 頂点移動
 *   - 辺をタップ       → 辺の中点に頂点追加
 *   - ハンドルを長押し → 頂点削除（最低3頂点）
 */
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  Easing,
  ReduceMotion,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ToolHint, { TOOL_ICONS } from './ui/ToolHint';
import { useT } from '../i18n';
import type { TKey } from '../i18n';
import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import Slider from '@react-native-community/slider';
import ImageZoomModal from './ui/ImageZoomModal';
import TouchLoupe, { LOUPE_SIZE, DOCK_COMPACT_SIZE, DOCK_DOCKED_SIZE } from './ui/TouchLoupe';
import type { DockLevel } from './ui/TouchLoupe';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {
  Canvas,
  Image as SkiaImage,
  Path,
  Circle,
  Group,
  Rect,     // 下地レイヤーの単色塗り・市松に使用
  ImageShader,
  FilterMode,
  MipmapMode,
  Skia,
  ColorType,
  AlphaType,
} from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import type { RemoveBgResult, BBox } from '../imaging';
import { splitConnected, isTransparentAt, findUncoveredRegions, initialRectFromBBox, thinStroke } from '../imaging';
import type { UncoveredRegion } from '../imaging';
import { useThumbBg } from '../hooks/useThumbBg';
import type { ThumbBg } from '../settings/store';
import { useSettings } from '../settings/SettingsContext';
// イラスト輪郭切り抜きでは直線スナップの利得が小さく点が飛ぶ副作用が大きいため除去した。

// ── 定数 ───────────────────────────────────────────────────────────────────

/** 四角の初期サイズ: 画像短辺の何割か */
const RECT_RATIO     = 0.30;
const ZOOM_MIN       = 1;
/**
 * 最大倍率。復元ブラシで1px単位を直すには 12 倍でも足りないため 24 倍まで上げた。
 * 32倍以上は画素が大きくなりすぎて指での位置合わせと移動がかえって難しくなる。
 *
 * 倍率は描画の変換行列を変えるだけなので、上げても描画コストは増えない
 * （画像テクスチャは同じものを使い回す）。
 */
const ZOOM_MAX       = 24;
/** 倍率プリセット。スライダーの目盛りと、離した時の吸い付き先を兼ねる。 */
const ZOOM_PRESETS   = [1, 2, 4, 8, 16, 24] as const;

/**
 * 倍率 ↔ スライダー位置(0〜1) の変換。
 *
 * 線形に並べると、実用上いちばん使う ×1〜×4 がトラックの左 1/4 に潰れてしまう。
 * 対数にすると ×1→×2→×4→×8 が等間隔になり、どの倍率帯でも同じ感覚で動かせる。
 */
const zoomToSlider = (scale: number) =>
  Math.log2(scale / ZOOM_MIN) / Math.log2(ZOOM_MAX / ZOOM_MIN);
const sliderToZoom = (v: number) =>
  ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v);
/** 目盛りにこの距離（スライダー位置の単位）まで近ければ、指を離した時に吸い付く。 */
const ZOOM_SNAP_R    = 0.035;
// キャンバスの余白（表示px）。画像が枠にぴったり付いて窮屈だったので全体的に広げた。
// 上は下地切替(市松/白/黒)のセグメント、右はフローティングボタン、
// 下はツール説明のピルが乗るので、その分も見込んで確保する。
const PAD_L = 32; // 左余白
const PAD_R = 76; // 右余白（フローティングボタン分を含む）
const PAD_T = 56; // 上余白（下地切替セグメントの下）
const PAD_B = 56; // 下余白（ツール説明ピルの上）
const PAN_THRESHOLD  = 8;          // この距離(表示px)を超えたらパンとみなす
const VERTEX_HIT_PX  = 20;         // 頂点ヒット判定半径(表示px, 等倍時)
const EDGE_HIT_PX    = 15;         // 辺ヒット判定距離(表示px, 等倍時)
/**
 * ヒット判定半径の倍率補正。
 *
 * しきい値は表示px固定なので、拡大するほど「画像上で指せる範囲」が実質狭くなり、
 * せっかく拡大したのに頂点を掴みづらくなる。かといって倍率に正比例で広げると
 * 高倍率で隣の頂点まで拾ってしまう。平方根で緩やかに縮めて折り合いをつける。
 */
const hitRadius = (basePx: number, scale: number) => basePx / Math.sqrt(scale);
const LONG_PRESS_MS  = 500;        // 長押し判定時間(ms)

// ── 型 ─────────────────────────────────────────────────────────────────────

export type Polygon = { id: number; points: [number, number][] };
/** 現在のツールの説明。キャンバス下端に常時出して、何ができるかを示す。 */
// 文言そのものではなく i18n のキーを持つ。モジュール定数なのでここで t() を呼ぶと
// 初期化時の言語で固定され、設定から言語を変えてもヒントだけ変わらなくなる。
const TOOL_HINTS: Record<AppMode, { icon: string; titleKey: TKey; descKey: TKey }> = {
  move:       { icon: TOOL_ICONS.move,       titleKey: 'editor.modeMove',       descKey: 'editor.modeMoveHint' },
  draw:       { icon: TOOL_ICONS.draw,       titleKey: 'editor.modeAdd',        descKey: 'editor.modeAddHint' },
  eyedropper: { icon: TOOL_ICONS.eyedropper, titleKey: 'editor.modeEyedropper', descKey: 'editor.modeEyedropperHint' },
  restore: { icon: 'healing', titleKey: 'editor.modeRestore', descKey: 'editor.modeRestoreHint' },
};

/**
 * 復元ブラシの太さ（画像px・直径）。
 *
 * 髪の毛・目・線の一部・文字の細い部分は数px単位で直したいので、
 * 段階ではなく連続値にしてある。値は「画像の実ピクセル数」で、表示倍率とは
 * 無関係（拡大しても同じ太さぶんだけ復元される）。
 */
const BRUSH_MIN_PX = 1;
const BRUSH_MAX_PX = 80;
const BRUSH_DEFAULT_PX = 8;
/** 元画像の透かしの濃さ。濃すぎると現在の結果が読めなくなる。 */
const GHOST_OPACITY = 0.4;

/** 下地ごとのアイコン。現在の下地を1つのボタンで示すために使う。 */
// 'gray' は廃止済みだが型(ThumbBg)には残っているので、念のため入れておく。
const BG_ICONS: Record<string, string> = {
  checker: 'grid-on',
  white: 'wb-sunny',
  black: 'brightness-2',
  gray: 'grid-on',
};

/** フィードバックの表示時間(ms)。 */
const TOAST_MS = 1600;

/** タップ波紋のアニメ時間(ms)。処理がこれより速くても、この間は波紋を残す。 */
const RIPPLE_MS = 420;

/** スポイトのタップ波紋の半径(px)。 */
const EYE_RIPPLE_R = 26;

/** 実寸レティクル印の半径(px)。ドラッグして掴む対象なので指で見える大きさにする。 */
const MAIN_RETICLE_R = 22;
/** 実寸レティクルの十字1本の長さ・太さ(px)。 */
const MR_ARM = 12;
const MR_TH = 4;

/** eyedropper = スポイト: タップした色を透過させる（ポリゴンは操作しない） */
type AppMode = 'draw' | 'move' | 'eyedropper' | 'restore';

/**
 * undo/redo の履歴エントリ。
 * ポリゴン形状の巻き戻しと、スポイトによる画像の巻き戻しを1本のスタックで扱う
 * （undo ボタンが目の前にあるのにスポイトだけ戻らない、という状態を避けるため）。
 */
type HistEntry =
  // 画像編集(スポイト)は親が「元画像 + 操作列」で管理しているので、ここには
  // 「この位置で画像編集が入った」という印だけを残し、取り消しは親へ委譲する。
  // こうするとポリゴン操作と画像編集が混ざっても、押した順どおりに戻せる。
  | { kind: 'polygons'; polygons: Polygon[] }
  | { kind: 'edit' };
/** ジェスチャーの内部フェーズ */
type GesPhase =
  | 'idle'
  | 'pending'      // タップか動きか判定中
  | 'pan'
  | 'pinch'
  | 'drag_vertex'  // 頂点ドラッグ中
  | 'drag_poly'    // ポリゴン全体移動中
  | 'drag_edge'    // 辺の両端頂点を同時移動中
  | 'restore';     // 復元ブラシでなぞり中

interface ZoomState { scale: number; tx: number; ty: number }

interface Props {
  bgResult: RemoveBgResult;
  displayW: number;
  displayH: number;
  /** ポリゴン確定後にプレビュー画面へ遷移。現在の polygons を渡す */
  onPreview: (polygons: Polygon[]) => void;
  /**
   * 戻るボタン押下時に呼ばれる。現在の polygons を渡すことで、
   * 離脱直前の最終状態を呼び出し元で保存できる。
   */
  onBack: (currentPolygons: Polygon[]) => void;
  /**
   * セッション復元時に渡す初期ポリゴン。
   * 座標は画像ピクセル基準で保存されており、ここでは変換せずそのまま初期値にする。
   * PolygonEditor 内部は画像ピクセル座標系で polygons を管理し、
   * 表示時に ds・zoom を掛けて表示座標へ変換しているため変換不要。
   * 省略した場合は空配列（= 四角い初期範囲からスタート）。
   */
  initialPolygons?: Polygon[];
  /**
   * 頂点追加・削除・ドラッグ終了など「形が確定した」タイミングで呼ばれる。
   * 毎フレームではなく操作の確定時のみ発火するため、セッション保存の頻度を抑えられる。
   * 省略した場合は何も呼ばれない（後方互換）。
   */
  onPolygonsChange?: (polys: Polygon[]) => void;
  /**
   * 画像編集は「元画像 + 操作列」を呼び出し側が持ち、この画面は操作を通知するだけ。
   * bgVersion は作り直しの通知（rgba は同一参照のまま中身が変わるため）。
   */
  onEyedrop?: (x: number, y: number, tolerance: number, feather: boolean) => void;
  onUndoEdit?: () => void;
  onRedoEdit?: () => void;
  onResetEdits?: () => void;
  /**
   * 「透過強度」を変えてこのセルを作り直す。渡された画面でだけ UI を出す。
   * 実処理は親が持つ（元画像を持っているのは親のため）。
   */
  onRetransparent?: (tolerance: number) => void;
  /**
   * 復元ブラシの1ストローク。座標はこのエディタが表示している画像の座標系。
   * 元画像基準への変換（セル編集の bbox 加算）は親が行う。
   */
  onRestore?: (points: Array<[number, number]>, radius: number) => void;
  /**
   * 元画像（透過前）の画素。bgResult と同じ寸法であること。
   * 復元ブラシで「どこが消えたか」を透かして見せるために使う。
   */
  baseRgba?: Uint8Array | null;
  /** 透過強度スライダーの初期値。onRetransparent とセットで渡す。 */
  cellTolerance?: number;
  canUndoEdit?: boolean;
  canRedoEdit?: boolean;
  bgVersion?: number;
  /** 設定画面へ遷移。省略可（ヘッダーに設定アイコンを出さない）。 */
  onSettings?: () => void;
  /** ホームへ戻る。省略可（ヘッダーにホームアイコンを出さない）。 */
  onHome?: () => void;
  /** ヘッダーの「元画像」ズーム用 URI。分割結果とヘッダーを揃える。 */
  originalImageUri?: string;
}

// ── ポリゴン色 ──────────────────────────────────────────────────────────────

const POLY_COLORS = [
  { fill: 'rgba(244,67,54,0.25)',  border: '#F44336' },
  { fill: 'rgba(33,150,243,0.25)', border: '#2196F3' },
  { fill: 'rgba(76,175,80,0.25)',  border: '#4CAF50' },
  { fill: 'rgba(255,152,0,0.25)',  border: '#FF9800' },
  { fill: 'rgba(156,39,176,0.25)', border: '#9C27B0' },
  { fill: 'rgba(0,188,212,0.25)',  border: '#00BCD4' },
  { fill: 'rgba(233,30,99,0.25)',  border: '#E91E63' },
  { fill: 'rgba(121,85,72,0.25)',  border: '#795548' },
];

// ── ヘルパー ────────────────────────────────────────────────────────────────

function touchDist(
  t1: { pageX: number; pageY: number },
  t2: { pageX: number; pageY: number },
): number {
  return Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
}

function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length;
  const [sx, sy] = pts.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / n, sy / n];
}

/** レイキャスティング法 */
function pointInPoly(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * パン範囲クランプ。natW/natH = scale=1 時の画像表示サイズ (imageW*ds, imageH*ds)。
 * 画像が PAD 余白内に収まる場合は中央固定、はみ出す場合はパン可能。
 *
 * centerReticle=true（レティクルを画面中央に固定するモード）では条件が変わる。
 * 通常のクランプは「画像を画面いっぱいに保つ」ことを狙っているが、それだと
 * 画像の端が画面中央まで来られず、端や角のドットを永久に狙えなくなる。
 * そこで「画面中央が画像の内側にある」ことだけを条件にし、外側に画面半分ぶんの
 * 余白を許す。角を狙う時は画面の大半が空くが、それが端を狙えることの対価になる。
 */
function clampZoom(
  z: ZoomState, dW: number, dH: number, natW: number, natH: number,
  centerReticle = false,
): ZoomState {
  const imgW   = natW * z.scale;
  const imgH   = natH * z.scale;

  if (centerReticle) {
    const cx = dW / 2;
    const cy = dH / 2;
    // 「端がセンターに来る」位置ちょうどを上限/下限にすると窮屈なので、
    // 画面2枚分ぶんの余白を追加で許す（1枚分でもまだ狭いというフィード
    // バックを受けてさらに広げた）。
    const marginX = dW * 2;
    const marginY = dH * 2;
    return {
      scale: z.scale,
      tx: Math.max(cx - imgW - marginX, Math.min(cx + marginX, z.tx)),
      ty: Math.max(cy - imgH - marginY, Math.min(cy + marginY, z.ty)),
    };
  }

  const availW = dW - PAD_L - PAD_R;
  const availH = dH - PAD_T - PAD_B;
  // 「画像を画面いっぱいに保つ」自然な範囲（従来の全範囲）に、
  // 画面2枚分ぶんの余白を追加で許す。以前は画像が画面に収まる倍率だと
  // 一切パンできず（常に中央固定）、動かせる範囲が狭いという声があったため、
  // reticleFixed と同じ余白の考え方をここにも適用する（1枚分でもまだ
  // 狭いというフィードバックを受けてさらに広げた）。
  const marginW = dW * 2;
  const marginH = dH * 2;
  const naturalMinTx = imgW <= availW ? PAD_L + (availW - imgW) / 2 : PAD_L - (imgW - availW);
  const naturalMaxTx = imgW <= availW ? PAD_L + (availW - imgW) / 2 : PAD_L;
  const naturalMinTy = imgH <= availH ? PAD_T + (availH - imgH) / 2 : PAD_T - (imgH - availH);
  const naturalMaxTy = imgH <= availH ? PAD_T + (availH - imgH) / 2 : PAD_T;
  const tx = Math.max(naturalMinTx - marginW, Math.min(naturalMaxTx + marginW, z.tx));
  const ty = Math.max(naturalMinTy - marginH, Math.min(naturalMaxTy + marginH, z.ty));
  return { scale: z.scale, tx, ty };
}

/**
 * 「画面にぴったり収まる中央位置」を余白なしで直接返す。
 * clampZoom は（意図的に）中央から画面1枚分ずれていてもクランプを通す
 * ようにしてあるため、初期表示や「全体表示」ボタンのように必ず中央へ
 * 戻したい場面では clampZoom を経由せず、これを直接使う。
 */
function centerFit(scale: number, dW: number, dH: number, natW: number, natH: number): ZoomState {
  const availW = dW - PAD_L - PAD_R;
  const availH = dH - PAD_T - PAD_B;
  const imgW = natW * scale;
  const imgH = natH * scale;
  const tx = imgW <= availW ? PAD_L + (availW - imgW) / 2 : PAD_L - (imgW - availW) / 2;
  const ty = imgH <= availH ? PAD_T + (availH - imgH) / 2 : PAD_T - (imgH - availH) / 2;
  return { scale, tx, ty };
}

/**
 * 点 p から線分 ab への最短距離(表示px)。
 * ab は表示座標系の点。
 */
function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 選択中ポリゴンの頂点ハンドル。位置(cx/cy)を zoomSV から直接(UIスレッドで)
 * 計算するようにしたコンポーネント。
 *
 * 以前は毎回 zoom（React state, コミット時にしか更新されない）から位置を
 * 計算していたため、パン中は塗り・輪郭（Group 内、zoomSV 駆動）が
 * なめらかに動く一方でハンドルの丸だけが取り残され、指を離した瞬間に
 * 追いついて見える不具合があった（「丸が画面を動かした時についてくる」）。
 * ハンドル自体は Group の外に置いている（常に一定の画面px サイズを保つため、
 * ズームで大きくなりすぎたり小さくなりすぎたりしないようにしてある）ので、
 * ここだけ個別に zoomSV から cx/cy を作る。
 */
function VertexHandle({
  px, py, ds, zoomSV, selected,
}: {
  px: number; py: number; ds: number; zoomSV: SharedValue<ZoomState>; selected: boolean;
}) {
  const cxSV = useDerivedValue(() => px * ds * zoomSV.value.scale + zoomSV.value.tx, [px, ds, zoomSV]);
  const cySV = useDerivedValue(() => py * ds * zoomSV.value.scale + zoomSV.value.ty, [py, ds, zoomSV]);
  return (
    <>
      <Circle cx={cxSV} cy={cySV} r={13} color="rgba(255,255,255,0.12)" />
      <Circle cx={cxSV} cy={cySV} r={8} color="#FFFFFF" />
      <Circle cx={cxSV} cy={cySV} r={8}
        color={selected ? IOS.red : 'rgba(0,0,0,0.25)'}
        style="stroke" strokeWidth={selected ? 2.5 : 1} />
    </>
  );
}

/**
 * ポリゴン連番バッジ。VertexHandle と同じ理由で、位置を zoomSV から
 * 直接(UIスレッドで)計算する。こちらは Skia ではなく通常の RN View
 * （番号を文字で出すため）なので Animated.View + useAnimatedStyle を使う。
 */
function PolyBadge({
  cxImg, cyImg, ds, zoomSV, selected, label,
}: {
  cxImg: number; cyImg: number; ds: number; zoomSV: SharedValue<ZoomState>;
  selected: boolean; label: number;
}) {
  const style = useAnimatedStyle(() => ({
    left: cxImg * ds * zoomSV.value.scale + zoomSV.value.tx - 13,
    top:  cyImg * ds * zoomSV.value.scale + zoomSV.value.ty - 13,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.badge, selected && styles.badgeSelected, style]}>
      <Text style={[styles.badgeTxt, selected && { color: '#FFF' }]}>{label}</Text>
    </Animated.View>
  );
}

// ── コンポーネント ──────────────────────────────────────────────────────────

export default function PolygonEditor({ bgResult, displayW, displayH, onPreview, onBack, initialPolygons, onPolygonsChange, onEyedrop, onUndoEdit, onRedoEdit, onResetEdits, onRetransparent, onRestore, baseRgba, cellTolerance, canUndoEdit, canRedoEdit, bgVersion = 0, onSettings, onHome, originalImageUri }: Props) {
  const { t } = useT();

  const { settings } = useSettings();


  // ── SkImage ──────────────────────────────────────────────────────────────
  const skImage = useMemo<SkImage | null>(() => {
    const { rgba, width, height } = bgResult;
    const data = Skia.Data.fromBytes(rgba);
    return Skia.Image.MakeImage(
      { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      data, width * 4,
    );
    // bgVersion: 親が rgba の中身を作り直したときに作り直すための依存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgResult, bgVersion]);

  /**
   * 元画像の SkImage。復元ブラシ中に下へ薄く敷いて、消えた部分を透かす。
   * 透過結果には「元々そこに何があったか」が残っていないので、これが無いと
   * どこを塗ればよいのか当てずっぽうになる。
   */
  const ghostImage = useMemo<SkImage | null>(() => {
    if (!baseRgba) return null;
    const data = Skia.Data.fromBytes(baseRgba);
    return Skia.Image.MakeImage(
      {
        width: bgResult.width,
        height: bgResult.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      data,
      bgResult.width * 4,
    );
  }, [baseRgba, bgResult.width, bgResult.height]);
  useEffect(() => {
    return () => { ghostImage?.dispose(); };
  }, [ghostImage]);

  // スポイトを押すたびに SkImage が作り直されるので、古い方を解放する。
  // cleanup は「新しい skImage で描画がコミットされた後」に走るため、
  // 画面に出ている画像を解放してしまう心配はない。
  useEffect(() => {
    return () => { skImage?.dispose(); };
  }, [skImage]);

  // 実測キャンバスサイズ (onLayout で確定するまで 0 のまま)
  // 0 の間は Canvas を描画しない（初回レンダーのズレを防ぐ）
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  // ヘッダー「元画像」ズームモーダルの表示状態（分割結果と同挙動）
  const [zoomVisible, setZoomVisible] = useState(false);
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  // ── キャンバス下地モード ────────────────────────────────────────────────────
  // ※ この下地は編集中の視認性改善のみ。画像データ・保存結果には一切影響しない。
  //
  // 市松（checker）: 透明部分を明暗チェックで表現。明暗どちらの被写体も視認しやすい。
  //   実装: Skia の Rect を 2 色交互に TILE_SIZE グリッドで敷き詰める。
  //   依存追加なし（既存 Skia で完結）。
  // 白・グレー・黒: Rect 1 枚で単色塗り。
  //
  // 初期値はアプリ設定（サムネ背景）を既定とする。マウント時に1回だけ読み、
  // 以降は画面内のセグメント切替（setBgMode）でローカルに上書きできる（永続化しない）。
  // BgMode は設定の ThumbBg と同じ4種なので、設定値をそのまま初期値に使える。
  type BgMode = ThumbBg;
  const defaultBgMode = useThumbBg();
  const [bgMode, setBgMode] = useState<BgMode>(defaultBgMode);

  // 表示スケール: PAD 余白を除いた利用可能エリアに画像を収める
  // canvasSize が未確定(0)のときは 0 にして描画をスキップ
  const ds = canvasSize.w > 0
    ? Math.min(
        (canvasSize.w - PAD_L - PAD_R) / bgResult.width,
        (canvasSize.h - PAD_T - PAD_B) / bgResult.height,
      )
    : 0;

  // ── 状態 ─────────────────────────────────────────────────────────────────
  const [appMode,    setAppMode]    = useState<AppMode>('move');
  // zoom は onLayout で実測サイズが確定してから clampZoom で正しく設定される
  const [zoom,       setZoom]       = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 });
  // ズームスライダーのつまみ位置(0〜1)。ドラッグ中は指の位置を正として持ち、
  // ピンチや [＋]/[−]・全体表示で倍率が変わった時だけ倍率側から同期する
  // （両方向に無条件で同期すると、ドラッグ中につまみが指から離れて震える）。
  const [sliderV, setSliderV] = useState(0);
  const zoomDraggingRef = useRef(false);
  // スポイト処理中フラグ。ref(eyeBusyRef) は連打の門番、こちらは画面表示用。
  // 実処理は同期的に JS を止めるため、先にこれを true にして描画を1フレーム
  // 走らせてから処理へ入る（そうしないと表示が出ないまま固まる）。
  const [eyeBusy, setEyeBusy] = useState(false);
  /** 処理中オーバーレイの文言キー。処理の種類で出し分ける。 */
  const [busyKey, setBusyKey] = useState<'editor.eyedropBusy' | 'editor.undoBusy' | 'editor.redoBusy'>('editor.eyedropBusy');
  // 透過強度。親から初期値をもらい、以後はこの画面で持つ。
  const [cellTol, setCellTol] = useState(cellTolerance ?? settings.tolerance);
  // 透過強度パネルは既定で畳んでおく。開きっぱなしだと画像の上側を覆って
  // そこを編集できなくなるため、必要な時だけ開く。
  const [retransOpen, setRetransOpen] = useState(false);
  // 下部のツール説明・ズームバーごと、重なるものを一時的に全部隠す。
  // 画像の端を直したい時に「どかす手段」が無いと詰むので用意する。
  const [chromeHidden, setChromeHidden] = useState(false);
  // 復元ブラシの太さ（BRUSH_SIZES の添字）と、なぞっている最中の軌跡（表示座標）。
  const [brushPx, setBrushPx] = useState(BRUSH_DEFAULT_PX);
  // スポイトの許容値。設定画面まで行かずに、その場で強弱を変えられるようにする。
  const [eyeTol, setEyeTol] = useState(settings.eyedropperTolerance);
  // 元画像の透かし表示。復元ブラシでは既定 ON（消えた場所が見えないと塗れない）。
  const [ghostOn, setGhostOn] = useState(true);
  // ツールメニューの開閉。常時6個並べると編集領域を食うので、普段は
  // 選択中の1個だけを出し、押した時だけ下へ展開する。
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  // 下地の選択を開いているか。普段は現在の下地のアイコン1つだけ出す。
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  /**
   * 一言フィードバック。
   *
   * スポイトは「押したのに何も起きない」ことがある（既に透明な場所を叩いた等）。
   * 黙って無視すると壊れているのか区別できないので、結果を必ず言葉で返す。
   */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);
  // なぞり中の軌跡。必ず「画像座標」で持つ。表示座標で持つと、ズームや
  // パンを動かした瞬間に古い座標のまま描かれ、見当違いの場所（左上など）に
  // 円が出る。画像座標なら Canvas の変換がそのまま効くのでズレようがない。
  const [strokePts, setStrokePts] = useState<Array<[number, number]>>([]);
  const strokeImgRef = useRef<Array<[number, number]>>([]);
  // ドラッグ中の再描画を1フレーム1回に間引く（毎イベント setState すると重い）。
  const strokeRafRef = useRef<number | null>(null);
  const flushStroke = useCallback(() => {
    if (strokeRafRef.current != null) return;
    strokeRafRef.current = requestAnimationFrame(() => {
      strokeRafRef.current = null;
      setStrokePts([...strokeImgRef.current]);
    });
  }, []);
  // ブラシサイズ調整中の目安表示。画面中央に実寸の円を出す。
  const [brushSliding, setBrushSliding] = useState(false);
  /**
   * スライダー等のUIを操作中かどうか。
   *
   * キャンバスの PanResponder は onMoveShouldSetPanResponder で「8px以上動いたら
   * 自分が取る」としているため、スライダーをドラッグすると途中でタッチを奪って
   * しまう。奪った瞬間の座標はスライダー基準の小さい値なので、画像の左上あたりに
   * ブラシの線が出ていた。UI操作中はキャンバス側が一切反応しないようにする。
   */
  const uiInteractingRef = useRef(false);

  /**
   * ルーペの表示位置。指で隠れている編集位置を隅で拡大表示するために使う。
   * 3ツール共通で、ドラッグ中だけ出して離したら消す。
   * 画像座標で持つのは軌跡と同じ理由（表示座標だとズーム変更でズレる）。
   */
  const [loupe, setLoupe] = useState<{
    img: { x: number; y: number };
    touch: { x: number; y: number };
  } | null>(null);
  const loupeRafRef = useRef<number | null>(null);
  const loupePendingRef = useRef<typeof loupe>(null);
  /** タッチ位置(表示座標)からルーペを更新する。毎イベント setState しない。 */
  const showLoupe = useCallback((lx: number, ly: number) => {
    const z = zoomRef.current;
    const { x, y } = localToImage(lx, ly, z);
    loupePendingRef.current = { img: { x, y }, touch: { x: lx, y: ly } };
    if (loupeRafRef.current != null) return;
    loupeRafRef.current = requestAnimationFrame(() => {
      loupeRafRef.current = null;
      setLoupe(loupePendingRef.current);
    });
  }, []);
  const hideLoupe = useCallback(() => {
    loupePendingRef.current = null;
    if (loupeRafRef.current != null) {
      cancelAnimationFrame(loupeRafRef.current);
      loupeRafRef.current = null;
    }
    setLoupe(null);
  }, []);

  /** キャンバス中央の表示座標。レティクル固定モードでは「狙っている点」そのもの。 */
  const canvasCenter = () => {
    const cw = canvasSizeRef.current.w;
    const ch = canvasSizeRef.current.h;
    return cw > 0 && ch > 0 ? { x: cw / 2, y: ch / 2 } : null;
  };

  /**
   * レティクルを画面中央に固定して狙うモードか。
   *
   * 'adjust' 設定のうち「点を狙う」ツール（スポイト・四角を追加）と
   * 復元ブラシが対象。復元ブラシは指でなぞる代わりに、中央固定のまま
   * パンして軌跡を作り、決定ボタンで書き始め／書き終わりを切り替える方式
   * （toggleRestoreRecording 参照）。移動・調整だけはハンドルを直接つまむ
   * 操作で固定レティクルと相容れないため、従来どおり指駆動のままにする。
   */
  const reticleFixed = settings.loupeMode === 'adjust'
    && (appMode === 'eyedropper' || appMode === 'draw' || appMode === 'restore');
  const reticleFixedRef = useRef(reticleFixed);
  reticleFixedRef.current = reticleFixed;

  /** 画像1ドットぶんの表示px。倍率が変わっても「1押し＝1ドット」を保つ。 */
  const dotStepPx = () => Math.max(0.02, dsRef.current * zoomRef.current.scale);

  /**
   * ズームバーを畳んでルーペを大きく見せるかどうか。'adjust' モードの時だけ
   * 意味を持つ（十字ボタンで狙いを追い込む作業なので、ルーペが大きい方が良い）。
   * ユーザーがボタンで手動で切り替える。展開⇄折りたたみで見た目が入れ替わる
   * だけなので、ここは毎フレーム更新される値ではなく通常の state でよい。
   */
  const [zoomCompact, setZoomCompact] = useState(settings.loupeMode === 'adjust');
  // 'adjust' モードに入ったら、ルーペを大きく見せるレイアウトを既定にする。
  // 毎回手動で畳むのは手間なので、モード自体が「大きいルーペ前提」の運用にする。
  // ユーザーはピルボタンでいつでも元のズームバー/ブラシパネルへ展開し直せる。
  useEffect(() => {
    if (settings.loupeMode === 'adjust') setZoomCompact(true);
  }, [settings.loupeMode]);
  // 'adjust' モードのルーペは常に全幅表示。高さはキャンバス高さの4割弱程度に
  // 抑える（zoomCompact の状態には依らない。ズーム/ブラシパネルの開閉はルーペの
  // 下に浮かぶ小さなクラスタなので、ルーペ自体のサイズには影響しない）。
  const loupeIsAdjust = settings.loupeMode === 'adjust';
  const loupeSize = (loupeIsAdjust && canvasSize.h > 0)
    ? Math.round(Math.min(canvasSize.h * 0.36, 260))
    : LOUPE_SIZE;
  // ルーペは常に画面最上部(topOffset=8)に置く。ズームバー/ツールメニューの
  // 位置は、ルーペ自体ではなく下の loupeDockLevel（収納段階）に応じて
  // ルーペの下・横へ回り込ませるので、モードごとに topOffset を変える必要は
  // もう無い（以前は 'fixed' モードだけ上に空けたズームバー行の下に
  // 置いていたが、その行自体がルーペに追従するよう作り直したため）。
  const loupeTopOffset = 8;
  /**
   * ルーペ本体タップでの収納段階（0=大/1=中/2=小）。呼び出し側（ここ）が
   * state を持つ制御コンポーネントにしてある。収納段階ごとにズームバー・
   * ツールメニューの配置がまったく違う（大: 下に1行、中: 右に縦積み、
   * 小: 右に横並び）ので、親がこの値を持っていないとレイアウトを追従
   * させられない。既定値はモードで変える —— 'adjust' 設定はルーペを
   * 大きく使いたいので大(0)、それ以外は編集画面を広く使いたいので中(1)。
   */
  const [loupeDockLevel, setLoupeDockLevel] = useState<DockLevel>(loupeIsAdjust ? 0 : 1);
  const effectiveLoupeSize = loupeDockLevel === 1 ? DOCK_COMPACT_SIZE
    : loupeDockLevel === 2 ? DOCK_DOCKED_SIZE
    : loupeSize;
  // ルーペの設定（loupeMode）自体が変わったら、そのモードの既定段階に戻す
  // （'fixed'⇄'adjust' を切り替えた時、前のモードの収納状態を引きずらない）。
  useEffect(() => {
    setLoupeDockLevel(loupeIsAdjust ? 0 : 1);
  }, [loupeIsAdjust]);
  /** ズームバーと同様、ブラシ太さ/スポイト許容値パネルも畳んでいるかどうか。 */
  const panelCompact = loupeIsAdjust && zoomCompact;
  /**
   * 十字ボタンの画面下端からの距離。説明ピル(ToolHint, bottom:12)と
   * ブラシ/スポイトのパネル(panelSlot, bottom:58)の上にくるよう空ける。
   * パネルが展開中（フルサイズのカード）だとかなり高さを食うので、
   * その時だけ余分に持ち上げる。
   */
  const panelVisibleNow = (appMode === 'restore' || appMode === 'eyedropper')
    && !retransOpen && !chromeHidden;
  const dpadBottom = panelVisibleNow && !panelCompact ? 172 : 100;
  /**
   * 展開時のズームバーの幅。'adjust' モードでは親(floatingTop)が中身に
   * 合わせて縮む右寄せの塊になっているため、flex:1 のままだと際限なく
   * 広がって左側にかぶってしまう。かといって固定値1つだと機種によって
   * 余白が中途半端になるので、画面幅に応じて伸ばしつつ min/max で挟む。
   * 右は floatingTop 自体の right:8 で確保済みなので、ここでは左側に
   * 余裕を残す分（56px）を多めに引く。
   */
  const zoomRowWidth = canvasSize.w > 0
    ? Math.min(Math.max(canvasSize.w - 56, 200), 300)
    : 260;
  /**
   * ズームバー＋ツールメニューの塊（floatingTop）の配置。ルーペの収納段階
   * （loupeDockLevel）ごとに、ルーペとの位置関係がまったく変わる。
   *   大(0): ルーペが画面上部を占めるので、その下に1行（横並び・右寄せ）。
   *   中(1): ルーペは左上に固定(left:8)の正方形なので、その右側に縦積み
   *          （上にズームバー、下にツールメニュー）で並べる。
   *   小(2): ルーペはほぼ画面外(左端に8pxの縁だけ)なので、その縁のすぐ右に
   *          横並び（ズームバー＋ツールメニュー）で並べる。
   */
  const topClusterStyle = loupeDockLevel === 0
    ? { top: loupeTopOffset + effectiveLoupeSize + 6, left: undefined, right: 8, flexDirection: 'row' as const }
    : loupeDockLevel === 1
    ? { top: loupeTopOffset, left: 8 + DOCK_COMPACT_SIZE + 8, right: 8, flexDirection: 'column' as const, alignItems: 'stretch' as const }
    // 小(docked)状態はルーペの半分(DOCK_DOCKED_SIZE/2)が画面内に見えている
    // ので、その右端より後ろから始めないとスライダーと重なる。
    : { top: loupeTopOffset, left: DOCK_DOCKED_SIZE / 2 + 8, right: 8, flexDirection: 'row' as const };
  /** 中(縦積み)の時だけ、ズームバーに横幅いっぱいを明示する（flex:1は縦方向の伸びになってしまうため）。 */
  const zoomTopRowStyle = loupeDockLevel === 0
    ? { flex: undefined, width: zoomRowWidth }
    : loupeDockLevel === 1
    ? { flex: undefined, width: undefined, alignSelf: 'stretch' as const }
    : undefined;
  // ブラシ半径は画像の短辺に対する割合で決める。こうしないと、大きなシートでは
  // 太すぎ、小さな画像では細すぎ、という状態になる。
  // スライダーは直径で扱う（「3px の線を直す」という感覚に合わせる）。
  const brushRadius = Math.max(0.5, brushPx / 2);
  const brushRadiusRef = useRef(brushRadius); brushRadiusRef.current = brushRadius;
  // initialPolygons がある（セッション復元）場合はそれを初期値にする。
  // ない場合は空配列（drawモードでタップするごとに addRect で追加される）。
  const [polygons,   setPolygons]   = useState<Polygon[]>(initialPolygons ?? []);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 選択中の頂点インデックス。null = 頂点未選択。
  // 頂点タップ（ドラッグ移動なし）でセット、ポリゴン操作や選択解除でクリアする。
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(null);
  const [past,       setPast]       = useState<HistEntry[]>([]);
  const [future,     setFuture]     = useState<HistEntry[]>([]);


  // ── Refs (PanResponder クロージャから最新値を読む) ─────────────────────
  /**
   * ズーム/パンの唯一の正。
   *
   * 以前はここに毎レンダー `zoomRef.current = zoom` と代入していた。
   * ジェスチャー中は state を更新せず zoomRef/SharedValue だけを進める設計に
   * 変えたため、この代入があると「別の理由で再描画が起きた瞬間に、古い state で
   * 現在値が巻き戻る」ことになる（×8にしてパンすると×1に戻る、の原因）。
   * 値の変更は必ず applyZoom() を通す。
   */
  const zoomRef       = useRef(zoom);

  // ── ジェスチャー中のズーム更新を 1フレーム1回にまとめる ─────────────────────
  //
  // onPanResponderMove はタッチイベントごと（60〜120Hz）に来る。そのたびに setZoom
  // すると同じ数だけ再レンダーが走り、指を動かしている間ずっと重くなる。
  // ズーム値そのものは zoomRef に即時反映し（同じジェスチャー中の計算はこれを読む）、
  // React への反映だけを requestAnimationFrame でまとめる。
  /**
   * ズーム/パンの現在値を UI スレッドへ渡すための値。
   *
   * 以前はジェスチャーのたびに setZoom していたため、指を動かすたびに
   * React の再描画が走り、その中で Canvas のノードを作り直していた。
   * これが「カクカク」の正体。変換だけを SharedValue に載せて UI スレッドで
   * 動かし、React の state はジェスチャーが終わった時に1回だけ更新する。
   */
  const zoomSV = useSharedValue({ scale: 1, tx: 0, ty: 0 });

  const pendingZoomRef = useRef<ZoomState | null>(null);
  const zoomRafRef     = useRef<number | null>(null);
  /**
   * ズーム値を変更する唯一の入口。
   *
   * commit=false: ジェスチャー中。zoomRef と SharedValue（＝画像の見た目）だけを
   *   進め、React の state は触らない。再描画が挟まらないので滑らかに動く。
   * commit=true: 確定。state も揃えて、倍率表示や頂点ハンドルを追いつかせる。
   */
  const applyZoom = useCallback((next: ZoomState, commit = false) => {
    zoomRef.current = next;
    zoomSV.value = next;
    pendingZoomRef.current = next;
    if (commit) setZoom(next);
  }, [zoomSV]);

  const scheduleZoom = useCallback((next: ZoomState) => {
    applyZoom(next, false);
  }, [applyZoom]);

  /**
   * ジェスチャーが終わった時に React 側へ反映する。
   * 頂点ハンドルの大きさや倍率表示など、state を見ている部分を追いつかせる。
   */
  const commitZoom = useCallback(() => {
    // 正は zoomRef。state をそこへ揃えるだけにして、二重管理をなくす。
    setZoom(zoomRef.current);
  }, []);
  useEffect(() => () => {
    if (zoomRafRef.current != null) cancelAnimationFrame(zoomRafRef.current);
  }, []);

  const polygonsRef   = useRef(polygons);   polygonsRef.current   = polygons;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const appModeRef    = useRef(appMode);    appModeRef.current    = appMode;
  const pastRef       = useRef(past);       pastRef.current       = past;
  const dsRef         = useRef(ds);         dsRef.current         = ds;
  const imageWRef     = useRef(bgResult.width);  imageWRef.current  = bgResult.width;
  const imageHRef     = useRef(bgResult.height); imageHRef.current = bgResult.height;

  /**
   * 十字ボタン。レティクルは中央に固定なので、動かすのは画像の方。
   * 「↑＝狙いを1ドット上へ」なので、画像は逆に下へずらす（符号が反転する）。
   */
  const nudgeReticle = useCallback((dx: number, dy: number) => {
    const z = zoomRef.current;
    const step = dotStepPx();
    scheduleZoom(clampZoom(
      { scale: z.scale, tx: z.tx - dx * step, ty: z.ty - dy * step },
      canvasSizeRef.current.w, canvasSizeRef.current.h,
      imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
      true,
    ));
    // ルーペの中身は zoom state から描くので、ここで state へ反映する。
    // ボタン押下（長押しリピートでも最大 12回/秒）なので毎フレーム更新にはならない。
    commitZoom();
  }, [scheduleZoom, commitZoom]);

  // スポイト用。許容値は設定画面で変わるので、クロージャ直参照だと初回値に固定される。
  const rgbaRef       = useRef(bgResult.rgba);   rgbaRef.current   = bgResult.rgba;
  const eyeTolRef     = useRef(eyeTol);
  eyeTolRef.current   = eyeTol;
  const featherRef    = useRef(settings.featherEdges);
  featherRef.current  = settings.featherEdges;
  // 親のコールバックは PanResponder のクロージャからも呼ぶので ref 経由で読む。
  const onEyedropRef  = useRef(onEyedrop);  onEyedropRef.current  = onEyedrop;
  const onRestoreRef  = useRef(onRestore);  onRestoreRef.current  = onRestore;

  // ── スポイトのタップ波紋 ────────────────────────────────────────────────────
  // 押してから画像が更新されるまでに間があり「押せたのか分からない」ので、
  // タップ位置に波紋を出して即座に反応を返す。
  // 【重要】波紋を出してから2フレーム待って実処理を呼ぶ。同じフレームで呼ぶと
  // 重い再計算(親の applyEdits)が描画コミット前に走り、波紋が見えないまま固まる。
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const rippleV = useSharedValue(0);

  // 連打対策。スポイト1回の再計算は重いので、反映が終わるまで次のタップは捨てる。
  // 受け付けて積むと処理が直列に溜まって固まり続け、履歴も無駄に伸びる。
  // 捨てた時は波紋も出ないので「今は効かない」ことが分かる。
  const eyeBusyRef = useRef(false);
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 1 - rippleV.value,
    transform: [{ scale: 0.25 + rippleV.value * 1.5 }],
  }));
  /**
   * 描きかけの復元ストロークを捨てる。
   *
   * ブラシサイズを変えた時に呼ぶ。指で塗っている途中の座標を残したまま
   * 太さだけ差し替えると、古い位置に新しい太さの円が描かれてしまう。
   * ペイントアプリと同じく「サイズ変更＝今の軌跡は破棄して引き直し」にする。
   */
  const discardStroke = useCallback(() => {
    strokeImgRef.current = [];
    setStrokePts([]);
    if (gPhase.current === 'restore') gPhase.current = 'idle';
  }, []);

  /** タップ位置の波紋アニメを開始する（位置は呼ぶ側が setRipple 済みであること）。 */
  const startRipple = useCallback(() => {
    rippleV.value = 0;
    rippleV.value = withTiming(1, {
      duration: RIPPLE_MS,
      easing: Easing.out(Easing.quad),
      reduceMotion: ReduceMotion.Never,
    });
  }, [rippleV]);

  /**
   * 重い同期処理の予約。eyeBusy を true にした描画が確定してから実行する。
   *
   * PanResponder の中で直接呼ぶと、setState の反映（＝ローディングの描画）より
   * 先に処理が走ってしまい、「一瞬で終わったように見える」状態になっていた。
   * 待ち時間を固定で入れるのではなく、実際の処理が終わったら解除する。
   */
  /**
   * 重い同期処理を「ローディングを描いてから」実行する。
   *
   * 以前は useEffect（eyeBusy を依存）から実行していたが、依存の変化と
   * クリーンアップのタイミングに結果が左右され、実行されないことがあった
   * （＝復元ブラシが何も起きない）。状態更新のあと rAF を2つ挟むだけの形に
   * 戻し、実行経路を1本にする。1つ目でコミット、2つ目で描画が乗る。
   * 待ち時間は固定せず、処理が終わったら解除する。
   */
  const runHeavy = useCallback((work: () => void, key?: 'editor.eyedropBusy' | 'editor.undoBusy' | 'editor.redoBusy') => {
    if (key) setBusyKey(key);
    eyeBusyRef.current = true;
    setEyeBusy(true);
    // 保険: 何かの理由で下の解除に到達しなかった場合でも、操作不能のまま
    // 固まらないようにする（実処理が終わっていれば下で先に解除される）。
    const failsafe = setTimeout(() => {
      eyeBusyRef.current = false;
      setEyeBusy(false);
    }, 8000);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        work();
      } finally {
        // 例外が出ても必ず解除する（漏らすと以後スポイト・復元が死ぬ）。
        clearTimeout(failsafe);
        eyeBusyRef.current = false;
        setEyeBusy(false);
        // 波紋はここで即消さない。処理が速いと出た瞬間に消えて
        // 「押せたのか分からない」状態に戻るため、アニメの尺だけ残す。
        setTimeout(() => setRipple(null), RIPPLE_MS);
      }
    }));
  }, []);

  /**
   * スポイトの実処理。(lx,ly) は表示座標。'fixed' モードでは指を離した位置、
   * 'adjust' モードでは決定ボタンを押した時のレティクル位置から呼ばれる。
   */
  const commitEyedropAt = useCallback((lx: number, ly: number) => {
    const z = zoomRef.current;
    const { x, y } = localToImage(lx, ly, z);
    const inside = x >= 0 && x < imageWRef.current && y >= 0 && y < imageHRef.current;
    const hasColor = inside
      && !isTransparentAt(rgbaRef.current, imageWRef.current, imageHRef.current, x, y);
    if (!hasColor) {
      if (!eyeBusyRef.current) showToast(t('editor.eyedropNothing'));
    } else if (!eyeBusyRef.current) {
      setPast(p => [...p, { kind: 'edit' }]);
      setFuture([]);
      setRipple({ x: lx, y: ly });
      startRipple();
      const tol = eyeTolRef.current;
      const fth = featherRef.current;
      runHeavy(() => {
        onEyedropRef.current?.(x, y, tol, fth);
        showToast(t('editor.eyedropDone'));
      }, 'editor.eyedropBusy');
    }
  }, [t, showToast, startRipple, runHeavy]);

  /**
   * 復元ブラシ「決定」の書き始め／書き終わり。
   *
   * adjust モードの復元ブラシは、指でなぞる代わりに「レティクルを画面中央に
   * 固定し、決定ボタンで録画のように書き始め／書き終わりを切り替える」方式。
   * 決定を押すと録画開始（strokeImgRef をリセットして中央の点から書き始める）、
   * 中央固定のまま一本指・二本指でパンして画像側を動かすと、その軌跡が
   * ずっと中央にあった画像上の点を通ったことになるので、パン中に毎フレーム
   * 「今センターにある画像座標」を strokeImgRef に積んでいく（下の
   * recordCenterPoint 参照）。もう一度決定を押すと録画終了・確定する
   * （このとき呼ぶのが finishRestoreStroke — 指を離した時の確定処理と同じ）。
   */
  const [restoreRecording, setRestoreRecording] = useState(false);
  const restoreRecordingRef = useRef(false);
  /**
   * ref と同じ値を持つ共有値。UIスレッドの useAnimatedReaction から
   * 「録画中かどうか」を読むためのもの（ref は JS スレッド専用で
   * worklet から読めない）。録画中でない時にここで弾ければ、パン中
   * 毎フレーム発生する zoomSV の変化のたびに JS スレッドへブリッジ
   * （runOnJS）する回数を実質ゼロにできる。パン全般（録画中でない時も
   * 含む）がカクついていた一因はこのブリッジ呼び出しだったと考えられる。
   */
  const restoreRecordingSV = useSharedValue(false);

  /** 1ストロークぶんを確定する。指を離した時／決定で録画終了した時の共通処理。 */
  const finishRestoreStroke = useCallback(() => {
    const pts = strokeImgRef.current;
    strokeImgRef.current = [];
    setStrokePts([]);
    if (pts.length > 0 && onRestoreRef.current) {
      setPast(p => [...p, { kind: 'edit' }]);
      setFuture([]);
      const radius = brushRadiusRef.current;
      const thinned = thinStroke(pts, radius);
      runHeavy(() => onRestoreRef.current?.(thinned, radius), 'editor.eyedropBusy');
    }
  }, [runHeavy]);

  /** 決定ボタン。録画中でなければ開始、録画中なら終了して確定する。 */
  const toggleRestoreRecording = useCallback(() => {
    if (restoreRecordingRef.current) {
      restoreRecordingRef.current = false;
      restoreRecordingSV.value = false;
      setRestoreRecording(false);
      finishRestoreStroke();
      return;
    }
    const p = canvasCenter();
    if (!p) return;
    const { x, y } = localToImage(p.x, p.y, zoomRef.current);
    strokeImgRef.current = [[x, y]];
    flushStroke();
    restoreRecordingRef.current = true;
    restoreRecordingSV.value = true;
    setRestoreRecording(true);
  }, [finishRestoreStroke, flushStroke, restoreRecordingSV]);

  // ツールを切り替えた時に録画中のまま置き去りにしない。無かったことにはせず、
  // その時点までの軌跡をそのまま確定する（決定をもう一度押すのと同じ扱い）。
  useEffect(() => {
    if (appMode !== 'restore' && restoreRecordingRef.current) {
      restoreRecordingRef.current = false;
      restoreRecordingSV.value = false;
      setRestoreRecording(false);
      finishRestoreStroke();
    }
  }, [appMode, finishRestoreStroke, restoreRecordingSV]);

  /**
   * パン1フレームぶん、中央固定の画像座標を軌跡に積む。録画中の復元ブラシの
   * みが呼ぶ。flushStroke が rAF で1フレーム1回にまとめてくれるので、
   * ここは呼びっぱなしでよい。
   */
  const recordCenterPoint = useCallback(() => {
    if (appModeRef.current !== 'restore' || !restoreRecordingRef.current) return;
    const p = canvasCenter();
    if (!p) return;
    const { x, y } = localToImage(p.x, p.y, zoomRef.current);
    strokeImgRef.current.push([x, y]);
    flushStroke();
  }, [flushStroke]);

  /**
   * 復元ブラシの録画中、zoomSV（パン中に毎フレーム更新される共有値）を
   * 直接監視して軌跡を積む。
   *
   * 以前はジェスチャーハンドラの各分岐（一本指パン・二本指ピンチ・十字ボタン）
   * それぞれに recordCenterPoint() 呼び出しを差し込んでいたが、分岐が多く
   * 一部の経路で呼び忘れる／条件を満たさず素通りする不具合が起きやすかった
   * （実際に「最初の1点しか記録されない」不具合が起きた）。パンを起こす
   * 経路が増えるたびに全部を数え上げて追加するのではなく、「実際に画像が
   * 動いた」ことそのもの（zoomSV の変化）を唯一の入り口にすることで、
   * 今後パンの経路が増えても自動的に拾えるようにする。
   * restoreRecordingSV.value のチェックを worklet 側（UIスレッド）で
   * 先に済ませ、録画中でなければ runOnJS を呼ばない。
   */
  useAnimatedReaction(
    () => zoomSV.value,
    (curr, prev) => {
      if (!prev || !restoreRecordingSV.value) return;
      if (curr.tx === prev.tx && curr.ty === prev.ty && curr.scale === prev.scale) return;
      runOnJS(recordCenterPoint)();
    },
    [recordCenterPoint],
  );

  const onUndoEditRef = useRef(onUndoEdit); onUndoEditRef.current = onUndoEdit;
  const onRedoEditRef = useRef(onRedoEdit); onRedoEditRef.current = onRedoEdit;
  const onResetEditsRef = useRef(onResetEdits); onResetEditsRef.current = onResetEdits;

  // 個別スタンプの bbox 一覧（画像px）。四角追加の初期サイズを「タップ位置にある
  // スタンプ1個のサイズ」にするために使う。splitConnected が連結成分ごとに分離し
  // （近接塊の結合・ノイズ除外も内部で実施）、スタンプごとの BBox[] を返す。
  // エディタ入場時に1回だけ計算してキャッシュする（毎タップの再計算は重いので不可）。
  const stampBboxes = useMemo(
    () => splitConnected(bgResult.rgba, bgResult.width, bgResult.height),
    [bgResult],
  );
  const stampBboxesRef = useRef(stampBboxes); stampBboxesRef.current = stampBboxes;

  /** 次に使うポリゴン ID */
  const nextIdRef = useRef(0);
  nextIdRef.current = polygons.reduce((m, p) => Math.max(m, p.id), -1) + 1;

  // キャンバス View の画面上オフセット (pinch pageX→local 変換用)
  const canvasViewRef = useRef<View>(null);
  const viewOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 頂点ドラッグ中の情報
  const dragPolyIdRef    = useRef<number | null>(null);
  const dragVertexIdxRef = useRef<number | null>(null);

  // ポリゴン全体移動・辺ドラッグ: 直前フレームの表示座標（差分計算用）
  const gPrevLX = useRef(0);
  const gPrevLY = useRef(0);

  // 辺ドラッグ: 移動対象の両端頂点インデックス [ia, ib]
  const dragEdgeIndicesRef = useRef<[number, number] | null>(null);
  // 辺ドラッグ: 一度でも有意な移動があったか（タップとドラッグを区別するフラグ）
  const dragEdgeMovedRef = useRef(false);
  // ドラッグ中の最終ポリゴン状態: release 時のセッション保存に使う。
  // null = 今回のドラッグで move が一度も発生していない（タップのみ）
  const dragLastPolygonsRef = useRef<Polygon[] | null>(null);
  // 頂点ドラッグ: 有意な移動があったか。
  // タップ（移動なし）でも grant で pushHistory していたが、これを移動初回に遅らせるためのフラグ。
  const dragVertexMovedRef = useRef(false);

  // 長押し判定タイマー
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 長押し対象 (頂点インデックス)
  const longPressVertexRef = useRef<number | null>(null);

  // ── ドラッグ描画方針 ───────────────────────────────────────────────────────
  // RAF throttle（前回実装）は polygonsRef(即更新) と polygons state(16ms遅延) の
  // 乖離を生み、Canvas が古い座標を描画した直後に RAF で跳ぶため「一瞬戻る」を引き起こす。
  // 素直に毎フレーム setPolygons する実装に戻す。
  // 「全 Path 再生成」コストは pathCacheRef で解決済み（変化した1ポリゴンのみ再生成）
  // なので throttle なしでも十分に軽い。

  // ── ボタンズーム ────────────────────────────────────────────────────────────

  /**
   * 倍率を直接指定する（プリセット・リセット共用）。
   * stepZoom と同じく表示領域の中心を焦点にして、見ている場所を保つ。
   */
  const setZoomScale = useCallback((target: number) => {
    const prev = zoomRef.current;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, target));
    if (newScale === prev.scale) return;
    const focalX = canvasSizeRef.current.w / 2;
    const focalY = canvasSizeRef.current.h / 2;
    const ratio  = newScale / prev.scale;
    // スライダーのドラッグは毎フレーム飛んでくるので、ピンチと同じ
    // rAF スロットル経路に載せる（setZoom 直呼びだと描画が詰まる）。
    scheduleZoom(clampZoom({
      scale: newScale,
      tx: focalX - (focalX - prev.tx) * ratio,
      ty: focalY - (focalY - prev.ty) * ratio,
    }, canvasSizeRef.current.w, canvasSizeRef.current.h,
       imageWRef.current * dsRef.current, imageHRef.current * dsRef.current));
  }, [scheduleZoom]);

  /**
   * 全体表示へ戻す。等倍にしたうえで中央へ寄せる。
   * 「拡大しすぎた」「画像がどこかへ行った」ときの復帰専用。
   * clampZoom は余白を広く取るようクランプが緩めてあるので使わず、
   * centerFit で確実にぴったり中央へ戻す。
   */
  const resetZoom = useCallback(() => {
    const next = centerFit(
      1,
      canvasSizeRef.current.w, canvasSizeRef.current.h,
      imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
    );
    applyZoom(next, true);
  }, [applyZoom]);

  // ピンチ・[＋]/[−]・全体表示で倍率が変わった時に、つまみを追従させる。
  useEffect(() => {
    if (zoomDraggingRef.current) return;
    setSliderV(zoomToSlider(zoom.scale));
  }, [zoom.scale]);

  // ── Undo/Redo ─────────────────────────────────────────────────────────────

  /** 現在の polygons を past に積んで future をクリアする */
  const pushHistory = useCallback(() => {
    setPast(p  => [...p, { kind: 'polygons', polygons: polygonsRef.current }]);
    setFuture([]);
  }, []);

  const handleUndo = () => {
    if (pastRef.current.length === 0) return;
    const prev = [...pastRef.current];
    const snap = prev.pop()!;
    setPast(prev);
    if (snap.kind === 'edit') {
      // 画像の巻き戻しは親が元画像から掛け直すので重い。何も出ないと
      // 固まったように見えるため、処理中を出してから実行する。
      runHeavy(() => onUndoEditRef.current?.(), 'editor.undoBusy');
      setFuture(f => [{ kind: 'edit' }, ...f]);
      return;
    }
    setFuture(f => [{ kind: 'polygons', polygons: polygonsRef.current }, ...f]);
    setPolygons(snap.polygons);
    onPolygonsChange?.(snap.polygons); // undo 確定: セッションに保存
    // ポリゴン選択は維持する: undo/redo はポリゴン形状だけ巻き戻し、
    // どのブロックを操作中かはユーザーが判断するため選択を解除しない。
    // undo 後に選択中ポリゴンが削除されていた場合は selectedPoly が null になり
    // ハンドルが消えるだけで、ここで強制解除する必要はない。
    setSelectedVertexIdx(null); // 頂点選択のみ解除（形状が変わったため）
  };

  const handleRedo = () => {
    const [snap, ...rest] = future;
    if (!snap) return;
    setFuture(rest);
    if (snap.kind === 'edit') {
      runHeavy(() => onRedoEditRef.current?.(), 'editor.redoBusy');
      setPast(p => [...p, { kind: 'edit' }]);
      return;
    }
    setPast(p => [...p, { kind: 'polygons', polygons: polygonsRef.current }]);
    setPolygons(snap.polygons);
    onPolygonsChange?.(snap.polygons); // redo 確定: セッションに保存
    setSelectedVertexIdx(null); // 頂点選択のみ解除（undo と同じ方針）
  };

  /**
   * 編集内容を全部捨てて、この画面に入った直後の状態に戻す。
   * ポリゴン・履歴をクリアし、スポイトで消した色も復元する。
   * 履歴ごと消えて取り消せないので、必ず確認ダイアログを挟む。
   */
  // 囲い漏れのハイライト。プレビューを押した時だけ入り、ダイアログを閉じると空に戻す。
  // 空の間は何も描かないので通常時のキャンバスの見た目は変わらない。
  const [uncoveredRegions, setUncoveredRegions] = useState<UncoveredRegion[]>([]);

  /**
   * プレビューへ進む。どのポリゴンにも囲まれていない絵柄が残っていれば、
   * 黙って消えてしまう前に確認する（囲い漏れは保存結果から抜け落ちるため）。
   */
  const handlePreview = () => {
    const regions = findUncoveredRegions(
      bgResult.rgba, bgResult.width, bgResult.height, polygons,
    );
    if (regions.length === 0) {
      onPreview(polygons); // 囲い漏れなし＝従来どおりワンタップで進む
      return;
    }
    setUncoveredRegions(regions); // 該当箇所を赤く見せた状態で聞く
    Alert.alert(
      t('editor.uncoveredTitle'),
      t('editor.uncoveredMessage'),
      [
        { text: t('editor.uncoveredBack'), style: 'cancel', onPress: () => setUncoveredRegions([]) },
        { text: t('editor.uncoveredProceed'), onPress: () => { onPreview(polygons); setUncoveredRegions([]); } },
      ],
    );
  };

  const handleReset = () => {
    Alert.alert(
      t('editor.resetTitle'),
      t('editor.resetMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.reset'),
          style: 'destructive',
          onPress: () => {
            onResetEditsRef.current?.(); // 画像の巻き戻しは親が行う
            setPolygons([]);
            setSelectedId(null);
            setSelectedVertexIdx(null);
            setPast([]);
            setFuture([]);
            onPolygonsChange?.([]); // セッションにも空を反映
          },
        },
      ],
    );
  };

  // ── ポリゴン追加 (draw モードでタップ) ───────────────────────────────────

  /**
   * タップ座標(画像px)で初期四角を追加する。
   * タップ点を含む個別スタンプ1個の bbox が見つかれば、その bbox そのものを四角にする
   * （位置もサイズも bbox 由来。タップ点はどのスタンプを選ぶかの判定だけに使い、
   *   タップ点中心には置かない＝スタンプ中心をタップしなくても枠がズレない）。
   * どのスタンプにも入らない（背景タップ等）場合のみ、従来どおりタップ点中心に
   * 画像短辺 × RECT_RATIO の正方形を置くフォールバックにする。
   */
  const addRect = useCallback((imgX: number, imgY: number) => {
    const iw = imageWRef.current, ih = imageHRef.current;

    // タップ点を含むスタンプ bbox を探す。複数が重なって該当する場合は
    // 面積が小さい方（＝より内側の個別スタンプ）を優先し、大きな塊への誤爆を避ける。
    let hit: BBox | null = null;
    for (const b of stampBboxesRef.current) {
      if (imgX >= b.minX && imgX <= b.maxX && imgY >= b.minY && imgY <= b.maxY) {
        if (!hit || b.area < hit.area) hit = b;
      }
    }

    let points: [number, number][];
    if (hit) {
      // ヒット時: bbox を少し外側へ広げた四角にする。
      // bbox ぴったりだと、アンチエイリアスの薄い縁や髪の毛のような細い部分が
      // 判定に乗らず、そのまま書き出すと端が欠ける。余分を削るほうが、
      // 足りない部分を探して足すより気付きやすいので、広めから始める。
      // 広げるのはこの生成時だけで、以後ユーザーが動かした形には触らない。
      points = initialRectFromBBox(hit, iw, ih);
    } else {
      // 非ヒット時: 従来どおりタップ点中心に画像短辺×RECT_RATIO の正方形を置く。
      const fallbackHalf = Math.min(iw, ih) * RECT_RATIO / 2;
      const x0 = imgX - fallbackHalf, y0 = imgY - fallbackHalf;
      const x1 = imgX + fallbackHalf, y1 = imgY + fallbackHalf;
      points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    const id = nextIdRef.current;
    pushHistory();
    // event handler 内なので polygonsRef は最新確定状態 = prev と等価
    const next = [...polygonsRef.current, { id, points }];
    setPolygons(next);
    setSelectedId(id);
    setAppMode('move'); // 追加後すぐ移動モードでハンドル操作できるよう切替
    onPolygonsChange?.(next); // 確定操作: セッションに保存
  }, [pushHistory, onPolygonsChange]);

  // ── 頂点操作 ─────────────────────────────────────────────────────────────

  /** 辺タップ: インデックス i と i+1 の間に中点を挿入 */
  const insertVertex = useCallback((polyId: number, edgeIdx: number) => {
    pushHistory();
    const next = polygonsRef.current.map(p => {
      if (p.id !== polyId) return p;
      const pts = [...p.points] as [number, number][];
      const a = pts[edgeIdx], b = pts[(edgeIdx + 1) % pts.length];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pts.splice(edgeIdx + 1, 0, mid);
      return { ...p, points: pts };
    });
    setPolygons(next);
    onPolygonsChange?.(next); // 確定操作: セッションに保存
  }, [pushHistory, onPolygonsChange]);

  /** 長押し: 頂点削除（最低3頂点） */
  const deleteVertex = useCallback((polyId: number, vIdx: number) => {
    const poly = polygonsRef.current.find(p => p.id === polyId);
    if (!poly || poly.points.length <= 3) return;
    pushHistory();
    const next = polygonsRef.current.map(p => {
      if (p.id !== polyId) return p;
      const pts = p.points.filter((_, i) => i !== vIdx) as [number, number][];
      return { ...p, points: pts };
    });
    setPolygons(next);
    onPolygonsChange?.(next); // 確定操作: セッションに保存
  }, [pushHistory, onPolygonsChange]);

  // selectedVertexIdx を ref でも持つ（PanResponder クロージャから参照しないが、
  // deleteSelected は useCallback で deps に入れず ref 経由で読む設計に合わせる）
  const selectedVertexIdxRef = useRef(selectedVertexIdx);
  selectedVertexIdxRef.current = selectedVertexIdx;

  /**
   * move モードの十字ボタン。選択中の頂点を画像1ドット単位でずらす。
   * ハンドルを直接つまむドラッグの代わりに、ボタンでドット単位に
   * 追い込みたい時のための手段。
   *
   * 十字ボタン自体は常時表示にしてあるが（下の onNudge 配線を参照）、
   * 頂点を選択していない間に押しても何もしない。以前はここで
   * 「頂点未選択ならポリゴン全体を動かす」という代替動作をしていたが、
   * 十字ボタンが常時見えている以上、頂点を選ぶ前にうっかり押すと
   * ブロックごと動いてしまう事故が起きやすかったため、頂点選択時
   * 専用にした（ブロック全体の移動は指でのドラッグで行う）。
   *
   * 連続押し（長押しリピート）の間は1回の undo にまとめる。押すたびに
   * pushHistory すると、1px ずつ動かしただけで undo スタックが埋まって
   * しまうため、「一定時間内の連続押し」を1つの操作とみなす
   * （nudgeBurstRef が burst の開始だけ pushHistory する）。
   * 選択が変わったら burst をリセットする（下の useEffect）。
   */
  const nudgeBurstRef = useRef(false);
  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const polyId = selectedIdRef.current;
    const vIdx = selectedVertexIdxRef.current;
    if (polyId == null || vIdx == null) return;
    if (!nudgeBurstRef.current) {
      pushHistory();
      nudgeBurstRef.current = true;
    }
    setPolygons(prev => {
      const next = prev.map(p => {
        if (p.id !== polyId) return p;
        const pts = [...p.points] as [number, number][];
        pts[vIdx] = [pts[vIdx][0] + dx, pts[vIdx][1] + dy];
        return { ...p, points: pts };
      });
      onPolygonsChange?.(next); // 確定操作: セッションに保存
      return next;
    });
  }, [pushHistory, onPolygonsChange]);

  // 選択が変わったら nudge の burst をリセットする
  // （別の頂点/ポリゴンを選び直したら、それは新しい操作とみなす）。
  useEffect(() => {
    nudgeBurstRef.current = false;
  }, [selectedId, selectedVertexIdx]);

  /**
   * 削除ボタンの統合ハンドラ。
   *   頂点選択中 → その頂点を削除（3頂点以下は不可）
   *   頂点未選択 → 選択中ポリゴンを丸ごと削除（既存動作）
   * どちらも pushHistory で undo に積む。
   */
  const deleteSelected = useCallback(() => {
    const polyId = selectedIdRef.current;
    const vIdx   = selectedVertexIdxRef.current;

    if (polyId !== null && vIdx !== null) {
      // 頂点選択中: 頂点削除（deleteVertex が 3頂点ガードを持つ）
      deleteVertex(polyId, vIdx);
      setSelectedVertexIdx(null); // 削除後は頂点選択を解除
      return;
    }

    // 頂点未選択: ポリゴン全体を削除（従来動作）
    if (polyId === null) return;
    pushHistory();
    const next = polygonsRef.current.filter(p => p.id !== polyId);
    setPolygons(next);
    setSelectedId(null);
    onPolygonsChange?.(next); // 確定操作: セッションに保存
  }, [pushHistory, deleteVertex, onPolygonsChange]);

  // ── 座標変換ヘルパー ──────────────────────────────────────────────────────

  /** 表示ローカルpx → 画像px */
  const localToImage = (lx: number, ly: number, z: ZoomState) => ({
    x: (lx - z.tx) / z.scale / dsRef.current,
    y: (ly - z.ty) / z.scale / dsRef.current,
  });

  /** 画像px → 表示ローカルpx */
  const imageToLocal = (ix: number, iy: number, z: ZoomState) => ({
    sx: ix * dsRef.current * z.scale + z.tx,
    sy: iy * dsRef.current * z.scale + z.ty,
  });

  // ── タップ処理 (move モード) ──────────────────────────────────────────────

  /**
   * move モードのタップ:
   *   1) 選択中ポリゴンの頂点近く → (ハンドルは grant で処理済み: ここには来ない)
   *   2) 選択中ポリゴンの辺近く   → 頂点挿入
   *   3) 任意ポリゴン内部         → そのポリゴンを選択
   *   4) 空白                     → 選択解除
   */
  const handleMoveTap = useCallback((lx: number, ly: number) => {
    const z      = zoomRef.current;
    const selId  = selectedIdRef.current;
    const polys  = polygonsRef.current;

    // 選択中ポリゴンの辺ヒット判定
    if (selId !== null) {
      const poly = polys.find(p => p.id === selId);
      if (poly) {
        const pts = poly.points;
        for (let i = 0; i < pts.length; i++) {
          const a = imageToLocal(pts[i][0], pts[i][1], z);
          const b = imageToLocal(pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1], z);
          if (distPointToSegment(lx, ly, a.sx, a.sy, b.sx, b.sy) < hitRadius(EDGE_HIT_PX, z.scale)) {
            insertVertex(selId, i);
            return;
          }
        }
      }
    }

    // ポリゴン内部タップ → 選択（ポリゴンが変わったら頂点選択もリセット）
    const { x: imgX, y: imgY } = localToImage(lx, ly, z);
    const hit = polys.slice().reverse().find(p => pointInPoly(imgX, imgY, p.points));
    setSelectedId(hit ? (hit.id === selId ? null : hit.id) : null);
    setSelectedVertexIdx(null); // ポリゴン選択変更で頂点選択は解除
  }, [insertVertex]);

  /**
   * 決定ボタン。ツールごとに「確定する場所／タイミング」が違うので振り分ける。
   *
   * ・スポイト／四角追加: 画面中央にレティクルを固定し、画像の方をパンして
   *   狙いを合わせる（詳しくは reticleFixed 参照）ので、中央＝狙っている点。
   *   決定を押すとその場で1回確定する。
   * ・復元ブラシ: 単発の点ではなく軌跡が要るので、決定は「録画」の開始／
   *   終了トグルにしてある（toggleRestoreRecording）。開始後は中央固定の
   *   まま画像をパンすると、そのパンの軌跡がそのままストロークになる。
   * ・移動・調整: ハンドルを直接つまむ操作なので決定ボタン自体を出さない
   *   （呼び出し側の onDecide 条件で除外）。
   */
  const decideAtReticle = useCallback(() => {
    const mode = appModeRef.current;
    if (mode === 'restore') {
      toggleRestoreRecording();
      return;
    }
    const p = canvasCenter();
    if (!p) return;
    if (mode === 'eyedropper') {
      commitEyedropAt(p.x, p.y);
    } else if (mode === 'draw') {
      const { x, y } = localToImage(p.x, p.y, zoomRef.current);
      addRect(x, y);
    }
  }, [toggleRestoreRecording, commitEyedropAt, addRect]);

  /**
   * move モード（'adjust' 設定）用の決定ボタン。トグル式で、3段階を行き来する。
   *   ① 何も選択していない → レティクルが入っているポリゴンを選ぶ（手前優先。
   *      「ブロックの内側で決定したのに別の離れたポリゴンが選ばれる」事故を
   *      避けるため、ポリゴン内部にいる時は必ずそのポリゴンを優先する）。
   *      レティクルの近くに頂点があれば、それも一緒にロックする。
   *   ② ポリゴンだけ選択済み（頂点は未選択） → 十字ボタンでパンして狙いを
   *      近づけてから、もう一度決定を押すと、その位置に近い頂点をロックする。
   *      近くに頂点が無ければ選択自体を解除する（行き詰まらないように）。
   *   ③ 頂点まで選択済み → もう一度決定を押すと全解除。
   *
   * 以前は「ポリゴン内部なら閾値なしで必ずどこかの頂点を選ぶ」実装にしていたが、
   * 大きい矩形1個だけのような場合、画面中央からどの角も遠いために選ばれる
   * 頂点が事実上ランダムに感じられ、「関係ない場所に飛ぶ」という報告につながった。
   * 十字ボタンは頂点未選択でもパンとして働く（nudgeSelection 側のフォール
   * バック）ので、頂点が無理に決まらなくても操作に困らない。閾値を設けて
   * 「近くにある時だけロックする」方が直感的な動きになる。
   */
  const decideMoveSelect = useCallback(() => {
    // ③ 頂点まで選択済み → 全解除。
    if (selectedVertexIdxRef.current != null) {
      setSelectedId(null);
      setSelectedVertexIdx(null);
      return;
    }

    const p = canvasCenter();
    if (!p) return;
    const z = zoomRef.current;
    const polys = polygonsRef.current;
    const threshold = hitRadius(VERTEX_HIT_PX, z.scale);

    const nearestVertexOf = (poly: (typeof polys)[number]) => {
      let idx = -1;
      let dist = threshold;
      for (let i = 0; i < poly.points.length; i++) {
        const { sx, sy } = imageToLocal(poly.points[i][0], poly.points[i][1], z);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < dist) {
          dist = d;
          idx = i;
        }
      }
      return idx;
    };

    // ② ポリゴンだけ選択済み → 近くの頂点をロック、無ければ解除。
    const alreadyId = selectedIdRef.current;
    if (alreadyId != null) {
      const poly = polys.find(pl => pl.id === alreadyId);
      const idx = poly ? nearestVertexOf(poly) : -1;
      if (idx >= 0) {
        setSelectedVertexIdx(idx);
      } else {
        setSelectedId(null);
      }
      return;
    }

    // ① 何も選択していない → レティクルが入っているポリゴンを探す（手前優先）。
    const { x: imgX, y: imgY } = localToImage(p.x, p.y, z);
    const inside = polys.slice().reverse().find(poly => pointInPoly(imgX, imgY, poly.points));
    if (inside) {
      setSelectedId(inside.id);
      const idx = nearestVertexOf(inside);
      if (idx >= 0) setSelectedVertexIdx(idx);
      return;
    }

    // どのポリゴンの内部でもない → 全ポリゴン横断で一番近い頂点を
    // 閾値内から探す（輪郭のすぐ外側にある頂点を拾うための救済）。
    let bestPolyId: number | null = null;
    let bestVIdx: number | null = null;
    let bestDist = threshold;
    for (const poly of polys) {
      for (let i = 0; i < poly.points.length; i++) {
        const { sx, sy } = imageToLocal(poly.points[i][0], poly.points[i][1], z);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < bestDist) {
          bestDist = d;
          bestPolyId = poly.id;
          bestVIdx = i;
        }
      }
    }
    if (bestPolyId != null && bestVIdx != null) {
      setSelectedId(bestPolyId);
      setSelectedVertexIdx(bestVIdx);
    } else {
      showToast(t('editor.moveNothingHere'));
    }
  }, [showToast, t]);

  // ── PanResponder ─────────────────────────────────────────────────────────

  const gPhase      = useRef<GesPhase>('idle');
  const gStartLX    = useRef(0);
  const gStartLY    = useRef(0);
  const gStartZoom  = useRef<ZoomState>({ scale: 1, tx: 0, ty: 0 });
  const gPinchDist0 = useRef(0);
  const gPinchMidX  = useRef(0);
  const gPinchMidY  = useRef(0);

  const pan = useRef(PanResponder.create({
    // スポイト処理中はジェスチャーを一切受け付けない。
    // 連続タップで処理が直列に溜まるのと、パンの誤爆を同時に防ぐ。
    // タップの入口は塞がない。ここに uiInteractingRef を足すと、スライダーの
    // 終了イベントを1度でも取りこぼした瞬間にキャンバスのタップが全部死ぬ。
    // スライダーからタッチを奪うのは「移動」側なので、ガードは下の
    // onMoveShouldSetPanResponder だけで足りる。
    onStartShouldSetPanResponder: () => !eyeBusyRef.current,
    // 微小なジッタ（タップ時の指ブレ）では responder を奪わず、明確なドラッグ
    // （PAN_THRESHOLD=8px 以上の移動）のときだけパンを開始する。これにより
    // キャンバス上のフローティングボタンの onPress が横取りされず生き残る。
    onMoveShouldSetPanResponder:  (_, gs) =>
      !uiInteractingRef.current &&
      (Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD),

    onPanResponderGrant: (evt) => {
      const lx = evt.nativeEvent.locationX;
      const ly = evt.nativeEvent.locationY;
      gStartLX.current   = lx;
      gStartLY.current   = ly;
      gStartZoom.current = { ...zoomRef.current };

      // draw / eyedropper / restore(adjustモード) は「タップで確定」ではなく
      // パンで狙いを合わせる方式。ここでは pending にするだけで、下の
      // 「パン」ブロックが一本指ドラッグをパンとして処理する
      // （grant で即実行すると、見回すためのパン開始で誤動作するため）。
      // タップ自体は何も確定しない — 確定は中央固定の決定ボタンの役目。
      if (reticleFixedRef.current
        && (appModeRef.current === 'draw' || appModeRef.current === 'eyedropper' || appModeRef.current === 'restore')) {
        gPhase.current = 'pending';
        return;
      }

      // draw / eyedropper（'fixed' モード）はどちらも「タップで確定」。ここでは
      // pending にするだけで、release 側で移動量を見てタップかパンかを判定する。
      // こうすることでスポイト中でもキャンバスのパン・ピンチがそのまま使える
      // （grant で即実行すると、見回すためのパン開始で誤って色が消える）。
      if (appModeRef.current === 'draw' || appModeRef.current === 'eyedropper') {
        gPhase.current = 'pending';
        // スポイトは押した瞬間に色が決まるので、押している間だけでも
        // 「どこを吸うのか」を見せる価値がある。
        if (appModeRef.current === 'eyedropper') showLoupe(lx, ly);
        return;
      }

      // 復元ブラシ（'fixed' モード）: なぞり始め。指を動かすたびに軌跡を伸ばし、
      // 離した時に確定する。
      if (appModeRef.current === 'restore') {
        gPhase.current = 'restore';
        const z = zoomRef.current;
        const { x, y } = localToImage(lx, ly, z);
        strokeImgRef.current = [[x, y]];
        flushStroke();
        showLoupe(lx, ly);
        return;
      }

      // move モード: 選択中ポリゴンの頂点ヒット判定
      const selId = selectedIdRef.current;
      if (selId !== null) {
        const poly = polygonsRef.current.find(p => p.id === selId);
        if (poly) {
          const z = zoomRef.current;
          for (let i = 0; i < poly.points.length; i++) {
            const { sx, sy } = imageToLocal(poly.points[i][0], poly.points[i][1], z);
            if (Math.hypot(lx - sx, ly - sy) < hitRadius(VERTEX_HIT_PX, z.scale)) {
              // pushHistory はタップ/ドラッグを区別するため初回移動まで遅らせる（後述）
              dragVertexMovedRef.current = false; // フラグリセット
              dragPolyIdRef.current    = selId;
              dragVertexIdxRef.current = i;
              gPhase.current = 'drag_vertex';

              // 長押し判定開始
              longPressVertexRef.current = i;
              longPressTimer.current = setTimeout(() => {
                // 長押し確定: 頂点削除
                if (dragPolyIdRef.current !== null && longPressVertexRef.current !== null) {
                  deleteVertex(dragPolyIdRef.current, longPressVertexRef.current);
                  dragPolyIdRef.current    = null;
                  dragVertexIdxRef.current = null;
                  longPressVertexRef.current = null;
                  gPhase.current = 'idle';
                }
              }, LONG_PRESS_MS);
              return;
            }
          }
        }
      }

      // ── 辺ドラッグの判定 ─────────────────────────────────────────────────
      // 選択中ポリゴンの辺(EDGE_HIT_PX 以内)をタッチした場合に辺ドラッグモードへ。
      // ドラッグ → 両端頂点を同じ dx/dy で移動。
      // タップ（移動量が閾値未満）→ release で insertVertex を呼ぶ（既存挙動）。
      // NOTE: history は release 側ではなく最初の move で積む（タップ時の二重 push 防止）。
      if (selId !== null) {
        const edgePoly = polygonsRef.current.find(p => p.id === selId);
        if (edgePoly) {
          const z   = zoomRef.current;
          const pts = edgePoly.points;
          for (let i = 0; i < pts.length; i++) {
            const nextI = (i + 1) % pts.length;
            const a = imageToLocal(pts[i][0],    pts[i][1],    z);
            const b = imageToLocal(pts[nextI][0], pts[nextI][1], z);
            if (distPointToSegment(lx, ly, a.sx, a.sy, b.sx, b.sy) < hitRadius(EDGE_HIT_PX, z.scale)) {
              dragPolyIdRef.current    = selId;
              dragEdgeIndicesRef.current = [i, nextI];
              dragEdgeMovedRef.current   = false; // 最初の move まで移動なし
              gPrevLX.current = lx;
              gPrevLY.current = ly;
              gPhase.current  = 'drag_edge';
              return;
            }
          }
        }
      }

      // ── ポリゴン全体移動の判定 ────────────────────────────────────────────
      // 頂点・辺のどちらにも当たらず、選択中ポリゴンの内部をタップした場合に
      // ポリゴン全体をドラッグ移動するモードに入る。
      if (selId !== null) {
        const poly = polygonsRef.current.find(p => p.id === selId);
        if (poly) {
          const { x: igX, y: igY } = localToImage(lx, ly, zoomRef.current);
          if (pointInPoly(igX, igY, poly.points)) {
            // undo スナップショットを積んでドラッグ開始
            pushHistory();
            dragPolyIdRef.current = selId;
            gPrevLX.current = lx;
            gPrevLY.current = ly;
            gPhase.current  = 'drag_poly';
            return;
          }
        }
      }

      gPhase.current = 'pending';
    },

    onPanResponderMove: (evt, gs) => {
      const touches = evt.nativeEvent.touches;

      // 長押しタイマーキャンセル: 動いたら長押しではない
      if (longPressTimer.current && (Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3)) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        longPressVertexRef.current = null;
      }

      // ── 頂点ドラッグ ──────────────────────────────────────────────────
      if (gPhase.current === 'drag_vertex') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        // 頂点は指の真下に来るので、掴んでいる間はルーペで位置を見せる。
        showLoupe(lx, ly);
        const z  = zoomRef.current;
        const imgX = (lx - z.tx) / z.scale / dsRef.current;
        const imgY = (ly - z.ty) / z.scale / dsRef.current;
        const polyId = dragPolyIdRef.current!;
        const vIdx   = dragVertexIdxRef.current!;
        // 初回の有意な移動でのみ履歴を積む（タップ選択では履歴を汚染しない）
        if (!dragVertexMovedRef.current) {
          dragVertexMovedRef.current = true;
          pushHistory();
        }
        // 変化しないポリゴンは同じ参照を返す → pathCacheRef がヒットし Path 再生成なし
        setPolygons(prev => {
          const next = prev.map(p => {
            if (p.id !== polyId) return p;
            const pts = [...p.points] as [number, number][];
            pts[vIdx] = [imgX, imgY];
            return { ...p, points: pts };
          });
          dragLastPolygonsRef.current = next; // release 時のセッション保存用
          return next;
        });
        return;
      }

      // ── 辺ドラッグ (両端頂点を同時移動) ──────────────────────────────────
      if (gPhase.current === 'drag_edge') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;

        // 最初の有意な移動でスナップショットを積む（タップ = 無移動の場合は push しない）
        if (!dragEdgeMovedRef.current) {
          const movedEnough =
            Math.abs(lx - gStartLX.current) > PAN_THRESHOLD ||
            Math.abs(ly - gStartLY.current) > PAN_THRESHOLD;
          if (!movedEnough) return;
          pushHistory();
          dragEdgeMovedRef.current = true;
        }

        // 前フレームからの差分を画像座標へ変換
        const dxImg = (lx - gPrevLX.current) / z.scale / dsRef.current;
        const dyImg = (ly - gPrevLY.current) / z.scale / dsRef.current;
        gPrevLX.current = lx;
        gPrevLY.current = ly;

        const polyId     = dragPolyIdRef.current!;
        const [ia, ib]   = dragEdgeIndicesRef.current!;

        setPolygons(prev => {
          const next = prev.map(p => {
            if (p.id !== polyId) return p;
            const pts = [...p.points] as [number, number][];
            pts[ia] = [pts[ia][0] + dxImg, pts[ia][1] + dyImg];
            pts[ib] = [pts[ib][0] + dxImg, pts[ib][1] + dyImg];
            return { ...p, points: pts };
          });
          dragLastPolygonsRef.current = next; // release 時のセッション保存用
          return next;
        });
        return;
      }

      // ── ポリゴン全体移動 ───────────────────────────────────────────────
      if (gPhase.current === 'drag_poly') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;
        // 表示px の差分 → 画像px の差分に変換（ズーム倍率で除算）
        const dxImg = (lx - gPrevLX.current) / z.scale / dsRef.current;
        const dyImg = (ly - gPrevLY.current) / z.scale / dsRef.current;
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        const polyId = dragPolyIdRef.current!;
        setPolygons(prev => {
          const next = prev.map(p => {
            if (p.id !== polyId) return p;
            const pts = p.points.map(([x, y]) => [x + dxImg, y + dyImg]) as [number, number][];
            return { ...p, points: pts };
          });
          dragLastPolygonsRef.current = next; // release 時のセッション保存用
          return next;
        });
        return;
      }

      // ── 二本指: 拡大縮小＋移動（どのツールでも使える）─────────────────
      // 以前は移動モードでしか効かず、スポイトや復元ブラシの最中に見る場所を
      // 変えたいときに、いちいちツールを切り替える必要があった。
      // 二本指はどのツールでも「見る場所を変える」操作として空いているので、
      // そこに割り当てる（一本指はツールごとの操作のまま）。
      if (touches.length >= 2) {
        const d    = touchDist(touches[0], touches[1]);
        const offX = viewOffsetRef.current.x;
        const offY = viewOffsetRef.current.y;
        // pageX をキャンバスローカル座標に変換
        const midX = (touches[0].pageX + touches[1].pageX) / 2 - offX;
        const midY = (touches[0].pageY + touches[1].pageY) / 2 - offY;

        if (gPhase.current !== 'pinch') {
          // 一本指の操作の途中で二本目が乗った場合、そちらは中断扱いにする。
          // 描きかけの軌跡を残すと、離した時に意図しない復元が確定してしまう。
          if (gPhase.current === 'restore') discardStroke();
          hideLoupe();
          gPhase.current      = 'pinch';
          gPinchDist0.current = d;
          gPinchMidX.current  = midX;
          gPinchMidY.current  = midY;
          gStartZoom.current  = { ...zoomRef.current };
        }
        const { scale: s0, tx: tx0, ty: ty0 } = gStartZoom.current;
        const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s0 * d / gPinchDist0.current));
        // 焦点固定: ピンチ開始時の中点にあった画像上の点を、
        // 「今の中点」へ持ってくる。こうすると拡大縮小と同時に、
        // 二本指を滑らせたぶんだけ画像も動く（＝移動も一緒にできる）。
        const focalX = (gPinchMidX.current - tx0) / s0;
        const focalY = (gPinchMidY.current - ty0) / s0;
        // reticleFixed 中は、狙いたい端や角を中央のレティクルまで持ってこられる
        // よう、画像がキャンバスをはみ出して動かせる範囲を広げる
        // （通常クランプのままだと画像の端が中央まで来られない）。
        scheduleZoom(clampZoom({
          scale: newScale,
          tx: midX - focalX * newScale,
          ty: midY - focalY * newScale,
        }, canvasSizeRef.current.w, canvasSizeRef.current.h,
           imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
           reticleFixedRef.current));
        // ルーペの追従も、復元ブラシの録画中の軌跡積みも、下の
        // useAnimatedReaction(zoomSV監視)がここで更新した値を拾って処理する。
        return;
      }

      if (gPhase.current === 'pinch') return;

      // スポイト: 押したまま動かして狙いを定められるよう、指を追ってルーペを
      // 更新する。以前は押した瞬間の1回しか出しておらず、動かしても
      // ルーペが固まったままだった。
      // reticleFixed 中はこの経路を使わず、下のパン処理に流す
      // （狙いは画面を動かして合わせるので、指の位置そのものは見せない）。
      if (gPhase.current === 'pending' && appModeRef.current === 'eyedropper'
        && !reticleFixedRef.current) {
        showLoupe(gStartLX.current + gs.dx, gStartLY.current + gs.dy);
        return;
      }

      // 復元ブラシ: 指の軌跡を貯める。実際の画素書き換えは離した時に1回だけ行う
      // （毎フレーム画像全体を作り直すと重すぎるため）。
      if (gPhase.current === 'restore') {
        const lx = gStartLX.current + gs.dx;
        const ly = gStartLY.current + gs.dy;
        const z = zoomRef.current;
        const { x, y } = localToImage(lx, ly, z);
        strokeImgRef.current.push([x, y]);
        flushStroke();
        showLoupe(lx, ly);
        return;
      }

      // ── パン (move モード ／ reticleFixed 中のスポイト・四角追加) ──────────
      // reticleFixed では「画面を動かしてレティクルに合わせにいく」操作を
      // 一本指ドラッグにも割り当てる。二本指パンだけだと持ち方によっては
      // 片手操作がしづらいため。中央固定クランプ(centerReticle=true)で
      // 画像の端・角までレティクルへ寄せられるようにする。
      if (appModeRef.current === 'move' || reticleFixedRef.current) {
        if (gPhase.current === 'pending') {
          if (Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD)
            gPhase.current = 'pan';
        }
        if (gPhase.current === 'pan') {
          const { scale, tx, ty } = gStartZoom.current;
          scheduleZoom(clampZoom({ scale, tx: tx + gs.dx, ty: ty + gs.dy },
            canvasSizeRef.current.w, canvasSizeRef.current.h,
            imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
            reticleFixedRef.current));
          // ルーペの追従・復元ブラシの軌跡積みは、下の
          // useAnimatedReaction(zoomSV監視)がまとめて処理する。
        }
      }
    },

    onPanResponderRelease: (_, gs) => {
      // 長押しタイマークリア
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current     = null;
        longPressVertexRef.current = null;
      }

      if (gPhase.current === 'drag_vertex') {
        // バグ修正: updater 関数は render フェーズで実行されるため、
        // その時点では dragVertexIdxRef.current がすでに null になっている。
        // ローカル変数に capture してから ref を clear する。
        const capturedVIdx = dragVertexIdxRef.current;
        dragPolyIdRef.current    = null;
        dragVertexIdxRef.current = null;
        dragVertexMovedRef.current = false;
        gPhase.current = 'idle';

        // 移動なし（タップ）= 頂点を選択状態にする。移動あり = 選択を解除。
        // dragVertexMovedRef.current はすでに false にリセット済みなので
        // gs.dx/dy で判定する（gs は PanResponder が集計した累積移動量）。
        const tapped = Math.abs(gs.dx) <= PAN_THRESHOLD && Math.abs(gs.dy) <= PAN_THRESHOLD;
        if (tapped && capturedVIdx !== null) {
          // 同じ頂点を再タップでトグル解除、別の頂点なら選択
          // capture した値を updater 内で使う（ref は null 済みのため参照不可）
          setSelectedVertexIdx(prev => prev === capturedVIdx ? null : capturedVIdx);
        } else {
          setSelectedVertexIdx(null); // ドラッグ移動したら頂点選択を解除
        }
        // dragLastPolygonsRef が null でない = 実際に移動が起きた → セッションに保存
        if (dragLastPolygonsRef.current) {
          onPolygonsChange?.(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        return;
      }

      if (gPhase.current === 'drag_poly') {
        dragPolyIdRef.current = null;
        gPhase.current = 'idle';
        if (dragLastPolygonsRef.current) {
          onPolygonsChange?.(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        return;
      }

      if (gPhase.current === 'drag_edge') {
        if (!dragEdgeMovedRef.current) {
          // 移動なし = タップ → 辺の中点に頂点を追加（insertVertex が history を管理）
          insertVertex(dragPolyIdRef.current!, dragEdgeIndicesRef.current![0]);
        }
        dragEdgeIndicesRef.current = null;
        // dragLastPolygonsRef が null でない = 実際に移動が起きた → セッションに保存
        if (dragLastPolygonsRef.current) {
          onPolygonsChange?.(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        dragEdgeMovedRef.current   = false;
        dragPolyIdRef.current      = null;
        gPhase.current = 'idle';
        return;
      }

      if (gPhase.current === 'pending') {
        const moved = Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD;
        // スポイトだけは「動かしてから離す」を正式な操作にしているので、
        // 移動量で捨てない。ルーペで位置を確かめてから離す使い方に合わせる。
        // （以前はここで moved 判定に弾かれ、微調整すると何も起きなかった）
        // reticleFixed 中は、タップだけでは何も確定しない（狙いは画面を
        // 動かして合わせ、確定は決定ボタンの役目）。
        if ((!moved || appModeRef.current === 'eyedropper') && !reticleFixedRef.current) {
          if (appModeRef.current === 'draw' && !moved) {
            // draw モード: タップ座標に四角を追加
            const z = zoomRef.current;
            const { x, y } = localToImage(gStartLX.current, gStartLY.current, z);
            addRect(x, y);
          } else if (appModeRef.current === 'eyedropper') {
            // スポイト: 指を離した位置の色を透過させる。画像外のタップは無視する。
            // 押した位置ではなく離した位置を使うのは、指を置いてから微調整して
            // 狙いを定める使い方に合わせるため（実機だと押した瞬間に確定すると
            // 狙いがずれる）。ルーペも離す直前の位置を映している。
            commitEyedropAt(gStartLX.current + gs.dx, gStartLY.current + gs.dy);
          } else {
            // move モード: 辺タップ・ポリゴン選択
            handleMoveTap(gStartLX.current, gStartLY.current);
          }
        }
      }

      // 復元ブラシ: 離した時に1回だけ親へ渡す。1ストローク＝undo 1回になる。
      if (gPhase.current === 'restore') {
        const pts = strokeImgRef.current;
        strokeImgRef.current = [];
        setStrokePts([]);
        if (pts.length > 0 && onRestoreRef.current) {
          setPast(p => [...p, { kind: 'edit' }]);
          setFuture([]);
          const radius = brushRadiusRef.current;
          // 保存サイズ対策。操作列は永続化されるので、同じ場所に溜まった点を
          // 落としてから渡す。塗る側が補間するので結果は変わらない。
          const thinned = thinStroke(pts, radius);
          runHeavy(() => onRestoreRef.current?.(thinned, radius), 'editor.eyedropBusy');
        }
      }

      hideLoupe();
      commitZoom();   // ジェスチャー中は SharedValue だけ動かしているので確定する
      gPhase.current = 'idle';
    },

    onPanResponderTerminate: () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current     = null;
        longPressVertexRef.current = null;
      }
      setSelectedVertexIdx(null);
      dragPolyIdRef.current      = null;
      dragVertexIdxRef.current   = null;
      dragVertexMovedRef.current = false;
      dragEdgeIndicesRef.current = null;
      dragEdgeMovedRef.current   = false;
      dragLastPolygonsRef.current = null; // 中断時は保存しない
      // 中断時も軌跡を必ず捨てる。ここが抜けていたため、ジェスチャーが
      // 中断されると緑の円が残り続け、ズームを動かすと一緒に動いていた。
      strokeImgRef.current = [];
      setStrokePts([]);
      hideLoupe();
      commitZoom();
      gPhase.current             = 'idle';
    },
  })).current;

  // ── Skia 描画データ ───────────────────────────────────────────────────────

  // ポリゴンパスのキャッシュ: ポリゴンID → { points参照, ds, SkPath }
  // poly.points の参照が変わったときだけ Path を再生成することで、
  // ドラッグ中に変化しないポリゴンは Skia.Path.Make() を毎フレーム呼ばなくて済む。
  // setPolygons の updater 関数は変化のないポリゴンを「同じ参照のまま」返すためキャッシュがヒットする。
  const pathCacheRef = useRef(new Map<number, { pts: [number,number][]; ds: number; path: ReturnType<typeof Skia.Path.Make> }>());

  /** なぞり中の軌跡のパス（画像座標 × ds）。点が無い時は null。 */
  const strokePath = useMemo(() => {
    if (strokePts.length === 0) return null;
    const p = Skia.Path.Make();
    p.moveTo(strokePts[0][0] * ds, strokePts[0][1] * ds);
    for (let i = 1; i < strokePts.length; i++) {
      p.lineTo(strokePts[i][0] * ds, strokePts[i][1] * ds);
    }
    // 1点だけのタップでも見えるよう、極小の線分を足す。
    if (strokePts.length === 1) {
      p.lineTo(strokePts[0][0] * ds + 0.01, strokePts[0][1] * ds);
    }
    return p;
  }, [strokePts, ds]);

  const polyPaths = useMemo(() => {
    const cache = pathCacheRef.current;
    // 削除されたポリゴンのキャッシュを除去
    for (const id of cache.keys()) {
      if (!polygons.some(p => p.id === id)) cache.delete(id);
    }
    return polygons.map(poly => {
      const cached = cache.get(poly.id);
      // points の参照と ds が同じならキャッシュを返す（Path 再生成なし）
      if (cached && cached.pts === poly.points && cached.ds === ds) return cached.path;
      const p = Skia.Path.Make();
      if (poly.points.length >= 1) {
        p.moveTo(poly.points[0][0] * ds, poly.points[0][1] * ds);
        for (let i = 1; i < poly.points.length; i++)
          p.lineTo(poly.points[i][0] * ds, poly.points[i][1] * ds);
        p.close();
      }
      cache.set(poly.id, { pts: poly.points, ds, path: p });
      return p;
    });
  }, [polygons, ds]);

  // ── 市松の下地 ────────────────────────────────────────────────────────────
  //
  // 【1タイル1ノードにしない】
  // 以前はタイルを <Rect> の配列で描いていた。20px タイルだと画面サイズによっては
  // 700個近いノードになり、useMemo で配列をキャッシュしても**再レンダーのたびに
  // React がその全ノードを差分計算する**。ドラッグ中は setZoom / setPolygons が
  // タッチイベントごとに走るので、このコストが毎フレーム乗ってラグの主因になっていた。
  //
  // 2×2 の画像をリピート描画するシェーダに変えて、ノード数を 1 にする。
  // 拡大は Nearest にしないとタイルの境目がぼけるので明示する。
  const CHECKER_TILE = 20;
  const checkerImage = useMemo(() => {
    // 2×2 の市松（左上と右下が明、残りが暗）。
    const light = [0xCC, 0xCC, 0xCC, 0xFF];
    const dark  = [0x99, 0x99, 0x99, 0xFF];
    const px = new Uint8Array([...light, ...dark, ...dark, ...light]);
    return Skia.Image.MakeImage(
      { width: 2, height: 2, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
      Skia.Data.fromBytes(px),
      2 * 4,
    );
  }, []);

  // 画像とポリゴンを載せる Group の変換。UI スレッドで動くので、
  // ジェスチャー中に React の再描画が入らない。
  const groupTransform = useDerivedValue(() => [
    { translateX: zoomSV.value.tx },
    { translateY: zoomSV.value.ty },
    { scale: zoomSV.value.scale },
  ], [zoomSV]);

  // 連番ラベルの重心（画像座標）。画面座標への変換は PolyBadge 側で
  // zoomSV から直接行う（パン中もなめらかに追従させるため、ここでは
  // zoom には依存しない静的な値だけを持つ）。
  const labelCentroids = useMemo(() =>
    polygons.map(poly => centroid(poly.points)),
  [polygons]);

  const selectedPoly = selectedId !== null ? polygons.find(p => p.id === selectedId) : null;

  /**
   * move モードで十字ボタンを出すかどうか。
   *
   * ポリゴン（ブロック）が選択されているだけでは出さず、頂点を具体的に
   * 選択している時だけ出す。ブロック選択の直後（頂点はまだ未選択）に
   * 十字ボタンが出てしまうと、動かしたいのは特定の頂点（丸）のつもりで
   * 押しても「ブロック全体が動く」ことになり、丸だけを動かせないという
   * 混乱を招いていた。頂点ハンドルをタップして選択してから出す設計にすれば、
   * 「今どれを動かすか」が常に一意に決まる。
   */
  const moveNudgeEnabled = appMode === 'move' && selectedPoly != null && selectedVertexIdx != null;
  /** 十字ボタンでの調整中、ルーペに映す狙い所（画像座標）＝選択中の頂点。 */
  const moveNudgePoint = moveNudgeEnabled && selectedPoly && selectedVertexIdx != null
    ? { x: selectedPoly.points[selectedVertexIdx][0], y: selectedPoly.points[selectedVertexIdx][1] }
    : null;
  /**
   * move モードで十字ボタン・決定ボタンを出すかどうか。'adjust' 設定の
   * 時だけ（パンで狙いを合わせる操作が前提のため、'fixed' では意味がない）。
   * 頂点を選択済みかどうかは問わず常時表示する — ボタン自体は常にそこに
   * あってよく、頂点未選択の間に十字を押しても何も起きないだけでよい
   * （nudgeSelection 側で弾く）。決定はトグルなので、こちらも常時表示。
   */
  const moveSelectEnabled = loupeIsAdjust && appMode === 'move';

  /**
   * レティクルの位置を、ルーペの中だけでなく実物大の画面にも示す印。
   * reticleFixed（スポイト・四角追加・復元ブラシ、すべて adjust モード）は
   * 常にキャンバス中央固定。move モードで十字ボタンが出ている間
   * （moveNudgeEnabled）は、動かしている頂点／ポリゴンの位置を示す。
   * それ以外でも 'adjust' 設定中（moveモードで頂点未選択の時など）は、
   * パン中も含めてキャンバス中央にフォールバック表示する
   * （ルーペ自体を常時表示にしているのと同じ理由 — adjust 設定の間は
   * レティクルが画面から消える瞬間を作らない）。
   */
  const mainReticlePos = reticleFixed
    ? canvasCenter()
    : (moveNudgeEnabled && moveNudgePoint
      ? (() => { const { sx, sy } = imageToLocal(moveNudgePoint.x, moveNudgePoint.y, zoom); return { x: sx, y: sy }; })()
      : (loupeIsAdjust ? canvasCenter() : null));


  // ── レンダー ──────────────────────────────────────────────────────────────

  if (!skImage) {
    return <View style={styles.root}><Text style={styles.error}>{t('editor.loadFailed')}</Text></View>;
  }

  const canPreview = polygons.length > 0;
  // onLayout 前は canvasSize が未確定 → Canvas を描画しない（ズレ防止）
  const canvasReady = canvasSize.w > 0;

  const header = (
    <AppHeader
      title={t('editor.title')}
      onBack={() => onBack(polygons)}
      backLabel={t('common.back')}
      right={
        <HeaderActions
          showOriginalImage={!!originalImageUri}
          showHome={!!onHome}
          showSettings={!!onSettings}
          onOriginalImage={() => setZoomVisible(true)}
          onHome={onHome}
          onSettings={onSettings}
        />
      }
    />
  );

  return (
    // scrollable={false}: キャンバス + バーの固定レイアウト。
    // bg は黒（キャンバス外縁の余白色）。
    <Screen header={header} scrollable={false} bg="#000">

      {/* ── 画像キャンバス (flex:1 で残り全部) ── */}
      <View
        ref={canvasViewRef}
        style={styles.canvasArea}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          canvasSizeRef.current = { w: width, h: height };
          setCanvasSize({ w: width, h: height });
          // 実測サイズで ds を計算し、画像をキャンバス内に収まるよう zoom を確定。
          // clampZoom は余白を広く取るようになっているので使わず、
          // centerFit で初期表示を確実にぴったり中央にする。
          const measuredDs = Math.min(
            (width  - PAD_L - PAD_R) / bgResult.width,
            (height - PAD_T - PAD_B) / bgResult.height,
          );
          applyZoom(centerFit(
            1, width, height,
            bgResult.width * measuredDs, bgResult.height * measuredDs,
          ), true);
          canvasViewRef.current?.measureInWindow((x, y) => {
            viewOffsetRef.current = { x, y };
          });
        }}
        {...pan.panHandlers}
      >
        {canvasReady && <Canvas style={{ width: canvasSize.w, height: canvasSize.h }}>

          {/* ── 下地レイヤー（最下層: Group の外 = transform なし・常にキャンバス全面）──
              groupTransform の内側に置くと zoom/pan で動いてしまうため Group の外に描く。
              画像サイズではなくキャンバス全体を塗ることで余白部分も統一した色になる。 */}
          {bgMode === 'white' && (
            <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h} color="#FFFFFF" />
          )}
          {bgMode === 'black' && (
            <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h} color="#000000" />
          )}
          {/* 市松: タイルを並べず、2×2 の画像をリピートするシェーダ1枚で塗る（ノード数 1）。
              transform の scale でタイルの見かけの大きさを決める。 */}
          {bgMode === 'checker' && checkerImage && (
            <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h}>
              <ImageShader
                image={checkerImage}
                tx="repeat"
                ty="repeat"
                fit="none"
                transform={[{ scale: CHECKER_TILE }]}
                // タイルの境目をぼかさない。
                sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
              />
            </Rect>
          )}

          <Group transform={groupTransform}>
            {/* 元画像の透かし。復元ブラシ中だけ、現在の画像の下に薄く敷く。
                透過済みの部分だけがここから覗くので、消えた範囲が見える。 */}
            {appMode === 'restore' && ghostOn && ghostImage && (
              <Group opacity={GHOST_OPACITY}>
                <SkiaImage
                  image={ghostImage}
                  x={0} y={0}
                  width={bgResult.width * ds}
                  height={bgResult.height * ds}
                  fit="fill"
                />
              </Group>
            )}
            {/* 背景除去済み画像 */}
            <SkiaImage
              image={skImage}
              x={0} y={0}
              width={bgResult.width * ds}
              height={bgResult.height * ds}
              fit="fill"
            />


            {/* なぞっている最中の軌跡。丸を点々と並べるのではなく1本のパスとして
                描く（点の数だけ View を作ると重いうえ、粒々に見える）。
                この Group は画像座標系なので、ズーム・パンは自動で追従する。 */}
            {appMode === 'restore' && strokePath && (
              <Path
                path={strokePath}
                color="rgba(52,199,89,0.55)"
                style="stroke"
                strokeWidth={brushPx * ds}
                strokeCap="round"
                strokeJoin="round"
              />
            )}

            {/* 確定ポリゴン */}
            {polyPaths.map((path, idx) => {
              const c     = POLY_COLORS[idx % POLY_COLORS.length];
              const isSel = polygons[idx].id === selectedId;
              return (
                <React.Fragment key={polygons[idx].id}>
                  <Path path={path} color={c.fill} style="fill" />
                  <Path path={path} color={isSel ? '#FFFFFF' : c.border} style="stroke"
                    strokeWidth={(isSel ? 2.5 : 1.5) / zoom.scale} />
                </React.Fragment>
              );
            })}

            {/* 囲い漏れのハイライト。polyPaths と同じく画像座標に ds を掛けて配置する。
                空配列の間は何も描かない（＝通常時の見た目は不変）。*/}
            {uncoveredRegions.map((r, i) => (
              <Rect
                key={`uncovered-${i}`}
                x={r.x * ds} y={r.y * ds}
                width={r.w * ds} height={r.h * ds}
                color="rgba(255, 59, 48, 0.32)"
              />
            ))}
          </Group>

          {/* 選択中ポリゴンの頂点ハンドル (Group 外: 常に固定サイズ)。
              位置は VertexHandle 内部で zoomSV から直接計算する
              （パン中も塗り・輪郭と同じなめらかさで追従させるため）。 */}
          {selectedPoly?.points.map(([px, py], vi) => (
            <VertexHandle
              key={vi}
              px={px} py={py} ds={ds} zoomSV={zoomSV}
              selected={vi === selectedVertexIdx}
            />
          ))}

        </Canvas>}

        {/* スポイトのタップ波紋。押した瞬間に出して「効いている」ことを示す。
            処理中は JS が止まってアニメも止まるが、押した位置は残るので
            「押せていない」という誤解は起きない。*/}
        {ripple && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.eyeRipple,
              { left: ripple.x - EYE_RIPPLE_R, top: ripple.y - EYE_RIPPLE_R },
              rippleStyle,
            ]}
          />
        )}

        {/* 透過強度 + 再適用。親が onRetransparent を渡した画面（セル編集）だけ出す。
            元画像の該当セル範囲から作り直すので、消えすぎも消え足りないも直せる。 */}
        {onRetransparent && retransOpen && !chromeHidden && (
          <View style={styles.panelSlot} pointerEvents="box-none">
            <View style={styles.retransCard}>
              <View style={styles.retransHead}>
                <Text style={styles.retransTitle}>{t('editor.retransTitle')}</Text>
                <View style={styles.retransHeadRight}>
                  <Text style={styles.retransValue}>{Math.round(cellTol)}</Text>
                  <AnimatedPressable onPress={() => setRetransOpen(false)} pressedScale={0.9}>
                    <Icon name="close" size={18} color="rgba(255,255,255,0.8)" />
                  </AnimatedPressable>
                </View>
              </View>
              <View style={styles.retransRow}>
                <Text style={styles.retransEnd}>{t('granularity.weak')}</Text>
                <Slider
                  style={styles.retransSlider}
                  minimumValue={0}
                  maximumValue={100}
                  value={cellTol}
                  onSlidingStart={() => { uiInteractingRef.current = true; discardStroke(); }}
                  onValueChange={setCellTol}
                  onSlidingComplete={() => { uiInteractingRef.current = false; discardStroke(); }}
                  minimumTrackTintColor={IOS.blue}
                  maximumTrackTintColor="rgba(255,255,255,0.28)"
                  thumbTintColor="#FFF"
                />
                <Text style={styles.retransEnd}>{t('granularity.strong')}</Text>
              </View>
              <AnimatedPressable
                style={styles.retransApply}
                onPress={() => { onRetransparent(cellTol); setRetransOpen(false); }}
                pressedScale={0.96}
              >
                <Icon name="auto-fix-high" size={16} color="#FFF" />
                <Text style={styles.retransApplyTxt}>{t('editor.retransApply')}</Text>
              </AnimatedPressable>
            </View>
          </View>
        )}

        {/* ブラシサイズ調整中だけ、画面中央に実寸の円を出す。
            スライダーを動かしながら太さを確かめるためのもので、
            指の位置とは無関係なので中央に固定する。 */}
        {brushSliding && (
          <View pointerEvents="none" style={styles.brushGaugeWrap}>
            <View
              style={[styles.brushGauge, {
                width: brushPx * ds * zoom.scale,
                height: brushPx * ds * zoom.scale,
                borderRadius: brushPx * ds * zoom.scale / 2,
              }]}
            />
          </View>
        )}

        {/* ブラシの太さ。復元モードの時だけ出す。連続値で、現在値を px で示す。 */}
        {/* スポイトの許容値。ブラシの太さと同じ枠を使い、スポイト選択中だけ出す。
            設定画面まで行かずに「もう少し広く／狭く」を調整できるようにする。 */}
        {appMode === 'eyedropper' && !retransOpen && !chromeHidden && (
          <View style={styles.panelSlot} pointerEvents="box-none">
            {panelCompact ? (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                <AnimatedPressable
                  style={styles.zoomCompactBtn}
                  onPress={() => setZoomCompact(false)}
                  pressedScale={0.94}
                >
                  <Icon name="colorize" size={14} color="#FFF" />
                  <Text style={styles.zoomCompactTxt}>{Math.round(eyeTol)}</Text>
                  <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
                </AnimatedPressable>
              </Animated.View>
            ) : (
              <Animated.View
                style={styles.brushCard}
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
              >
                <View style={styles.brushHead}>
                  <Text style={styles.brushLabel}>{t('settings.eyedropperTolerance')}</Text>
                  <View style={styles.brushHeadRight}>
                    <Text style={styles.brushValue}>{Math.round(eyeTol)}</Text>
                    {settings.loupeMode === 'adjust' && (
                      <AnimatedPressable
                        style={styles.panelCollapseBtn}
                        onPress={() => setZoomCompact(true)}
                        pressedScale={0.9}
                      >
                        <Icon name="unfold-less" size={15} color="#FFF" />
                      </AnimatedPressable>
                    )}
                  </View>
                </View>
                <Slider
                  style={styles.brushSlider}
                  minimumValue={0}
                  maximumValue={100}
                  value={eyeTol}
                  onSlidingStart={() => { uiInteractingRef.current = true; }}
                  onValueChange={setEyeTol}
                  onSlidingComplete={() => { uiInteractingRef.current = false; }}
                  minimumTrackTintColor={IOS.blue}
                  maximumTrackTintColor="rgba(255,255,255,0.28)"
                  thumbTintColor="#FFF"
                />
              </Animated.View>
            )}
          </View>
        )}

        {/* ブラシの太さ。透過強度が開いている間は出さない（同じ場所を使うため）。
            ペン/スポイト等のツール切替と同じで、常にどちらか一方だけが出る。 */}
        {appMode === 'restore' && !retransOpen && !chromeHidden && (
          <View style={styles.panelSlot} pointerEvents="box-none">
            {panelCompact ? (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                <AnimatedPressable
                  style={styles.zoomCompactBtn}
                  onPress={() => setZoomCompact(false)}
                  pressedScale={0.94}
                >
                  <Icon name="brush" size={14} color="#FFF" />
                  <Text style={styles.zoomCompactTxt}>{Math.round(brushPx)}px</Text>
                  <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
                </AnimatedPressable>
              </Animated.View>
            ) : (
              <Animated.View
                style={styles.brushCard}
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
              >
                <View style={styles.brushHead}>
                  <Text style={styles.brushLabel}>{t('editor.brushSize')}</Text>
                  <View style={styles.brushHeadRight}>
                    <Text style={styles.brushValue}>{Math.round(brushPx)}px</Text>
                    {/* 元画像の透かし。消えた範囲を確認しながら塗るためのもの。 */}
                    {ghostImage && (
                      <AnimatedPressable
                        style={[styles.ghostBtn, ghostOn && styles.ghostBtnOn]}
                        onPress={() => setGhostOn(v => !v)}
                        pressedScale={0.9}
                      >
                        <Icon name="layers" size={16} color="#FFF" />
                        <Text style={styles.ghostBtnTxt}>{t('editor.ghost')}</Text>
                      </AnimatedPressable>
                    )}
                    {settings.loupeMode === 'adjust' && (
                      <AnimatedPressable
                        style={styles.panelCollapseBtn}
                        onPress={() => setZoomCompact(true)}
                        pressedScale={0.9}
                      >
                        <Icon name="unfold-less" size={15} color="#FFF" />
                      </AnimatedPressable>
                    )}
                  </View>
                </View>
                <Slider
                  style={styles.brushSlider}
                  minimumValue={BRUSH_MIN_PX}
                  maximumValue={BRUSH_MAX_PX}
                  value={brushPx}
                  // ② スライダーに触れた時点で、描きかけの軌跡を必ず捨てる。
                  // 残したままサイズだけ変えると、古いタッチ座標に新しい太さの
                  // プレビューが出て「変な場所に出る」状態になる。
                  onSlidingStart={() => {
                    uiInteractingRef.current = true;
                    discardStroke();
                    setBrushSliding(true);
                  }}
                  onValueChange={setBrushPx}
                  onSlidingComplete={() => {
                    uiInteractingRef.current = false;
                    setBrushSliding(false);
                    // 奪い合いの隙間で入った軌跡が残らないよう、最後にもう一度捨てる。
                    discardStroke();
                  }}
                  minimumTrackTintColor={IOS.blue}
                  maximumTrackTintColor="rgba(255,255,255,0.28)"
                  thumbTintColor="#FFF"
                />
              </Animated.View>
            )}
          </View>
        )}

        {/* レティクルの実寸表示。ルーペの中の照準と対になる、等倍キャンバス側の印。
            画面中央固定（reticleFixed）なので純粋な表示専用、操作は受けない。 */}
        {mainReticlePos && (
          <View
            pointerEvents="none"
            style={[styles.mainReticle, {
              left: mainReticlePos.x - MAIN_RETICLE_R,
              top: mainReticlePos.y - MAIN_RETICLE_R,
            }]}
          >
            {/* 十字＋中心ドットだけにする。以前あった固定サイズの丸（mrRing）は
                実際のブラシ半径と連動しない飾りで、「何を表しているのか
                分からない緑の円」だったため削除した。実際に塗る範囲を示す
                緑の縁は、ルーペ内（TouchLoupe の reticle、brushRadius で
                半径が決まる）の方にだけ出す。
                十字の腕は白地に暗い縁取り（borderWidth）を入れて、明るい絵の
                上でも暗い絵の上でも輪郭が消えないようにしてある。 */}
            <View style={[styles.mrArmH, styles.mrArmLeft]} />
            <View style={[styles.mrArmH, styles.mrArmRight]} />
            <View style={[styles.mrArmV, styles.mrArmTop]} />
            <View style={[styles.mrArmV, styles.mrArmBottom]} />
            <View style={styles.mrDot} />
          </View>
        )}

        {/* ポリゴン連番バッジ。位置は PolyBadge 内部で zoomSV から直接計算する
            （パン中も塗り・輪郭と同じなめらかさで追従させるため）。
            ルーペ（この下）より先に描く — 後から描く方が上に乗るので、
            バッジがルーペの上に透けて見えないよう、ここで先に描いておく。 */}
        {labelCentroids.map((c, idx) => (
          <PolyBadge
            key={polygons[idx].id}
            cxImg={c[0]} cyImg={c[1]} ds={ds} zoomSV={zoomSV}
            selected={polygons[idx].id === selectedId}
            label={idx + 1}
          />
        ))}

        {/* ルーペ。'fixed' モードでは従来どおりドラッグ中だけ出す。
            'adjust' モードは常時出しておく。reticleFixed（スポイト・四角追加）中は
            レティクルが画面中央固定なので、ルーペが映す位置も loupe.touch では
            なく毎回キャンバス中央（＝ zoom 状態）から直接計算する。触っていない
            間の loupe.img は使わない。それ以外（復元ブラシ）は最後に触れた場所。 */}
        {!chromeHidden && (
          <TouchLoupe
            image={skImage}
            ds={ds}
            point={
              reticleFixed
                ? (canvasSize.w > 0 && canvasSize.h > 0
                  ? localToImage(canvasSize.w / 2, canvasSize.h / 2, zoom)
                  : null)
                // 'fixed' 設定でも常時表示にする（触っていない間はキャンバス
                // 中央を映す）。以前は 'adjust' の時だけ常時表示にしていたが、
                // 「固定レティクルの時も常に表示してほしい」というフィード
                // バックを受けて、設定に関わらず常時表示に揃えた。
                : (loupe?.img ?? (
                  moveNudgePoint ?? (
                    canvasSize.w > 0 && canvasSize.h > 0
                      ? localToImage(canvasSize.w / 2, canvasSize.h / 2, zoom)
                      : null
                  )
                ))
            }
            touch={loupe?.touch ?? null}
            canvasW={canvasSize.w}
            canvasH={canvasSize.h}
            // reticleFixed 中はルーペの中身を zoomSV から直接(UIスレッドで)
            // 追従させ、React の再レンダーを挟まない。メインキャンバスの
            // パンと完全に同じなめらかさになる（詳しくは TouchLoupe 参照）。
            panZoomSV={reticleFixed ? zoomSV : undefined}
            checkerImage={bgMode === 'checker' ? checkerImage : null}
            checkerTile={CHECKER_TILE}
            brushRadius={appMode === 'restore' ? brushRadius : undefined}
            strokePoints={appMode === 'restore' ? strokePts : undefined}
            size={loupeSize}
            topOffset={loupeTopOffset}
            fullWidth={loupeIsAdjust}
            // move モードはハンドルを直接つまむ操作が基本だが、十字ボタンは
            // 常時出しておく（moveSelectEnabled）。頂点未選択の間は
            // 「レティクル（中央固定）を狙いに合わせるためのパン」として
            // 働かせ（nudgeReticle）、頂点選択後だけその頂点をドット単位に
            // 動かす（nudgeSelection）よう切り替える。頂点未選択のまま
            // 押しても何もしない仕様だと、スポイト等と違って十字が反応せず
            // 壊れて見える、という指摘への対応。
            onNudge={
              reticleFixed ? nudgeReticle
                : (moveSelectEnabled ? (moveNudgeEnabled ? nudgeSelection : nudgeReticle) : undefined)
            }
            // move モードの決定はトグル。何も選択していなければ「レティクルに
            // 一番近い頂点／ポリゴンを選ぶ」、既に選択中なら「解除する」。
            // 頂点ハンドルを直接タップする代わりに、パン(1本指/2本指どちらも)
            // で狙いを合わせてから押す — ズームで拡大していて小さな丸を
            // 正確にタップしにくい時の代替手段。
            onDecide={
              appMode === 'move'
                ? (moveSelectEnabled ? decideMoveSelect : undefined)
                : (loupeIsAdjust ? decideAtReticle : undefined)
            }
            decideActive={
              appMode === 'restore' ? restoreRecording
                : (appMode === 'move' ? selectedVertexIdx != null : false)
            }
            decideActiveKind={appMode === 'move' ? 'selected' : 'recording'}
            dpadBottom={loupeIsAdjust || moveSelectEnabled ? dpadBottom : undefined}
            dockLevel={loupeDockLevel}
            onDockLevelChange={setLoupeDockLevel}
          />
        )}

        {/* 一言フィードバック。操作の結果を必ず言葉で返す。 */}
        {toast && (
          <View style={styles.toastWrap} pointerEvents="none">
            <Text style={styles.toastTxt}>{toast}</Text>
          </View>
        )}

        {/* スポイト処理中の全面ブロック。処理は同期的に JS を止めるので、
            eyeBusy の描画が確定してから実処理に入る（下の useEffect が担保）。 */}
        {eyeBusy && (
          <View style={styles.busyOverlay}>
            <View style={styles.busyCard}>
              <ActivityIndicator color="#FFF" />
              <Text style={styles.busyTxt}>{t(busyKey)}</Text>
            </View>
          </View>
        )}

        {/* 現在のツールの説明。常時出す。
            アイコンだけだと何のツールか分からず、移動モードでは何も出ていなくて
            画面が寂しかったので、3モードとも「名前＋やること」を1行で示す。*/}
        {!chromeHidden && (
          <ToolHint
            icon={TOOL_HINTS[appMode].icon}
            title={t(TOOL_HINTS[appMode].titleKey)}
            desc={t(TOOL_HINTS[appMode].descKey)}
            // ズームは右端へ移したので、下端は説明とブラシ設定だけになった。
            bottom={12}
          />
        )}

        {/* ── フローティング上部: ズーム + ツール ──
            ルーペの収納段階（loupeDockLevel）に応じて位置・並び方向を
            丸ごと切り替える（詳しくは topClusterStyle 参照）。 */}
        <View
          style={[styles.floatingTop, topClusterStyle]}
          pointerEvents="box-none"
        >
          {/* ルーペを大きく見せたい時、ズームバーを畳んでコンパクトなボタン
              1個にする。ドロップダウンの上に重ねて出す（zoomCompactCol 参照）
              ので、ここでは畳んでいる間は描かない。 */}
          {!chromeHidden && !zoomCompact && (
            <Animated.View
              // dockLevel が変わるたびに作り直す。表示したままルーペを
              // 縮めると、スライダー(ネイティブ側)の幅が古いまま残って
              // 左へはみ出て見える不具合があったため、確実に測り直させる
              // ために key でマウントし直す（style だけの更新だと
              // ネイティブ側の再計測が追いつかないことがある）。
              key={loupeDockLevel}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              style={[styles.zoomTopRow, zoomTopRowStyle]}
            >
              <Text style={styles.zoomBadgeTxt}>×{sliderToZoom(sliderV).toFixed(1)}</Text>
              <View style={styles.zoomSliderWrap}>
                {/* 目盛り。どこが ×1/×2/×4/×8/×16/×24 かを示す。 */}
                <View style={styles.zoomTicks} pointerEvents="none">
                  {ZOOM_PRESETS.map(p => (
                    <View key={p} style={[styles.zoomTickCol, { left: `${zoomToSlider(p) * 100}%` }]}>
                      <View style={styles.zoomTick} />
                      <Text style={styles.zoomTickTxt}>{p}</Text>
                    </View>
                  ))}
                </View>
                <Slider
                  style={styles.zoomSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={sliderV}
                  onSlidingStart={() => {
                    zoomDraggingRef.current = true;
                    uiInteractingRef.current = true;
                    discardStroke();
                  }}
                  onValueChange={v => {
                    setSliderV(v);
                    setZoomScale(sliderToZoom(v));
                  }}
                  onSlidingComplete={v => {
                    const near = ZOOM_PRESETS.find(
                      p => Math.abs(zoomToSlider(p) - v) <= ZOOM_SNAP_R);
                    const finalV = near !== undefined ? zoomToSlider(near) : v;
                    setSliderV(finalV);
                    setZoomScale(near !== undefined ? near : sliderToZoom(v));
                    zoomDraggingRef.current = false;
                    uiInteractingRef.current = false;
                    discardStroke();
                    commitZoom();
                  }}
                  minimumTrackTintColor={IOS.blue}
                  maximumTrackTintColor="rgba(255,255,255,0.28)"
                  thumbTintColor="#FFF"
                />
              </View>
              <AnimatedPressable style={styles.zoomResetBtn} onPress={resetZoom} pressedScale={0.9}>
                <Icon name="refresh" size={17} color="#FFF" />
              </AnimatedPressable>
              {/* ズームバーを畳んでルーペを大きく見せる（ルーペが大サイズの時のみ）。 */}
              {loupeDockLevel === 0 && (
                <AnimatedPressable
                  style={styles.zoomResetBtn}
                  onPress={() => setZoomCompact(true)}
                  pressedScale={0.9}
                >
                  <Icon name="unfold-less" size={17} color="#FFF" />
                </AnimatedPressable>
              )}
            </Animated.View>
          )}
          {/* ── ツールメニュー（右端）──
            常時6個並べると編集領域を食うので、普段は選択中の1個だけを出す。
            アイコンの下の矢印が「押すと他のツールが出る」ことを示す。
            選ぶと閉じて、そのツールのアイコンに変わる。 */}
          <View style={styles.zoomCompactCol} pointerEvents="box-none">
            {/* 畳んだ時のズームバッジ。ドロップダウンの真上に出す。押すと元の
                フルサイズのズームバーへ戻る（zoomTopRow 側の畳むボタンと対）。 */}
            {!chromeHidden && zoomCompact && (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                <AnimatedPressable
                  style={styles.zoomCompactBtn}
                  onPress={() => setZoomCompact(false)}
                  pressedScale={0.94}
                >
                  <Text style={styles.zoomCompactTxt}>×{sliderToZoom(sliderV).toFixed(1)}</Text>
                  <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
                </AnimatedPressable>
              </Animated.View>
            )}
          <View style={styles.toolDropdown} pointerEvents="box-none">
            {/* 現在のツール。押すと展開する。 */}
            <AnimatedPressable
              style={[styles.floatBtn, styles.floatBtnActive]}
              disabled={eyeBusy}
              onPress={() => setToolMenuOpen(o => !o)}
            >
              <Icon name={TOOL_HINTS[appMode].icon} size={22} color="#FFF" />
              <Icon
                name={toolMenuOpen ? 'arrow-drop-up' : 'arrow-drop-down'}
                size={14}
                color="#FFF"
                style={styles.floatCaret}
              />
            </AnimatedPressable>

            {toolMenuOpen && (
              <Animated.View
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
                style={styles.toolDropdownExpanded}
              >
                {(['draw', 'move', 'eyedropper', ...(onRestore ? ['restore'] as const : [])] as AppMode[])
                  .filter(m => m !== appMode)
                  .map(m => (
                    <AnimatedPressable
                      key={m}
                      style={styles.floatBtn}
                      disabled={eyeBusy}
                      onPress={() => {
                        setAppMode(m);
                        setRetransOpen(false);
                        setToolMenuOpen(false);
                      }}
                    >
                      <Icon name={TOOL_HINTS[m].icon} size={22} color="#FFF" />
                    </AnimatedPressable>
                  ))}

                <View style={styles.floatDivider} />

                {/* 下地の切替。まず現在の下地のアイコンだけを出し、押したら選べる。
                  3つ常時並べると縦に伸びるうえ、普段は変えないものなので畳んでおく。 */}
                <AnimatedPressable
                  style={[styles.floatBtn, bgPickerOpen && styles.floatBtnActive]}
                  onPress={() => setBgPickerOpen(o => !o)}
                  pressedScale={0.9}
                >
                  <Icon name={BG_ICONS[bgMode]} size={20} color="#FFF" />
                </AnimatedPressable>
                {bgPickerOpen && (
                  <View style={styles.bgColumn}>
                    {(['checker', 'white', 'black'] as const).map(mode => (
                      <AnimatedPressable
                        key={mode}
                        style={[styles.bgDot, bgMode === mode && styles.bgDotOn]}
                        onPress={() => { setBgMode(mode); setBgPickerOpen(false); }}
                        pressedScale={0.9}
                      >
                        <Icon name={BG_ICONS[mode]} size={16} color="#FFF" />
                      </AnimatedPressable>
                    ))}
                  </View>
                )}

                {/* 再透過（セル編集の時だけ親から渡される）。 */}
                {onRetransparent && (
                  <AnimatedPressable
                    style={[styles.floatBtn, retransOpen && styles.floatBtnActive]}
                    disabled={eyeBusy}
                    onPress={() => {
                      const next = !retransOpen;
                      setRetransOpen(next);
                      setChromeHidden(false);
                      // 下部パネルを共有しているので、開くときは復元ブラシから抜ける。
                      if (next && appMode === 'restore') setAppMode('move');
                      setToolMenuOpen(false);
                    }}
                  >
                    <Icon name="tune" size={22} color="#FFF" />
                  </AnimatedPressable>
                )}

                {/* 重なっているものを一時的に全部隠す。画像の端を直す時の逃げ道。 */}
                <AnimatedPressable
                  style={[styles.floatBtn, chromeHidden && styles.floatBtnActive]}
                  disabled={eyeBusy}
                  onPress={() => { setChromeHidden(h => !h); setToolMenuOpen(false); }}
                >
                  <Icon name={chromeHidden ? 'visibility' : 'visibility-off'} size={22} color="#FFF" />
                </AnimatedPressable>
              </Animated.View>
            )}
          </View>
          </View>
        </View>


      </View>

      {/* ── 下部コントロールバー: undo / redo / 削除 / 保存 ── */}
      <View style={styles.bar}>
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={eyeBusy || (past.length === 0 && !canUndoEdit)}
          onPress={handleUndo}
        >
          <Icon name="undo" size={24} color={IOS.label} />
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={eyeBusy || (future.length === 0 && !canRedoEdit)}
          onPress={handleRedo}
        >
          <Icon name="redo" size={24} color={IOS.label} />
        </AnimatedPressable>
        {/* 削除ボタン: 頂点選択中=頂点削除 / ポリゴン選択中=ポリゴン削除 / 未選択=非活性 */}
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={eyeBusy || selectedId === null}
          onPress={deleteSelected}
        >
          <Icon name="delete" size={24} color={selectedId !== null ? IOS.red : IOS.label} />
        </AnimatedPressable>
        {/* リセット: ポリゴンもスポイトも入場時に戻す（確認ダイアログあり）。
            戻すものが何も無い時は非活性。 */}
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={eyeBusy || (polygons.length === 0 && past.length === 0)}
          onPress={handleReset}
        >
          <Icon name="refresh" size={24} color={IOS.label} />
        </AnimatedPressable>
        {/* プレビューボタン: ポリゴンが 1 枚以上ある時だけ活性 */}
        <AnimatedPressable
          style={styles.exportBtn}
          disabled={!canPreview}
          onPress={handlePreview}
          pressedScale={0.96}
        >
          <Icon name="preview" size={20} color="#FFF" />
          <Text style={styles.exportBtnTxt}>{t('common.preview')}</Text>
          {polygons.length > 0 && (
            <View style={styles.exportBadge}>
              <Text style={styles.exportBadgeTxt}>{polygons.length}</Text>
            </View>
          )}
        </AnimatedPressable>
      </View>

      {/* 元画像ズーム（分割結果と同じヘッダー挙動）*/}
      {originalImageUri ? (
        <ImageZoomModal visible={zoomVisible} uri={originalImageUri} onClose={() => setZoomVisible(false)} />
      ) : null}
    </Screen>
  );
}

// ── スタイル (iOS デザイン) ──────────────────────────────────────────────────

// iOS システムカラー
const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  red:       '#FF3B30',
  label:     '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  fill:      '#E5E5EA',
} as const;

const BAR_H = 72; // Safe area の余裕を含めた高さ

const styles = StyleSheet.create({
  // エラー表示専用ルート（画像読み込み失敗時のみ使用）
  root:  { flex: 1, backgroundColor: '#000' },
  error: { color: IOS.red, fontSize: 15, fontWeight: '400', margin: 20, textAlign: 'center' },

  // 下地切替 Segmented ボタン群（SettingsScreen の presetBtn と同じ構造）
  bgSegmented: {
    flexDirection: 'row',
    backgroundColor: IOS.fill,
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  bgSegBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  bgSegBtnOn: {
    backgroundColor: IOS.card,
    // 選択中はカード色で浮き上がらせる（iOS Segmented Control 準拠）
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  bgSegTxt: {
    fontSize: 11,
    fontWeight: '500',
    color: IOS.secondary,
  },
  bgSegTxtOn: {
    color: IOS.label,
    fontWeight: '600',
  },

  // ── キャンバスエリア ─────────────────────────────────────────────────────────
  // 下地は Canvas 内の Rect で描くため、View 自体は黒固定から解放する。
  // 'transparent' にすると SafeAreaView の黒が透過して見えてしまうため
  // Skia 側の下地と同じ初期色（市松の暗い方）に近い #888 を設定する。
  // ただし Skia Canvas が全面を覆うので View の色は視認されない。
  canvasArea: {
    flex: 1,
    backgroundColor: '#888',
    overflow: 'hidden',
  },

  // スポイトのタップ波紋。サイズは静的にして transform だけ動かす（白化対策）。
  eyeRipple: {
    position: 'absolute',
    width: EYE_RIPPLE_R * 2,
    height: EYE_RIPPLE_R * 2,
    borderRadius: EYE_RIPPLE_R,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  // レティクルの実寸マーカー。ルーペ内の照準と同じ色味の輪。
  // 実寸レティクル。中身は十字4本＋リング＋中心ドットを絶対配置で組む。
  mainReticle: {
    position: 'absolute',
    width: MAIN_RETICLE_R * 2,
    height: MAIN_RETICLE_R * 2,
  },
  // 十字の腕。白地＋暗い縁取りで、どんな絵の上でも輪郭が飛ばないようにする。
  mrArmH: {
    position: 'absolute',
    width: MR_ARM,
    height: MR_TH,
    top: MAIN_RETICLE_R - MR_TH / 2,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.55)',
  },
  mrArmV: {
    position: 'absolute',
    width: MR_TH,
    height: MR_ARM,
    left: MAIN_RETICLE_R - MR_TH / 2,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.55)',
  },
  mrArmLeft:   { left: 0 },
  mrArmRight:  { left: MAIN_RETICLE_R * 2 - MR_ARM },
  mrArmTop:    { top: 0 },
  mrArmBottom: { top: MAIN_RETICLE_R * 2 - MR_ARM },
  // 中心ドット。実際に編集される1点をピンポイントで示す。
  mrDot: {
    position: 'absolute',
    left: MAIN_RETICLE_R - 2,
    top:  MAIN_RETICLE_R - 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(52,199,89,1)',
  },

  // ポリゴン番号バッジ
  badge: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 0.5, borderColor: IOS.separator,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeSelected: {
    backgroundColor: IOS.blue,
    borderColor: IOS.blue,
  },
  badgeTxt: { fontSize: 12, fontWeight: '600', color: IOS.label },
  // ↑ badgeSelected 時はテキスト色を白に上書き（React Native は最後の style が優先）

  // 下地切替を右上に浮かせるコンテナ
  floatingTop: {
    position:  'absolute',
    left:      8,
    right:     8,
    top:       8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 8,
  },

  // ── ツールドロップダウン ────────────────────────────────────────────────
  toolDropdown: {
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
    padding: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(30,30,30,0.78)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  // 展開時の中身をまとめる箱。fade in/out アニメーションの対象にするため
  // Fragment ではなく1つの Animated.View にする。レイアウトは toolDropdown
  // の子だった時と同じになるよう gap/alignItems を揃えてある。
  toolDropdownExpanded: {
    alignItems: 'center',
    gap: 6,
  },
  // ツールドロップダウンの列。ズームバーを畳んだ時だけ、その上にバッジを重ねる。
  zoomCompactCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  zoomCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(30,30,30,0.78)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  zoomCompactTxt: {
    color: '#FFF',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  // ブラシ太さ/スポイト許容値パネルを畳むボタン。zoomResetBtn と同じ見た目。
  panelCollapseBtn: {
    width: 26, height: 26,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  floatBtn: {
    width: 34, height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(30,30,30,0.72)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  // 現在のツールの下に出す小さな矢印。「押すと他のツールが出る」ことを示す。
  bgColumn: {
    alignItems: 'center',
    gap: 4,
  },
  bgDot: {
    width: 36, height: 28,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(30,30,30,0.72)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  bgDotOn: { backgroundColor: IOS.blue, borderColor: IOS.blue },
  floatCaret: {
    position: 'absolute',
    bottom: -1,
  },
  floatBtnActive: {
    backgroundColor: IOS.blue,
    borderColor: IOS.blue,
  },
  floatBtnDelete: {
    backgroundColor: 'rgba(255,59,48,0.80)',
    borderColor: IOS.red,
  },
  floatBtnDisabled: { opacity: 0.3 },
  floatBtnTxt: { fontSize: 20, color: '#FFF' },

  // 右カラム内の区切り（ツール群とズームの間）。
  floatDivider: {
    width: 28,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginVertical: 2,
  },
  // ── 上部のズーム行（倍率 + スライダー + 全体表示）────────────────────────
  zoomTopRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(30,30,30,0.78)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  zoomSliderWrap: {
    // 余白を埋めるのはスライダー領域だけ。倍率・リセット・ツールは固定幅。
    flex: 1,
    minWidth: 80,
    height: 34,
    justifyContent: 'center',
  },
  zoomSlider: { width: '100%', height: 30 },
  // 目盛り。トラックの下に細い線と数字を置く。
  // つまみ半径ぶんトラックが内側に寄るので、左右に同じだけ余白を取る。
  zoomTicks: {
    position: 'absolute',
    left: 10, right: 10,
    bottom: 0, height: 12,
  },
  zoomTickCol: {
    position: 'absolute',
    alignItems: 'center',
    marginLeft: -6,
    width: 12,
  },
  zoomTick: {
    width: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  zoomTickTxt: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 8,
    lineHeight: 9,
  },
  zoomResetBtn: {
    width: 30, height: 30,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  // ── 倍率バッジ ────────────────────────────────────────────────────────────
  zoomBadgeTxt: {
    color: '#FFF',
    fontSize: 12,
    minWidth: 38,
    fontVariant: ['tabular-nums'],  // 倍率が動いても幅が揺れないようにする
  },
  // ── 透過強度パネル（セル編集のみ）─────────────────────────────────────────
  /**
   * 下部パネルの置き場。透過強度とブラシの太さが交代で使う。
   * 2つを別々の場所に出すと画面が混み合ううえ、同時に出ると
   * どちらを触っているのか分からなくなるため、1箇所に集約して排他にする。
   */
  panelSlot: {
    position: 'absolute',
    left: 12, right: 12, bottom: 58,
    alignItems: 'center',
  },
  retransCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(30,30,30,0.86)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 6,
  },
  retransHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  retransHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  retransTitle: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  retransValue: { color: '#FFF', fontSize: 13, fontVariant: ['tabular-nums'] },
  retransRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  retransSlider: { flex: 1, height: 30 },
  retransEnd: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  retransApply: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: IOS.blue,
    borderRadius: 10,
    paddingVertical: 8,
  },
  retransApplyTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  // ── 復元ブラシ ────────────────────────────────────────────────────────────
  // ブラシサイズ調整中に中央へ出す実寸の円。
  brushGaugeWrap: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  brushGauge: {
    backgroundColor: 'rgba(52,199,89,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(52,199,89,0.9)',
  },
  brushCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(30,30,30,0.86)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  brushHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brushHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  ghostBtnOn: { backgroundColor: IOS.blue },
  ghostBtnTxt: { color: '#FFF', fontSize: 11 },
  brushLabel: { color: '#FFF', fontSize: 12 },
  brushValue: { color: '#FFF', fontSize: 13, fontVariant: ['tabular-nums'] },
  brushSlider: { width: '100%', height: 30 },

  // ── 一言フィードバック ────────────────────────────────────────────────────
  toastWrap: {
    position: 'absolute',
    left: 0, right: 0,
    // ツール説明やブラシ設定と重ならないよう、画面の中ほどに出す。
    top: '46%',
    alignItems: 'center',
  },
  toastTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(20,20,20,0.86)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    overflow: 'hidden',
  },

  // ── スポイト処理中のブロック表示 ──────────────────────────────────────────
  busyOverlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  busyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(30,30,30,0.92)',
    paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 14,
  },
  busyTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },



  // draw モードのオーバーレイヒント（iOS のトースト風）


  // ── 下部コントロールバー（undo/redo/削除/保存）─────────────────────────────
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: IOS.card,
    borderTopWidth: 0.5,
    borderTopColor: IOS.separator,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  barIconBtn: {
    width: 44, height: 44,
    borderRadius: 12,
    backgroundColor: IOS.fill,
    borderWidth: 0.5, borderColor: IOS.separator,
    alignItems: 'center', justifyContent: 'center',
  },
  barIconBtnDisabled: { opacity: 0.3 },



  // 書き出しボタン（大きめ・全幅）
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    backgroundColor: IOS.blue,
    borderRadius: 14,
    gap: 8,
  },
  exportBtnDisabled: { opacity: 0.35 },
  exportBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },

  // 枚数バッジ（白地・青テキスト）
  exportBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  exportBadgeTxt: { fontSize: 11, fontWeight: '600', color: '#FFF' },
});
