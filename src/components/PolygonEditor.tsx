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
  // 画面状態の AppState 型と名前がぶつかるので別名で入れる（App.tsx と同じ流儀）。
  AppState as RNAppState,
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
import TouchLoupe, { LOUPE_MAGNIFY } from './ui/TouchLoupe';
import type { DockLevel } from './ui/TouchLoupe';
import { LOUPE_MEDIUM_RATIO, LOUPE_MINI_RATIO, LOUPE_MINI_MIN } from './ui/LoupeSizeSlider';
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
import { BRUSH_MAX_PX, BRUSH_MIN_PX, LOUPE_MODE_ICONS, type ThumbBg } from '../settings/store';
import { useSettings } from '../settings/SettingsContext';
import { useStats } from '../stats/StatsContext';
// イラスト輪郭切り抜きでは直線スナップの利得が小さく点が飛ぶ副作用が大きいため除去した。

// ── 定数 ───────────────────────────────────────────────────────────────────

/** 四角の初期サイズ: 画像短辺の何割か */
const RECT_RATIO     = 0.30;
/**
 * 最小倍率。全体を見渡しやすいよう、等倍未満まで縮小できるようにしてある。
 * 0.1 未満にすると画像が数px四方まで潰れて操作の焦点が合わせづらくなるため、
 * このあたりを下限にした。
 */
const ZOOM_MIN       = 0.1;
/**
 * 最大倍率。復元ブラシで1px単位を直すには 12 倍でも足りないため 24 倍まで上げた。
 * 32倍以上は画素が大きくなりすぎて指での位置合わせと移動がかえって難しくなる。
 *
 * 倍率は描画の変換行列を変えるだけなので、上げても描画コストは増えない
 * （画像テクスチャは同じものを使い回す）。
 */
const ZOOM_MAX       = 24;
/** 倍率プリセット。スライダーの目盛りと、離した時の吸い付き先を兼ねる。 */
const ZOOM_PRESETS   = [0.1, 1, 2, 4, 8, 16, 24] as const;

/**
 * 倍率 ↔ スライダー位置(0〜1) の変換。
 *
 * 線形に並べると、実用上いちばん使う ×1〜×4 がトラックの左 1/4 に潰れてしまう。
 * 対数にすると ×1→×2→×4→×8 が等間隔になり、どの倍率帯でも同じ感覚で動かせる。
 *
 * ×0.1〜×1 と ×1〜×24 を単純に対数一本で繋ぐと、桁数の少ない ×0.1〜×1 側が
 * トラックの左側を必要以上に広く占めてしまい、よく使う ×1〜×24 側が窮屈になる。
 * そこで区間を分け、「全体表示用」の ×0.1〜×1 には ZOOM_LOW_FRAC ぶんだけを割り当て、
 * 残りを従来どおり ×1〜×24 に使う。
 */
const ZOOM_LOW_FRAC = 0.12;
const zoomToSlider = (scale: number) =>
  scale <= 1
    ? ZOOM_LOW_FRAC * (Math.log2(scale / ZOOM_MIN) / Math.log2(1 / ZOOM_MIN))
    : ZOOM_LOW_FRAC + (1 - ZOOM_LOW_FRAC) * (Math.log2(scale) / Math.log2(ZOOM_MAX));
const sliderToZoom = (v: number) =>
  v <= ZOOM_LOW_FRAC
    ? ZOOM_MIN * Math.pow(1 / ZOOM_MIN, v / ZOOM_LOW_FRAC)
    : Math.pow(ZOOM_MAX, (v - ZOOM_LOW_FRAC) / (1 - ZOOM_LOW_FRAC));
/** 倍率表示用の文字列。切りのいい整数は小数点を付けず、それ以外だけ小数点1桁にする。 */
const formatZoom = (scale: number) =>
  Number.isInteger(Math.round(scale * 10) / 10)
    ? String(Math.round(scale))
    : scale.toFixed(1);
/** 目盛りにこの距離（スライダー位置の単位）まで近ければ、指を離した時に吸い付く。 */
const ZOOM_SNAP_R    = 0.035;
// キャンバスの余白（表示px）。画像が枠にぴったり付いて窮屈だったので全体的に広げた。
// 上は下地切替(市松/白/黒)のセグメント、右はフローティングボタン、
// 下はツール説明のピルが乗るので、その分も見込んで確保する。
const PAD_L = 32; // 左余白
const PAD_R = 32; // 右余白（ツール群がコンパクト化され移動もできるようになったため左と揃える）
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
/**
 * undo 履歴（past）の保持件数上限。無制限に積むとメモリを圧迫するため設ける
 * 内部的な安全弁で、利用者向けの設定項目にはしていない（触る人がほぼいない
 * 上級者向けの数値のため）。将来「詳細設定」的な区画ができたら露出を検討する。
 */
const UNDO_HISTORY_LIMIT = 50;

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
  | 'drag_reticle' // 'drag' 設定: レティクル(編集位置)を指ドラッグ中
  | 'drag_vertex_free' // 'drag' 設定: 選択済みの頂点をどこでもドラッグで動かす中
  | 'drag_poly_free'   // 'drag' 設定: 選択済みのブロックをどこでもドラッグで動かす中
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
   *
   * scope を渡すと、セル全体ではなくその範囲だけを元画像から作り直す。
   * 省略時（範囲を選ばなかった／選択が無い）は従来どおりセル全体。
   * 「選択範囲だけ再透過」— 対象を絞ることで計算量が減って速く、無関係な
   * 部分を壊さずに済む。
   *   minX/minY/maxX/maxY: 対象の外接矩形に少し余白を足したもの
   *     （このエディタの表示座標系＝画像座標系）。フラッドフィルの
   *     処理範囲（＝起点の四隅）を決めるためだけに使う。
   *   maskPoints: 実際にその結果を貼り戻す範囲（多角形）。ポリゴン選択
   *     ならそのポリゴンの頂点列、ブラシで囲んだ選択ならなぞった軌跡を
   *     閉じた多角形として渡す。矩形の四隅は背景を探すための起点に
   *     過ぎず、実際に変化するのはこの多角形の内側だけ。
   */
  onRetransparent?: (tolerance: number, scope?: {
    minX: number; minY: number; maxX: number; maxY: number;
    maskPoints?: Array<[number, number]>;
  }) => void;
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
 * Douglas-Peucker法による折れ線の間引き。始点・終点は必ず残し、線分から
 * epsilon より離れた点だけを残す再帰分割。points は開いた折れ線として扱う
 * （閉じたなぞり軌跡を間引きたい場合は呼び出し側で始点を末尾に複製してから
 * 渡し、間引いた結果からその複製分を取り除く。simplifyClosedTrace 参照）。
 */
function douglasPeucker(points: [number, number][], epsilon: number): [number, number][] {
  const end = points.length - 1;
  if (end < 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[end];
  for (let i = 1; i < end; i++) {
    const d = distPointToSegment(points[i][0], points[i][1], ax, ay, bx, by);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= epsilon) return [points[0], points[end]];
  const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
  const right = douglasPeucker(points.slice(maxIdx), epsilon);
  return left.slice(0, -1).concat(right);
}

/**
 * なぞって作った軌跡（数百点になりうる）を、頂点をドラッグ調整できる程度の
 * 数（既定48点）まで間引いてから通常のポリゴンとして扱う。
 *
 * 生の軌跡をそのまま頂点にすると、後で頂点をつまんで調整するのが重く・
 * 難しくなる（画像編集アプリで「なぞって選択→簡略化→ポリゴン化」が一般的
 * なのはこのため）。epsilon（間引きの荒さ）をバイナリサーチで探り、
 * 目標頂点数以下になる最小の間引きを選ぶ。
 *
 * 軌跡は閉じた形として扱うため、始点を末尾に複製してから Douglas-Peucker に
 * 掛け、結果から複製した終点を取り除く。
 */
function simplifyClosedTrace(
  rawPoints: Array<[number, number]>,
  maxVertices = 48,
): Array<[number, number]> {
  if (rawPoints.length <= 3) return rawPoints;
  if (rawPoints.length <= maxVertices) return rawPoints;

  const closed = [...rawPoints, rawPoints[0]];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rawPoints) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;

  let lo = 0, hi = diag;
  let best: [number, number][] | null = null;
  // 20回のバイナリサーチで十分収束する（diag/2^20 まで epsilon を絞り込める）。
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const simplified = douglasPeucker(closed, mid);
    if (simplified.length - 1 > maxVertices) {
      lo = mid;
    } else {
      best = simplified;
      hi = mid;
    }
  }
  const result = (best ?? douglasPeucker(closed, hi)).slice(0, -1); // 複製した終点を除く
  return result.length >= 3 ? result : rawPoints;
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
// React.memo: 親(PolygonEditor)の再レンダリング時、px/py/ds/selected/zoomSV(参照安定)が
// 変わっていなければ再実行しない。位置計算自体は useDerivedValue で UI スレッド完結して
// いるため描画結果への影響はなく、無駄な関数本体の再実行だけを減らす。
const VertexHandle = React.memo(function VertexHandleImpl({
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
});
VertexHandle.displayName = 'VertexHandle';

/**
 * ポリゴン連番バッジ。VertexHandle と同じ理由で、位置を zoomSV から
 * 直接(UIスレッドで)計算する。こちらは Skia ではなく通常の RN View
 * （番号を文字で出すため）なので Animated.View + useAnimatedStyle を使う。
 */
// React.memo: VertexHandle と同じ理由（props不変時の無駄な再実行を防ぐだけで、
// useAnimatedStyle による位置追従は UI スレッド側で従来どおり動く）。
const PolyBadge = React.memo(function PolyBadgeImpl({
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
});
PolyBadge.displayName = 'PolyBadge';

// ── コンポーネント ──────────────────────────────────────────────────────────

export default function PolygonEditor({ bgResult, displayW, displayH, onPreview, onBack, initialPolygons, onPolygonsChange, onEyedrop, onUndoEdit, onRedoEdit, onResetEdits, onRetransparent, onRestore, baseRgba, cellTolerance, canUndoEdit, canRedoEdit, bgVersion = 0, onSettings, onHome, originalImageUri }: Props) {
  const { t } = useT();

  const { settings, updateSettings } = useSettings();
  // addRect など、PanResponder のクロージャから直接名前で呼ばれる useCallback の
  // 中で settings の最新値を読むための ref（settings 自体を deps に入れると
  // useCallback は作り直されるが、PanResponder 側は最初に作った時の関数を
  // 名前で握ったままなので、作り直された方には辿り着けない。reticleFixedRef
  // などと同じ理由）。
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ── 作業時間（目安）計測 ─────────────────────────────────────────────────────
  // 「編集画面を開いていた時間」の合計を統計に加算する。厳密に「操作していた時間」
  // ではないため、放置・離席分も含まれ得る（設定画面には「作業時間（目安）」として出す）。
  // アプリがバックグラウンドに回っている間（他アプリ利用・ロック中）は計測を止めることで、
  // 「席を外して他のアプリを使う」ケースだけは実用的な精度で除外できる。
  const { addWorkTimeMs } = useStats();
  useEffect(() => {
    let segmentStart: number | null = Date.now();
    const flush = () => {
      if (segmentStart == null) return;
      addWorkTimeMs(Date.now() - segmentStart);
      segmentStart = null;
    };
    const sub = RNAppState.addEventListener('change', next => {
      if (next === 'active') {
        segmentStart = Date.now();
      } else {
        flush();
      }
    });
    return () => {
      flush();
      sub.remove();
    };
    // マウント〜アンマウントの1回だけ購読する（addWorkTimeMs は StatsProvider 内で
    // useCallback([]) されており参照が安定しているため依存に入れても実害はないが、
    // 明示不要な再購読を避けるため空配列にしている）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [busyKey, setBusyKey] = useState<'editor.eyedropBusy' | 'editor.restoreBusy' | 'editor.undoBusy' | 'editor.redoBusy' | 'editor.retransBusy' | 'editor.resetBusy'>('editor.eyedropBusy');
  // 透過強度。親から初期値をもらい、以後はこの画面で持つ。
  const [cellTol, setCellTol] = useState(cellTolerance ?? settings.tolerance);
  // 透過強度パネルは既定で畳んでおく。開きっぱなしだと画像の上側を覆って
  // そこを編集できなくなるため、必要な時だけ開く。
  const [retransOpen, setRetransOpen] = useState(false);
  /**
   * 再透過の対象範囲。'selection' を選んで実行すると、まず対象ポリゴンを
   * 選ぶ段階（retransPicking）を挟む。選択中のポリゴンが万一無いまま実行に
   * 来た場合は 'all' 相当（scopeBBox を渡さない）にフォールバックする。
   */
  const [retransScope, setRetransScope] = useState<'all' | 'selection'>('all');
  /**
   * 「範囲を選択して再透過」を実行すると、まずこれを true にして「対象の
   * ポリゴンをタップしてください」という案内だけの表示に切り替える。
   * 選択（selectedId）が付いた瞬間に自動で false へ戻り、通常のカード表示
   * （「この範囲を再透過」ボタン）に戻る。ユーザーが「今から範囲を選ぶんだな」
   * と迷わず分かるよう、選択と設定を同じ画面に混ぜず段階を分けている。
   */
  const [retransPicking, setRetransPicking] = useState(false);
  /**
   * 「範囲を指定する」で対象をどう選ぶか。null の間（retransPicking の
   * 最初の段階）は「ポリゴンで選択／ブラシで選択」の方式選択を出す。
   * 'polygon' は既存のタップ選択（selectedId）、'brush' は指でなぞって
   * 囲む新しい選択（下の retransMaskPoints）。復元ブラシ(restore)とは
   * 完全に別物 — 復元ブラシは「なぞった場所だけ」処理するのに対し、
   * こちらは「なぞって囲んだ内部全体」を処理する。
   */
  const [retransMethod, setRetransMethod] = useState<'polygon' | 'brush' | null>(null);
  /**
   * ブラシでなぞって確定した選択範囲（画像座標、閉多角形として扱う）。
   * ズーム・パン・ルーペを使っても表示だけがズレないよう、常に画像座標で
   * 保持し、描画時にその時点の zoom で表示座標へ変換し直す。
   */
  const [retransMaskPoints, setRetransMaskPoints] = useState<Array<[number, number]> | null>(null);
  /**
   * 範囲を選んで再透過を実行した直後、まだ確定していない「結果を見せている」
   * 段階かどうか。true の間はカードを閉じずに残し、「確定」でそのまま閉じるか、
   * 「やり直す」で選び直すか、スライダーで強さを変えて再実行するかを選べる
   * ようにする。選択をやり直す／強さを変えると false に戻し、次に適用ボタンを
   * 押した時にまた実際の再透過処理が走るようにする。
   */
  const [retransApplied, setRetransApplied] = useState(false);
  /** なぞっている最中のライブプレビュー用（表示座標、指を離したら破棄）。 */
  const [retransTraceLocal, setRetransTraceLocal] = useState<Array<[number, number]>>([]);
  const retransTraceRef = useRef<Array<[number, number]>>([]);
  /** なぞり始めの位置（表示座標）。移動量(gestureState.dx/dy)をここに足して現在位置を出す。 */
  const retransTraceStartRef = useRef<[number, number]>([0, 0]);
  /**
   * ブラシでなぞる選択が有効かどうかを、メインの PanResponder（下の pan）が
   * 参照するための ref。state は PanResponder のクロージャからは古い値しか
   * 読めないため、ref を毎レンダー同期させる（selectedIdRef 等と同じ理由）。
   * これが true の間、メイン側は onStartShouldSetPanResponder /
   * onMoveShouldSetPanResponder を両方 false にして一切手を出さない —
   * 2つの PanResponder 間の「responder 争奪戦」を無くし、なぞっている最中に
   * 画面がパンしてしまう不具合を防ぐ。
   *
   * 'adjust'/'drag' 設定では false 固定にする。どちらもレティクル＋決定
   * ボタンで録画する方式（toggleRetransRecording）を使うので、指を動かす
   * 操作自体は「普通にキャンバスをパンする」（'adjust'）か「レティクルを
   * つまんで動かす」（'drag'、メイン PanResponder 側の drag_reticle が
   * 処理する）でなければならない。ここを true のままにすると、指を動かした
   * 瞬間にこのなぞり用の透明レイヤーへ食われてしまい、'adjust' はパンした
   * つもりが軌跡を描いてしまい、'drag' はレティクルがそもそもつかめない
   * （このファイル内では settings.loupeMode を直接見る — loupeIsAdjust/
   * dragReticleMode はこの ref 定義より後で宣言されるため使えない）。
   */
  const retransBrushActiveRef = useRef(false);
  retransBrushActiveRef.current = retransPicking && retransMethod === 'brush' && !retransMaskPoints
    && settings.loupeMode === 'fixed';
  // メインの PanResponder は useRef で1度だけ作られる（クロージャが古いまま
  // 固定される）ので、その中から最新の retransPicking/retransMethod を読むには
  // ref 経由にする必要がある（retransBrushActiveRef と同じ理由）。
  const retransPickingRef = useRef(retransPicking);
  retransPickingRef.current = retransPicking;
  const retransMethodRef = useRef(retransMethod);
  retransMethodRef.current = retransMethod;
  const retransOpenRef = useRef(retransOpen);
  retransOpenRef.current = retransOpen;

  /**
   * draw モード（四角追加）の方式。'tap' は既存のタップ配置、'trace' は指で
   * なぞって囲む方式 — 再透過の「ブラシで選択」と全く同じなぞり／録画の
   * 仕組みを流用し、確定した形を再透過の選択範囲ではなく通常のカット用
   * ポリゴンとして追加する。appMode を move へ切り替えて頂点調整に入っても
   * この方式自体は保持し、draw モードへ戻れば同じ方式のまま続けられる。
   */
  const [drawMethod, setDrawMethod] = useState<'tap' | 'trace'>('tap');
  const drawMethodRef = useRef(drawMethod);
  drawMethodRef.current = drawMethod;

  /** なぞっている最中のライブプレビュー（表示座標）。retransTraceLocal と同じ役割。 */
  const [drawTraceLocal, setDrawTraceLocal] = useState<Array<[number, number]>>([]);
  const drawTraceRef = useRef<Array<[number, number]>>([]);
  const drawTraceStartRef = useRef<[number, number]>([0, 0]);

  /**
   * draw+trace のなぞり選択が有効かどうかをメインの PanResponder から参照する
   * ための ref。retransBrushActiveRef と同じ理由・同じ役割 —— true の間は
   * メイン側が一切 responder を取らず、専用の drawTraceResponder に譲る。
   * 'adjust'/'drag' 設定では false 固定（決定ボタンでの録画方式
   * toggleDrawRecording を使うため）。
   */
  const drawTraceActiveRef = useRef(false);
  drawTraceActiveRef.current = appMode === 'draw' && drawMethod === 'trace' && settings.loupeMode === 'fixed';

  /**
   * 'adjust'/'drag' 設定版の録画状態。retransRecording 一式と全く同じ仕組み
   * （toggleRetransRecording 付近のコメント参照）。
   */
  const [drawRecording, setDrawRecording] = useState(false);
  const drawRecordingRef = useRef(false);
  const drawRecordingSV = useSharedValue(false);
  /** 録画中の軌跡（画像座標）。drawTraceRef(なぞり用・表示座標)とは別物。 */
  const drawRecordImgRef = useRef<Array<[number, number]>>([]);
  /** 録画中のライブプレビュー用（画像座標のまま持ち、描画側で ds を掛ける）。 */
  const [drawRecordPts, setDrawRecordPts] = useState<Array<[number, number]>>([]);
  const drawRecordRafRef = useRef<number | null>(null);
  const flushDrawRecord = useCallback(() => {
    if (drawRecordRafRef.current != null) return;
    drawRecordRafRef.current = requestAnimationFrame(() => {
      drawRecordRafRef.current = null;
      setDrawRecordPts([...drawRecordImgRef.current]);
    });
  }, []);

  /**
   * あるポリゴンが「今、画面に見えているか」を判定する。表示側
   * （polyPaths.map・labelCentroids.map の hidden 判定）と全く同じ条件を
   * ここに1本化し、頂点/辺/全体ドラッグやタップ選択などの当たり判定側でも
   * これを通す。表示条件と当たり判定条件を別々に書いていた時、片方だけ
   * 直して「見えないのに触れる」が繰り返し漏れていたための整理。
   * 「見えないものには触れない」を常に成り立たせる。
   */
  const isPolyVisible = useCallback((id: number) => {
    if (chromeHiddenRef.current) return false;
    if (!retransOpenRef.current) return true;
    if (retransPickingRef.current) return false;
    const sel = selectedIdRef.current;
    if (sel != null) return id === sel;
    return true;
  }, []);
  // 下部のツール説明・ズームバーごと、重なるものを一時的に全部隠す。
  // 画像の端を直したい時に「どかす手段」が無いと詰むので用意する。
  // ポリゴンの塗り・輪郭・連番バッジも同じ理由で一緒に隠す
  // （画像を素の状態で確認したい、という目的が周辺パネルと共通のため）。
  const [chromeHidden, setChromeHidden] = useState(false);
  // 復元ブラシの太さ（BRUSH_SIZES の添字）と、なぞっている最中の軌跡（表示座標）。
  const [brushPx, setBrushPx] = useState(settings.brushDefaultPx);
  // スポイトの許容値。設定画面まで行かずに、その場で強弱を変えられるようにする。
  const [eyeTol, setEyeTol] = useState(settings.eyedropperTolerance);
  // 元画像の透かし表示。初期値は設定「ゴースト表示を初期状態でON」に従う
  // （復元ブラシでは消えた場所が見えないと塗れないため、既定は true）。
  const [ghostOn, setGhostOn] = useState(settings.ghostDefaultOn);
  // ツールメニューの開閉。常時6個並べると編集領域を食うので、普段は
  // 選択中の1個だけを出し、押した時だけ下へ展開する。
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  // 下地の選択を開いているか。普段は現在の下地のアイコン1つだけ出す。
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [loupeModePickerOpen, setLoupeModePickerOpen] = useState(false);
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
  /** ルーペ更新を1フレーム1回にまとめる共通処理。毎イベント setState しない。 */
  const scheduleLoupe = useCallback((next: NonNullable<typeof loupe>) => {
    loupePendingRef.current = next;
    if (loupeRafRef.current != null) return;
    loupeRafRef.current = requestAnimationFrame(() => {
      loupeRafRef.current = null;
      setLoupe(loupePendingRef.current);
    });
  }, []);
  /**
   * move モードの素のパン中（頂点/辺/ポリゴン移動中を含む）、ルーペの中身が
   * 追う画像座標を UI スレッドで直接持つ共有値。dragReticleSV と同じ理由 —
   * showLoupe は毎タッチイベントで呼ばれるが、その都度 setState していると
   * React の再レンダーがパンのたびに走ってカクつく。ここへは毎イベント
   * 同期で書き込み、React state（loupe）は今まで通り rAF で間引く。
   * ルーペの中身はこの共有値から直接追従させるので、間引き後の state 更新が
   * JS スレッド側で遅れても見た目のヌルヌルさには影響しない。
   */
  const moveLoupeImgSV = useSharedValue<{ x: number; y: number }>({ x: 0, y: 0 });
  /** タッチ位置(表示座標)からルーペを更新する。'fixed' モードなど、狙い所＝指の位置の時に使う。 */
  const showLoupe = useCallback((lx: number, ly: number) => {
    const z = zoomRef.current;
    const { x, y } = localToImage(lx, ly, z);
    moveLoupeImgSV.value = { x, y };
    scheduleLoupe({ img: { x, y }, touch: { x: lx, y: ly } });
  }, [scheduleLoupe, moveLoupeImgSV]);
  /**
   * showLoupe の間引き版。moveLoupeImgSV 導入だけではカクつきが直らなかった
   * ことから追加した2段目の対策 ——
   * moveLoupeImgSV はルーペの「見た目の追従」を担うが、scheduleLoupe 自体は
   * rAF で間引いていても、パン中は毎フレーム（〜60/120Hz）loupe の setState を
   * 呼び続けていて、この巨大なコンポーネントの再レンダーそのものがパンの
   * カクつきの主因として残っていた。ルーペの中身は共有値側で既に滑らかなので、
   * React state（loupe）は「隅寄せ判定用のタッチ位置」「触っていない間の
   * フォールバック位置」が分かればよく、毎フレーム最新である必要がない。
   * ここでは時間ベースで間引き、setState 自体の回数をパン中も大きく減らす。
   * 呼び始め（ジェスチャー開始直後）だけは即座に反映し、出現が遅れて
   * 見えないようにする。move モードの素のパン・辺/ポリゴン移動でのみ使う
   * （moveLoupeImgSV を pointSV として使う経路と対にする）。
   */
  const loupeShowingRef = useRef(false);
  const loupeStateLastCommitRef = useRef(0);
  const LOUPE_STATE_THROTTLE_MS = 120;
  const showLoupeThrottled = useCallback((lx: number, ly: number) => {
    const z = zoomRef.current;
    const { x, y } = localToImage(lx, ly, z);
    moveLoupeImgSV.value = { x, y };
    const now = Date.now();
    if (!loupeShowingRef.current || now - loupeStateLastCommitRef.current >= LOUPE_STATE_THROTTLE_MS) {
      loupeShowingRef.current = true;
      loupeStateLastCommitRef.current = now;
      scheduleLoupe({ img: { x, y }, touch: { x: lx, y: ly } });
    }
  }, [scheduleLoupe, moveLoupeImgSV]);
  /**
   * 画像座標を直接指定してルーペを更新する。'drag' 設定のレティクルのように、
   * 狙い所がすでに画像座標で分かっている（指の位置とは独立している）時に使う。
   * touch は指を避ける隅寄せ判定にのみ使うので、実際の指位置を渡す。
   */
  const showLoupeAtImg = useCallback((imgX: number, imgY: number, touchLx: number, touchLy: number) => {
    scheduleLoupe({ img: { x: imgX, y: imgY }, touch: { x: touchLx, y: touchLy } });
  }, [scheduleLoupe]);
  /**
   * 'drag' 設定のドラッグ中だけが使う、専用の rAF スケジューラ。
   * dragReticleImg（React state）と loupe（React state）を1フレームに
   * まとめて1回の setState 呼び出しにする。別々の rAF（loupeRafRef と
   * dragReticleRafRef）に分けていると、同じフレーム内でも発火タイミングが
   * ずれて2回の再レンダーになることがあり、それがカクつきの一因になって
   * いた。ref・共有値(dragReticleSV)は毎イベント同期更新のままなので、
   * 見た目のヌルヌルさ自体はこの間引きの影響を受けない — ここで間引くのは
   * 「JSスレッドの再レンダー回数」だけ。
   */
  const dragMoveRafRef = useRef<number | null>(null);
  const dragMovePendingRef = useRef<{ pos: { x: number; y: number }; touch: { x: number; y: number } } | null>(null);
  const hideLoupe = useCallback(() => {
    loupeShowingRef.current = false;
    loupePendingRef.current = null;
    if (loupeRafRef.current != null) {
      cancelAnimationFrame(loupeRafRef.current);
      loupeRafRef.current = null;
    }
    // 'drag' 中の合成更新も、保留分が後から発火してルーペを復活させないよう
    // ここでまとめて取り消す。
    dragMovePendingRef.current = null;
    if (dragMoveRafRef.current != null) {
      cancelAnimationFrame(dragMoveRafRef.current);
      dragMoveRafRef.current = null;
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

  /**
   * 'drag' 設定: レティクル（編集位置）を指ドラッグで直接動かす方式。対象ツールは
   * reticleFixed と同じ（スポイト・四角追加・復元ブラシ）。
   *
   * adjust（十字ボタン）との違いは操作方法だけでなく、動かす対象そのものが違う点。
   * adjust はレティクルを画面中央に固定し、代わりにキャンバス（zoom.tx/ty）を
   * 動かして狙いを合わせる。drag はキャンバス（拡大表示している画像位置）は
   * 一切動かさず、レティクル位置そのものを独立した画像座標の state
   * （dragReticleImg）として持ち、指のドラッグ量をその場のズーム倍率で
   * 画像座標へ変換して加算する（頂点/辺ドラッグと同じ変換式）。
   * ズームが高いほど同じ指の移動量でもレティクルは少ししか動かない。
   */
  const dragReticleMode = settings.loupeMode === 'drag'
    && (appMode === 'eyedropper' || appMode === 'draw' || appMode === 'restore'
      // 再透過「範囲を指定してください」の間だけ 'move' モードでも有効に
      // する。'adjust' 設定を使えるようにした時と同じ理由で、通常の move
      // モード（頂点/辺/ポリゴンを直接つまむ操作）とは共存しない操作なので、
      // 再透過のピッキング中限定にしてある。
      // retransMethod === null（方式選択の段階、ポリゴン/ブラシどちらの
      // ボタンを押すか選んでいるだけ）はまだ含めない。ここでレティクルが
      // 一本指を独占すると、方式を選ぶ前に画像を見回すための素のパンが
      // できなくなってしまう（実際に「パンできない」という報告になった）。
      || (appMode === 'move' && retransOpen && retransPicking && retransMethod !== null));
  const dragReticleModeRef = useRef(dragReticleMode);
  dragReticleModeRef.current = dragReticleMode;

  /** 'drag' モードのレティクル位置（画像座標）。null は未初期化（初回に中央へ seed）。 */
  const [dragReticleImg, setDragReticleImg] = useState<{ x: number; y: number } | null>(null);
  const dragReticleImgRef = useRef(dragReticleImg);
  dragReticleImgRef.current = dragReticleImg;
  const dragReticleRafRef = useRef<number | null>(null);
  const dragReticlePendingRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * dragReticleImg の setState を1フレーム1回にまとめる。指ドラッグ中の
   * onPanResponderMove はネイティブ側のタッチサンプリング頻度（画面の
   * リフレッシュレートより高いことがある）でそのまま呼ばれるため、毎回
   * setState していると1フレームに何度も再レンダーが走ってカクつく
   * （ルーペの showLoupe/scheduleLoupe と同じ理由・同じ対策）。
   */
  const scheduleDragReticleState = useCallback((next: { x: number; y: number }) => {
    dragReticlePendingRef.current = next;
    if (dragReticleRafRef.current != null) return;
    dragReticleRafRef.current = requestAnimationFrame(() => {
      dragReticleRafRef.current = null;
      setDragReticleImg(dragReticlePendingRef.current);
    });
  }, []);
  /**
   * レティクル位置（画像座標）を UI スレッドで直接持つ共有値。TouchLoupe の
   * 中身の追従と、実寸キャンバス側の印(mainReticle)の位置を、どちらも
   * React の再レンダーを一切挟まずに毎フレーム更新する。他のモード（adjust
   * のパン、二本指ピンチ）が zoomSV 経由でヌルヌル動くのと同じ仕組み。
   * dragReticleImg（React state, rAFで間引き）は、触っていない間のルーペの
   * 表示や決定ボタンの確定位置など、"最新の1点" が分かればよい用途にだけ使う。
   */
  const dragReticleSV = useSharedValue<{ x: number; y: number }>({ x: 0, y: 0 });
  /** レティクル位置の3つの保持先（ref・共有値・React state）をまとめて更新する。 */
  const setDragReticlePos = useCallback((next: { x: number; y: number }) => {
    dragReticleImgRef.current = next;
    dragReticleSV.value = next;
    scheduleDragReticleState(next);
  }, [dragReticleSV, scheduleDragReticleState]);
  /**
   * ドラッグ中（onPanResponderMove）専用の更新関数。ref・共有値は毎イベント
   * 同期更新（見た目のヌルヌルさはここが担う）、dragReticleImg と loupe の
   * React state 更新は dragMoveRafRef で1フレーム1回にまとめ、かつ同じ
   * rAF コールバック内で両方の setState を呼ぶことで React のバッチング
   * （1回の再レンダーにまとまる）を効かせる。scheduleDragReticleState と
   * scheduleLoupe を別々に呼ぶと rAF が2本になり、同じフレームでも発火が
   * ずれて再レンダーが2回に分かれることがあった（カクつきの一因）。
   */
  const updateDragReticleLive = useCallback((next: { x: number; y: number }, touchLx: number, touchLy: number) => {
    dragReticleImgRef.current = next;
    dragReticleSV.value = next;
    dragMovePendingRef.current = { pos: next, touch: { x: touchLx, y: touchLy } };
    if (dragMoveRafRef.current != null) return;
    dragMoveRafRef.current = requestAnimationFrame(() => {
      dragMoveRafRef.current = null;
      const v = dragMovePendingRef.current;
      if (!v) return;
      setDragReticleImg(v.pos);
      setLoupe({ img: v.pos, touch: v.touch });
    });
  }, [dragReticleSV]);
  /**
   * 画像範囲外にも自由に出せる（頂点/辺/ポリゴンのドラッグと同じく特にクランプ
   * しない）。今のキャンバス表示範囲の外側を狙いたい場合もあるため。
   */
  const clampReticleImg = (x: number, y: number) => ({ x, y });
  // 'drag' 設定に入った直後、まだレティクル座標が無ければキャンバス中央に相当する
  // 画像座標を初期値にする。一度決めたらツール切替（スポイト⇄復元ブラシ等）を
  // またいで保持し、毎回中央へ戻らないようにする。画像自体が変わった時
  // （bgVersion 変化）は中央から seed し直す。
  const dragReticleBgVersionRef = useRef(bgVersion);
  useEffect(() => {
    if (dragReticleBgVersionRef.current !== bgVersion) {
      dragReticleBgVersionRef.current = bgVersion;
      dragReticleImgRef.current = null;
    }
    if (!dragReticleMode || dragReticleImgRef.current) return;
    const p = canvasCenter();
    const z = zoomRef.current;
    const seed = p ? localToImage(p.x, p.y, z) : { x: imageWRef.current / 2, y: imageHRef.current / 2 };
    setDragReticlePos(seed);
  }, [dragReticleMode, bgVersion, setDragReticlePos]);

  /** 画像1ドットぶんの表示px。倍率が変わっても「1押し＝1ドット」を保つ。 */
  const dotStepPx = () => Math.max(0.02, dsRef.current * zoomRef.current.scale);

  /**
   * ズームバーを畳んでルーペを大きく見せるかどうか。'adjust' モードの時だけ
   * 意味を持つ（十字ボタンで狙いを追い込む作業なので、ルーペが大きい方が良い）。
   * ユーザーがボタンで手動で切り替える。展開⇄折りたたみで見た目が入れ替わる
   * だけなので、ここは毎フレーム更新される値ではなく通常の state でよい。
   */
  const [zoomCompact, setZoomCompact] = useState(settings.loupeMode === 'adjust');
  /**
   * スポイト/復元ブラシ/ペン/再透過の畳み状態は、以前はズームバーと同じ
   * 1つのフラグ(zoomCompact)を共有していたが、「ペンで1個作ったら畳む」の
   * ような1画面の操作が、まだ使ってもいないスポイトの初回表示まで畳んで
   * しまう、という指摘を受けて分離した。パネルごとに独立して
   * 「初回は展開・使い終えたら畳む」を持てるようにする。
   */
  const [eyedropperPanelCompact, setEyedropperPanelCompact] = useState(settings.loupeMode === 'adjust');
  const [restorePanelCompact, setRestorePanelCompact] = useState(settings.loupeMode === 'adjust');
  const [drawPanelCompact, setDrawPanelCompact] = useState(settings.loupeMode === 'adjust');
  const [retransPanelCompact, setRetransPanelCompact] = useState(settings.loupeMode === 'adjust');
  // 'adjust' モードに入ったら、ルーペを大きく見せるレイアウトを既定にする。
  // 毎回手動で畳むのは手間なので、モード自体が「大きいルーペ前提」の運用にする。
  // ユーザーはピルボタンでいつでも元のズームバー/ブラシパネルへ展開し直せる。
  useEffect(() => {
    if (settings.loupeMode === 'adjust') {
      setZoomCompact(true);
      setEyedropperPanelCompact(true);
      setRestorePanelCompact(true);
      setDrawPanelCompact(true);
      setRetransPanelCompact(true);
    }
  }, [settings.loupeMode]);
  // 'adjust' モードのルーペは常に全幅表示。高さはキャンバス高さの4割弱程度に
  // 抑える（zoomCompact の状態には依らない。ズーム/ブラシパネルの開閉はルーペの
  // 下に浮かぶ小さなクラスタなので、ルーペ自体のサイズには影響しない）。
  const loupeIsAdjust = settings.loupeMode === 'adjust';
  /** loupeIsAdjust の ref 版。PanResponder（useRef で1回だけ生成）のクロージャから参照する。 */
  const loupeIsAdjustRef = useRef(loupeIsAdjust);
  loupeIsAdjustRef.current = loupeIsAdjust;
  /**
   * 収納段階「大」の一辺(px)。設定「ルーペ基準サイズ」(settings.loupeBaseSize,
   * 80〜220) がそのまま上限になる。canvasSize が確定していればその4割弱で
   * さらに抑える（小さい画面で大きすぎるルーペにならないための安全弁。
   * 基準サイズ自体は 220 まで許すが、画面が低ければそこまで出さない）。
   * 「中」「収納」はこの MAX から比率で計算する（LOUPE_MEDIUM_RATIO /
   * LOUPE_MINI_RATIO）ので、大→中→収納の切り替えロジック自体は変わらない。
   */
  const loupeMax = settings.loupeBaseSize;
  const loupeMedium = Math.round(loupeMax * LOUPE_MEDIUM_RATIO);
  // 収納は比率のままだと基準サイズが小さい時(例: 80→28px)にタップ領域が
  // 最小タップ目安(44pt)を割って押せなくなるため下限を設ける。中サイズは
  // 同条件でも 60px 前後あり押しにくいと報告されていないためフロア無し。
  const loupeMini = Math.max(LOUPE_MINI_MIN, Math.round(loupeMax * LOUPE_MINI_RATIO));
  const loupeSize = canvasSize.h > 0
    ? Math.round(Math.min(canvasSize.h * 0.36, loupeMax))
    : loupeMax;
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
  const effectiveLoupeSize = loupeDockLevel === 1 ? loupeMedium
    : loupeDockLevel === 2 ? loupeMini
    : loupeSize;
  // ルーペの設定（loupeMode）自体が変わったら、そのモードの既定段階に戻す
  // （'fixed'⇄'adjust' を切り替えた時、前のモードの収納状態を引きずらない）。
  useEffect(() => {
    setLoupeDockLevel(loupeIsAdjust ? 0 : 1);
  }, [loupeIsAdjust]);
  /**
   * ルーペの倍率（TouchLoupe の magnify prop）。設定の loupeZoomMode に応じて
   * キャンバスの現在のズーム(zoom.scale)と連動させる。
   *   'fixed'     … 常に既定値（従来どおり、ズームに関係なく一定）。
   *   'matchZoom' … ズームが上がるほどルーペも一緒に拡大（さらに拡大して
   *                 見たい時向け）。上限は既定値の4倍に抑え、極端な
   *                 モザイク状態にならないようにする。
   *   'inverse'   … ズームが上がるほどルーペは逆に縮小（キャンバス側で
   *                 既に十分拡大されているぶん、ルーペまで過剰倍率に
   *                 ならないようにする）。下限は既定値の1/4に留める。
   */
  const loupeBaseMagnify = Number(settings.loupeBaseMagnify) || LOUPE_MAGNIFY;
  const loupeMagnify = settings.loupeZoomMode === 'matchZoom'
    ? Math.min(loupeBaseMagnify * zoom.scale, loupeBaseMagnify * 4)
    : settings.loupeZoomMode === 'inverse'
    ? Math.max(loupeBaseMagnify / zoom.scale, loupeBaseMagnify / 4)
    : loupeBaseMagnify;
  /**
   * 今アクティブなパネルの畳み状態。dpadBottom の計算など「今どれか1つの
   * パネルが畳まれているか」を知りたいだけの箇所向けに、現在の
   * appMode/retransOpen から該当するフラグを1つ選ぶ。
   */
  const panelCompact = retransOpen && retransPicking ? retransPanelCompact
    : appMode === 'eyedropper' ? eyedropperPanelCompact
    : appMode === 'restore' ? restorePanelCompact
    : appMode === 'draw' ? drawPanelCompact
    : false;
  /**
   * 説明ピル(ToolHint)の実測の高さ(px)。文字数・折り返し・OS側の文字サイズ
   * 設定（Dynamic Type等）で毎回変わるので、十字ボタンの位置を決め打ちの
   * マジックナンバーではなくこの実測値から計算する（詳しくは dpadBottom
   * 参照）。初回描画前の暫定値として、1行だけの通常表示の高さを入れておく。
   */
  const [toolHintHeight, setToolHintHeight] = useState(40);
  /**
   * 十字ボタンの画面下端からの距離。説明ピル(ToolHint, bottom:12)の実測の
   * 高さぶん常に上へ逃がす。以前は「再透過カードが開いているか」等の
   * 状態だけを見た決め打ちの数値(100/172/190)だったが、再透過カード自体を
   * ToolHint に統合してからは中身の行数で高さが大きく変わるようになり、
   * 決め打ちでは追従できなくなった（文字を大きくする設定でも同様）。
   * 収納中（'adjust'設定でパネルを畳んでいる間）だけ、ブラシ/スポイトの
   * 小さいピル(panelSlot, bottom:58)がさらに下に浮くので、その分も上乗せする。
   *
   * ただし再透過のフォーム（スコープ選択+スライダー+戻る/やり直す+適用
   * ボタン）はかなり縦に長く、そのまま高さに追従させると十字ボタンが
   * 高く浮きすぎてキャンバス（画像）の真ん中に被ってしまう。十字ボタンは
   * 「ToolHintに重ならない」ことより「キャンバスの邪魔にならない」ことの
   * 方が優先なので、上限で頭打ちにする。
   */
  const dpadBottom = Math.min(12 + toolHintHeight + 12 + (panelCompact ? 46 : 0), 160);
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
    ? { top: loupeTopOffset, left: 8 + loupeMedium + 8, right: 8, flexDirection: 'column' as const, alignItems: 'stretch' as const }
    // 小(docked)状態はルーペの半分(loupeMini/2)が画面内に見えている
    // ので、その右端より後ろから始めないとスライダーと重なる。
    : { top: loupeTopOffset, left: loupeMini / 2 + 8, right: 8, flexDirection: 'row' as const };
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
    if (dragReticleRafRef.current != null) cancelAnimationFrame(dragReticleRafRef.current);
  }, []);

  const polygonsRef   = useRef(polygons);   polygonsRef.current   = polygons;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const appModeRef    = useRef(appMode);    appModeRef.current    = appMode;
  // ポリゴンを非表示にしている間は、見えていないものに触れて誤操作しない
  // よう、頂点/辺/ポリゴン全体のヒット判定も一緒に止める（PanResponder の
  // クロージャから読むため ref 経由）。
  const chromeHiddenRef = useRef(chromeHidden); chromeHiddenRef.current = chromeHidden;
  const pastRef       = useRef(past);       pastRef.current       = past;
  const dsRef         = useRef(ds);         dsRef.current         = ds;
  const imageWRef     = useRef(bgResult.width);  imageWRef.current  = bgResult.width;
  const imageHRef     = useRef(bgResult.height); imageHRef.current = bgResult.height;

  // ── Undo/Redo ─────────────────────────────────────────────────────────────

  /** past に entry を積む。UNDO_HISTORY_LIMIT を超えたら古い方から捨てる。 */
  const pushPast = useCallback((entry: HistEntry) => {
    setPast(p => {
      const next = [...p, entry];
      return next.length > UNDO_HISTORY_LIMIT ? next.slice(next.length - UNDO_HISTORY_LIMIT) : next;
    });
  }, []);

  /** 現在の polygons を past に積んで future をクリアする */
  const pushHistory = useCallback(() => {
    pushPast({ kind: 'polygons', polygons: polygonsRef.current });
    setFuture([]);
  }, [pushPast]);

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
  const runHeavy = useCallback((work: () => void, key?: 'editor.eyedropBusy' | 'editor.restoreBusy' | 'editor.undoBusy' | 'editor.redoBusy' | 'editor.retransBusy' | 'editor.resetBusy') => {
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
        // work() は同期的に画素(rgba)を書き換えて setState するが、その
        // 結果が実際に画面に塗られる（親の再レンダー→ skImage の作り直し
        // → Skia側の新しいテクスチャのアップロード）までには、この関数
        // 呼び出しの中では終わらないもう数フレームかかることがある。
        // ここで即座にローディングを消すと「消える前にローディングが
        // 終わった」ように見えるため、もう2フレーム待ってから解除する。
        requestAnimationFrame(() => requestAnimationFrame(() => {
          eyeBusyRef.current = false;
          setEyeBusy(false);
          // 波紋はここで即消さない。処理が速いと出た瞬間に消えて
          // 「押せたのか分からない」状態に戻るため、アニメの尺だけ残す。
          setTimeout(() => setRipple(null), RIPPLE_MS);
        }));
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
      pushPast({ kind: 'edit' });
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
  }, [t, showToast, startRipple, runHeavy, pushPast]);

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
      pushPast({ kind: 'edit' });
      setFuture([]);
      const radius = brushRadiusRef.current;
      const thinned = thinStroke(pts, radius);
      runHeavy(() => onRestoreRef.current?.(thinned, radius), 'editor.restoreBusy');
    }
  }, [runHeavy, pushPast]);

  /**
   * 決定ボタン。録画中でなければ開始、録画中なら終了して確定する。
   * 開始点は 'adjust' 設定ならキャンバス中央、'drag' 設定なら指ドラッグで
   * 動かしてきたレティクル位置（dragReticleImg）。
   */
  const toggleRestoreRecording = useCallback(() => {
    if (restoreRecordingRef.current) {
      restoreRecordingRef.current = false;
      restoreRecordingSV.value = false;
      setRestoreRecording(false);
      finishRestoreStroke();
      return;
    }
    let seed: { x: number; y: number } | null;
    if (dragReticleModeRef.current) {
      seed = dragReticleImgRef.current
        ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
    } else {
      const p = canvasCenter();
      seed = p ? localToImage(p.x, p.y, zoomRef.current) : null;
    }
    if (!seed) return;
    strokeImgRef.current = [[seed.x, seed.y]];
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
    // 'drag' 設定中はレティクルが画面中央固定ではなく指でつまんで動かす方式
    // なので、画面中央はレティクル位置と無関係。ここで弾かないと、'drag'
    // 設定で録画中に二本指ピンチやズームバーでズームしただけで「画面中央の
    // 画像座標」という無関係な点が軌跡に混入し、確定した形が画像中央へ
    // 引っ張られたように歪む不具合になっていた（'drag' 中の軌跡追加は
    // drag_reticle の move ハンドラだけが担う）。
    if (dragReticleModeRef.current) return;
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
  // undo/redo ボタンの活性判定は canUndoEdit/canRedoEdit（親の edits 件数）も見ているが、
  // それは PolygonEditor が開く前からある編集（例: 自動背景除去そのもの、前回セッションの
  // 続き）まで含む。past/future はこの画面が開いてから積んだ分しか無いので、それを使い切った
  // 後もボタンは活性のままになる。その状態で押した時に何もしないと「押せるのに反応しない」
  // ボタンになるため、ここで親側にまだ取り消せる分があるかを判定できるようにしておく。
  const canUndoEditRef = useRef(canUndoEdit); canUndoEditRef.current = canUndoEdit;
  const canRedoEditRef = useRef(canRedoEdit); canRedoEditRef.current = canRedoEdit;

  // 個別スタンプの bbox 一覧（画像px）。四角追加の初期サイズを「タップ位置にある
  // スタンプ1個のサイズ」にするために使う。splitConnected が連結成分ごとに分離し
  // （近接塊の結合・ノイズ除外も内部で実施）、スタンプごとの BBox[] を返す。
  // 全画素を舐める重い同期処理なので、エディタ入場時（mount）には走らせない。
  // 「四角追加」など実際に bbox 判定が要る瞬間に getStampBboxes() 経由で
  // 初回だけ計算し、以後はこの ref にキャッシュして使い回す（同一セッション中は
  // 再計算しない＝毎タップの再計算は重いので不可、という従来の制約はそのまま）。
  const stampBboxesCacheRef = useRef<BBox[] | null>(null);
  const getStampBboxes = useCallback((): BBox[] => {
    if (stampBboxesCacheRef.current === null) {
      stampBboxesCacheRef.current = splitConnected(bgResult.rgba, bgResult.width, bgResult.height);
    }
    return stampBboxesCacheRef.current;
  }, [bgResult]);

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
  // 過去に一度 RAF throttle を試し、polygonsRef(即更新) と polygons state(rAF遅延)
  // の乖離で「一瞬戻る」不具合を踏んで素の毎フレーム setPolygons に戻した経緯が
  // あった（当時のコメント参照）。あの実装は各 move イベントの差分計算を
  // React state 側（setPolygons の updater 引数 prev）に依存していたため、
  // state の反映が rAF で遅れると「まだ古い形状」を基準に次の差分を積んでしまい、
  // 巻き戻って見えていたと考えられる。
  //
  // 今回は dragReticleSV と同じ設計にする —— 差分計算の基準を React state ではなく
  // dragLastPolygonsRef（このドラッグ中、毎イベント同期更新される「今の正しい
  // 形状」）に置く。setPolygons（React への反映）だけを rAF で1フレーム1回に
  // 間引き、ref 側は間引かずに常に最新を保つので、setPolygons が何フレーム遅れても
  // 次の move イベントは必ず最新の形状から差分を積む＝巻き戻りは起きない。
  // 「全 Path 再生成」コストは pathCacheRef で解決済み（変化した1ポリゴンのみ再生成）。
  const dragPolygonsRafRef = useRef<number | null>(null);
  const dragPolygonsPendingRef = useRef<Polygon[] | null>(null);
  /**
   * drag_vertex 専用の rAF・保留値。showLoupe（scheduleLoupe の rAF）と
   * scheduleDragPolygons（dragPolygonsRafRef の rAF）を別々に呼ぶと、同じ
   * フレームでも発火タイミングがずれて再レンダーが2回に分かれることがあった。
   * updateDragReticleLive と同じ設計にする —— ref/共有値は毎イベント同期更新、
   * setPolygons と setLoupe は同じ rAF コールバック内でまとめて1回だけ呼ぶ
   * （詳しくは updateDragVertexLive 参照。対象は drag_vertex のみ）。
   */
  const dragVertexRafRef = useRef<number | null>(null);
  const dragVertexPendingRef = useRef<{
    polygons: Polygon[];
    loupe: { img: { x: number; y: number }; touch: { x: number; y: number } };
  } | null>(null);
  /**
   * drag_poly 専用の rAF・保留値。drag_vertex と全く同じ理由・同じ設計
   * （updateDragVertexLive参照）。showLoupe と scheduleDragPolygons を
   * 別々に呼ぶと rAF が2本走り、同じフレームでも発火タイミングがずれて
   * 再レンダーが2回に分かれることがあったため、drag_poly 専用に1本へ
   * まとめる（詳しくは updateDragPolyLive 参照。対象は drag_poly のみ）。
   */
  const dragPolyRafRef = useRef<number | null>(null);
  const dragPolyPendingRef = useRef<{
    polygons: Polygon[];
    loupe: { img: { x: number; y: number }; touch: { x: number; y: number } };
  } | null>(null);
  /**
   * rAF 待ち・保留中の polygons（および drag_vertex/drag_poly の場合は
   * loupe も）があれば即座に反映する。ドラッグの release/terminate で
   * 必ず呼ぶことで、指を離した瞬間にまだ次のフレームを待っている座標が
   * 残らないようにする（「最終座標が確実に polygons state へ反映される」
   * ための同期ポイント）。
   */
  const flushDragPolygons = useCallback(() => {
    if (dragPolygonsRafRef.current != null) {
      cancelAnimationFrame(dragPolygonsRafRef.current);
      dragPolygonsRafRef.current = null;
    }
    if (dragPolygonsPendingRef.current) {
      setPolygons(dragPolygonsPendingRef.current);
      dragPolygonsPendingRef.current = null;
    }
    if (dragVertexRafRef.current != null) {
      cancelAnimationFrame(dragVertexRafRef.current);
      dragVertexRafRef.current = null;
    }
    if (dragVertexPendingRef.current) {
      setPolygons(dragVertexPendingRef.current.polygons);
      setLoupe(dragVertexPendingRef.current.loupe);
      dragVertexPendingRef.current = null;
    }
    if (dragPolyRafRef.current != null) {
      cancelAnimationFrame(dragPolyRafRef.current);
      dragPolyRafRef.current = null;
    }
    if (dragPolyPendingRef.current) {
      setPolygons(dragPolyPendingRef.current.polygons);
      setLoupe(dragPolyPendingRef.current.loupe);
      dragPolyPendingRef.current = null;
    }
  }, []);
  /**
   * 頂点/辺/ポリゴンドラッグの move ハンドラ専用。呼び出し側で計算済みの
   * 新しい polygons 配列を渡す。dragLastPolygonsRef（release 時のセッション
   * 保存にも使う「今の正しい形状」）は毎イベント同期更新し、React への
   * setPolygons だけを1フレーム1回にまとめる。
   */
  const scheduleDragPolygons = useCallback((next: Polygon[]) => {
    dragLastPolygonsRef.current = next;
    dragPolygonsPendingRef.current = next;
    if (dragPolygonsRafRef.current != null) return;
    dragPolygonsRafRef.current = requestAnimationFrame(() => {
      dragPolygonsRafRef.current = null;
      if (dragPolygonsPendingRef.current) {
        setPolygons(dragPolygonsPendingRef.current);
        dragPolygonsPendingRef.current = null;
      }
    });
  }, []);
  /**
   * drag_vertex 専用。updateDragReticleLive と同じ設計 —— ref/共有値
   * (moveLoupeImgSV) は毎イベント同期更新し、setPolygons と setLoupe は
   * 同じ rAF コールバック内でまとめて1回だけ呼ぶ（rAFを1本にする）。
   * imgX/imgY は「今つまんでいる頂点の新しい画像座標」で、ドラッグ中は
   * 指の真下＝ルーペが映す位置と同じなので、ここでそのままルーペにも使う。
   */
  const updateDragVertexLive = useCallback((
    nextPolygons: Polygon[],
    imgX: number, imgY: number,
    touchLx: number, touchLy: number,
  ) => {
    dragLastPolygonsRef.current = nextPolygons; // release 時のセッション保存用
    moveLoupeImgSV.value = { x: imgX, y: imgY };
    dragVertexPendingRef.current = {
      polygons: nextPolygons,
      loupe: { img: { x: imgX, y: imgY }, touch: { x: touchLx, y: touchLy } },
    };
    if (dragVertexRafRef.current != null) return;
    dragVertexRafRef.current = requestAnimationFrame(() => {
      dragVertexRafRef.current = null;
      const v = dragVertexPendingRef.current;
      if (!v) return;
      dragVertexPendingRef.current = null;
      setPolygons(v.polygons);
      setLoupe(v.loupe);
    });
  }, [moveLoupeImgSV]);
  /**
   * drag_poly 専用。updateDragVertexLive と同じ設計 —— ref/共有値
   * (moveLoupeImgSV) は毎イベント同期更新し、setPolygons と setLoupe は
   * 同じ rAF コールバック内でまとめて1回だけ呼ぶ（rAFを1本にする）。
   * drag_vertex と違い drag_poly は「前フレームからの差分」を積む方式
   * （gPrevLX/gPrevLY 基準）なので、dragLastPolygonsRef への同期反映が
   * 1回でも漏れると次のイベントが古い形状を基準に差分を積んでしまい
   * 座標がずれる。ここでも rAF コールバックの外side（呼び出し時点）で
   * 同期更新することを徹底する。
   */
  const updateDragPolyLive = useCallback((
    nextPolygons: Polygon[],
    imgX: number, imgY: number,
    touchLx: number, touchLy: number,
  ) => {
    dragLastPolygonsRef.current = nextPolygons; // release 時のセッション保存用・次イベントの差分基準
    moveLoupeImgSV.value = { x: imgX, y: imgY };
    dragPolyPendingRef.current = {
      polygons: nextPolygons,
      loupe: { img: { x: imgX, y: imgY }, touch: { x: touchLx, y: touchLy } },
    };
    if (dragPolyRafRef.current != null) return;
    dragPolyRafRef.current = requestAnimationFrame(() => {
      dragPolyRafRef.current = null;
      const v = dragPolyPendingRef.current;
      if (!v) return;
      dragPolyPendingRef.current = null;
      setPolygons(v.polygons);
      setLoupe(v.loupe);
    });
  }, [moveLoupeImgSV]);
  // アンマウント時に予約済みの rAF を確実に止める（zoomRafRef 等と同じ理由）。
  useEffect(() => () => {
    if (dragPolygonsRafRef.current != null) cancelAnimationFrame(dragPolygonsRafRef.current);
    if (dragVertexRafRef.current != null) cancelAnimationFrame(dragVertexRafRef.current);
    if (dragPolyRafRef.current != null) cancelAnimationFrame(dragPolyRafRef.current);
  }, []);

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
    //
    // 【バグ修正】ここだけ centerReticle 引数(reticleFixedRef.current)を渡し
    // 忘れていた。ピンチ・パンは渡しているため、'adjust' 設定で録画中
    // （復元ブラシ／再透過ブラシ／draw の「なぞって選択」）に狙いを合わせて
    // 大きくパンした状態からズームバー・[＋]/[−]でズームすると、通常の
    // （狭い）クランプ範囲へ強制的に収められて画像が中央付近まで
    // 引き戻されて見える不具合になっていた。
    scheduleZoom(clampZoom({
      scale: newScale,
      tx: focalX - (focalX - prev.tx) * ratio,
      ty: focalY - (focalY - prev.ty) * ratio,
    }, canvasSizeRef.current.w, canvasSizeRef.current.h,
       imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
       reticleFixedRef.current));
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

  const handleUndo = () => {
    if (pastRef.current.length === 0) {
      // この画面を開く前からの編集（自動背景除去そのもの・前回セッションの続き）が
      // 残っている場合はここに来る。積める polygons スナップショットは無いので、
      // 親の編集だけ取り消す（見た目だけ活性で反応しないボタンにしない）。
      if (canUndoEditRef.current) runHeavy(() => onUndoEditRef.current?.(), 'editor.undoBusy');
      return;
    }
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
    notifyPolygonsChange(snap.polygons); // undo 確定: セッションに保存
    // ポリゴン選択は維持する: undo/redo はポリゴン形状だけ巻き戻し、
    // どのブロックを操作中かはユーザーが判断するため選択を解除しない。
    // undo 後に選択中ポリゴンが削除されていた場合は selectedPoly が null になり
    // ハンドルが消えるだけで、ここで強制解除する必要はない。
    setSelectedVertexIdx(null); // 頂点選択のみ解除（形状が変わったため）
  };

  const handleRedo = () => {
    const [snap, ...rest] = future;
    if (!snap) {
      // handleUndo と同じ理由: この画面を開く前からの編集を取り消した直後は
      // future も空になるが、親側にはまだ redo できる分が残っていることがある。
      if (canRedoEditRef.current) runHeavy(() => onRedoEditRef.current?.(), 'editor.redoBusy');
      return;
    }
    setFuture(rest);
    if (snap.kind === 'edit') {
      runHeavy(() => onRedoEditRef.current?.(), 'editor.redoBusy');
      pushPast({ kind: 'edit' });
      return;
    }
    pushPast({ kind: 'polygons', polygons: polygonsRef.current });
    setPolygons(snap.polygons);
    notifyPolygonsChange(snap.polygons); // redo 確定: セッションに保存
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
    // 「タップで囲む」の一時ポリゴンが片付け忘れで残っていても、書き出し
    // 対象には絶対に混ぜない（実際にセッション保存側で紛れ込んだ不具合が
    // あったため、ここでも防御的に取り除く）。
    const tempId = retransTempPolyIdRef.current;
    const exportPolys = tempId == null ? polygons : polygons.filter(p => p.id !== tempId);
    const regions = findUncoveredRegions(
      bgResult.rgba, bgResult.width, bgResult.height, exportPolys,
    );
    if (regions.length === 0) {
      onPreview(exportPolys); // 囲い漏れなし＝従来どおりワンタップで進む
      return;
    }
    setUncoveredRegions(regions); // 該当箇所を赤く見せた状態で聞く
    Alert.alert(
      t('editor.uncoveredTitle'),
      t('editor.uncoveredMessage'),
      [
        { text: t('editor.uncoveredBack'), style: 'cancel', onPress: () => setUncoveredRegions([]) },
        { text: t('editor.uncoveredProceed'), onPress: () => { onPreview(exportPolys); setUncoveredRegions([]); } },
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
            // 画像の巻き戻しは親が行う。undo と同じく元画像から作り直す重い
            // 処理なので、他の重い操作と同じ処理中オーバーレイを出す。
            runHeavy(() => onResetEditsRef.current?.(), 'editor.resetBusy');
            setPolygons([]);
            setSelectedId(null);
            setSelectedVertexIdx(null);
            setPast([]);
            setFuture([]);
            notifyPolygonsChange([]); // セッションにも空を反映
          },
        },
      ],
    );
  };

  // ── ポリゴン追加 (draw モードでタップ) ───────────────────────────────────

  /**
   * 「範囲を指定する」→「タップで囲む」で作った、使い捨ての一時ポリゴンの id。
   *
   * ペンと同じ操作感（頂点をつまんで微調整できる）にするため、この一時形も
   * 本物と同じ `polygons` 配列に入れて selectedId で選択する（そうしないと
   * 既存の頂点ドラッグ・辺タップでの頂点追加・長押し削除が一切使えない —
   * それらは全部 `selectedId`/`polygons` 前提で書かれているため）。
   * ただし本物の切り出し形状ではないので、退出時（確定・戻る・×・やり直す）に
   * 必ず clearRetransTempPoly で取り除く。取り除き忘れるとセルの最終的な
   * 切り出し結果に紛れ込んでしまう。
   */
  const retransTempPolyIdRef = useRef<number | null>(null);
  /**
   * retransTempPolyIdRef が「元からあるポリゴンの複製」の時だけ true。
   * タップで囲むで一から作った一時形と、既存ポリゴンをタップして自動採用
   * した時に作る複製とで、「戻る」の挙動を変えるために区別している
   * （前者は方式選択からやり直す、後者は選択解除だけで済ませる。
   * 詳しくは戻るボタンの onPress 参照）。
   */
  const retransTempIsCloneRef = useRef(false);

  /** 一時ポリゴンを片付ける。無ければ何もしない（何度呼んでも安全）。 */
  const clearRetransTempPoly = useCallback(() => {
    const id = retransTempPolyIdRef.current;
    if (id == null) return;
    retransTempPolyIdRef.current = null;
    retransTempIsCloneRef.current = false;
    setPolygons(prev => prev.filter(p => p.id !== id));
    setSelectedId(prev => (prev === id ? null : prev));
    setSelectedVertexIdx(null);
  }, []);

  /**
   * 再透過カードを閉じた（retransOpen が false になった）時は、必ず一時
   * ポリゴンを片付ける。
   *
   * 「戻る」「やり直す」「×」「確定して閉じる」など、退出のたびに個別に
   * clearRetransTempPoly を呼ぶ書き方をしていたが、呼び忘れる経路が実際に
   * 見つかった（範囲を選んで一時形を作った後、スコープを「画像全体」に
   * 切り替えて確定すると、その確定処理は一時形の存在を知らないので消され
   * ないまま残っていた）。個別に呼ぶたびに同じ穴が空きうるので、
   * 「retransOpen が閉じたら片付いている」を1箇所で保証する側に倒す。
   */
  useEffect(() => {
    if (!retransOpen) clearRetransTempPoly();
  }, [retransOpen, clearRetransTempPoly]);

  /**
   * 親へポリゴン配列を渡す（＝セッションへ保存する）唯一の経路。
   *
   * 一時ポリゴン（retransTempPolyIdRef）は退出時に clearRetransTempPoly で
   * 片付けているつもりでも、頂点をつまんで微調整している最中に undo/redo・
   * 頂点/辺/全体ドラッグの確定などが挟まると、その時点で onPolygonsChange が
   * 直接呼ばれてしまい、片付ける前に一時形がセッションへ保存されてしまう
   * （実際に発生：再透過用に置いた一時形をやめても、セッションを開き直すと
   * 青いポリゴンとして残っていた）。呼び出し側を1つずつ直すのではなく、
   * 親へ渡す直前にここで必ず取り除くことで、抜け漏れなく防ぐ。
   */
  const notifyPolygonsChange = useCallback((polys: Polygon[]) => {
    const tempId = retransTempPolyIdRef.current;
    onPolygonsChange?.(tempId == null ? polys : polys.filter(p => p.id !== tempId));
  }, [onPolygonsChange]);

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
    for (const b of getStampBboxes()) {
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
    // 'drag' 設定は、置いた直後から「頂点をどこでもドラッグで動かす」を
    // 使えるよう先頭の頂点を自動選択しておく（決定ボタンを一度押して
    // 頂点まで選び直す手間を省く）。'adjust'/'fixed' は今まで通り
    // 未選択のまま（丸を直接タップして選ぶ操作を崩さない）。
    if (settingsRef.current.loupeMode === 'drag') {
      setSelectedVertexIdx(0);
    }
    setAppMode('move'); // 追加後すぐ移動モードでハンドル操作できるよう切替
    // 一度囲み方を選んで使ったら、もう説明は要らないはず。次にペンモードへ
    // 戻ってきた時は方式トグルを畳んだ状態で出す（「最初は見せて、選び終えたら
    // 収納」という要望）。他のパネル（スポイト等）とは独立したフラグなので、
    // ここで畳んでもそちらの初回表示には影響しない。
    setDrawPanelCompact(true);
    notifyPolygonsChange(next); // 確定操作: セッションに保存
  }, [pushHistory, notifyPolygonsChange, getStampBboxes]);

  /**
   * 「範囲を指定する」→「タップで囲む」専用のタップ処理。
   *
   * ペン（addRect）と同じ「タップ点を含むスタンプの bbox を検出して、
   * 少し外側へ広げた四角にする」ロジックをそのまま流用し、その四角を
   * move モードの頂点ドラッグで微調整できるようにする（詳しくは
   * retransTempPolyIdRef 参照）。ヒットしない場所をタップした場合は
   * addRect のフォールバックと同じくタップ点中心の正方形にする。
   *
   * addRect と違って pushHistory（ポリゴン形状のundo/redo）も
   * onPolygonsChange（セッション保存）も呼ばない。使い捨ての作業用の形を
   * 本物の編集履歴やセッションへ混ぜたくないため。
   */
  const retransTapEnclose = useCallback((imgX: number, imgY: number) => {
    const iw = imageWRef.current, ih = imageHRef.current;
    let hit: BBox | null = null;
    for (const b of getStampBboxes()) {
      if (imgX >= b.minX && imgX <= b.maxX && imgY >= b.minY && imgY <= b.maxY) {
        if (!hit || b.area < hit.area) hit = b;
      }
    }
    const points: [number, number][] = hit
      ? initialRectFromBBox(hit, iw, ih)
      : (() => {
        const fallbackHalf = Math.min(iw, ih) * RECT_RATIO / 2;
        const x0 = imgX - fallbackHalf, y0 = imgY - fallbackHalf;
        const x1 = imgX + fallbackHalf, y1 = imgY + fallbackHalf;
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      })();
    // 前のタップで残っていた一時ポリゴンがあれば先に片付ける
    // （通常は「やり直す」経由で既に片付いているはずだが、念のため）。
    clearRetransTempPoly();
    const id = nextIdRef.current;
    const next = [...polygonsRef.current, { id, points }];
    setPolygons(next);
    setSelectedId(id);
    setSelectedVertexIdx(null);
    retransTempPolyIdRef.current = id;
    setAppMode('move'); // 頂点ドラッグ操作を有効にする
    setRetransPicking(false);
    // ペンモードと同じく、選び終えたら方式トグルを畳んだ状態にしておく。
    setRetransPanelCompact(true);
  }, [clearRetransTempPoly, getStampBboxes]);

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
    notifyPolygonsChange(next); // 確定操作: セッションに保存
  }, [pushHistory, notifyPolygonsChange]);

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
    notifyPolygonsChange(next); // 確定操作: セッションに保存
  }, [pushHistory, notifyPolygonsChange]);

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
      notifyPolygonsChange(next); // 確定操作: セッションに保存
      return next;
    });
  }, [pushHistory, notifyPolygonsChange]);

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
    notifyPolygonsChange(next); // 確定操作: セッションに保存
  }, [pushHistory, deleteVertex, notifyPolygonsChange]);

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

  /**
   * なぞり終わり・録画終わりの共通処理（指を離した時／決定で録画終了した
   * 時の両方から呼ぶ）。3点未満は面にならないので選択なしとして捨てる。
   * その時点の zoom を使って表示座標→画像座標へ変換するので、後で
   * パン・ズームしても選択範囲自体はズレない。
   */
  const finishRetransTrace = useCallback(() => {
    const pts = retransTraceRef.current;
    retransTraceRef.current = [];
    setRetransTraceLocal([]);
    if (pts.length < 3) return;
    const z = zoomRef.current;
    const imgPts: Array<[number, number]> = pts.map(([lx, ly]) => {
      const { x, y } = localToImage(lx, ly, z);
      return [x, y];
    });
    setRetransMaskPoints(imgPts);
    setRetransPicking(false); // 選択完了 → カード表示（「この範囲を再透過」）へ戻る
    setRetransPanelCompact(true);
  }, []);

  /**
   * 「範囲を指定する」→「ブラシで選択」専用のジェスチャー。メインの
   * PanResponder（パン・ピンチ・頂点操作…）とは完全に分離した、なぞって
   * 囲むためだけの単純な PanResponder。復元ブラシの「なぞった場所だけ」の
   * 仕組みとは別物で、こちらは「なぞって閉じた形の内部全体」を選択範囲に
   * する。
   */
  const retransTraceResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      retransTraceStartRef.current = [locationX, locationY];
      retransTraceRef.current = [[locationX, locationY]];
      setRetransTraceLocal([[locationX, locationY]]);
    },
    // 【重要】evt.nativeEvent.locationX/Y は move イベントの間 iOS だと
    // 更新されず grant 時の値のまま固まることがある（このアプリの復元ブラシ
    // 側でも同じ理由で使っていない）。代わりに gestureState.dx/dy
    // （grant からの累積移動量）を、grant で覚えた開始位置に足して現在位置を
    // 求める。これが「なぞっても線が出ない」不具合の原因だった。
    onPanResponderMove: (_evt, gs) => {
      const [startX, startY] = retransTraceStartRef.current;
      const lx = startX + gs.dx;
      const ly = startY + gs.dy;
      const pts = retransTraceRef.current;
      const last = pts[pts.length - 1];
      // 点が近すぎると無駄に増えてギザギザ・重くなるので間引く。
      if (last && Math.hypot(lx - last[0], ly - last[1]) < 3) return;
      pts.push([lx, ly]);
      setRetransTraceLocal([...pts]);
    },
    onPanResponderRelease: finishRetransTrace,
    onPanResponderTerminate: () => {
      // 電話の着信などでジェスチャーが強制終了された場合。中途半端な形を
      // 選択範囲として確定させない。
      retransTraceRef.current = [];
      setRetransTraceLocal([]);
    },
  })).current;

  /**
   * 「範囲を指定する」→「ブラシで選択」の 'adjust' 設定版。復元ブラシの
   * 録画方式（toggleRestoreRecording）と同じ考え方で、指でなぞる代わりに
   * 「レティクルを画面中央に固定し、決定ボタンで録画のように書き始め／
   * 書き終わりを切り替える」。決定で開始 → 中央固定のまま十字ボタンで
   * パンして画像側を動かすと、その軌跡がなぞったのと同じ意味になる
   * （recordRetransCenterPoint 参照）。もう一度決定を押すと録画終了・確定
   * する（finishRetransRecording を呼ぶ）。
   *
   * 【なぞり(retransTraceRef)とは軌跡の持ち方が違う】指でなぞる版は表示座標
   * をそのまま積んで確定時にまとめて画像座標へ変換する。これは「なぞって
   * いる間はパンできない（1本の指の動きだけで完結する）」から成立する。
   * 'adjust' 版はレティクルが画面中央に固定されたまま画像側がパンで動くので、
   * 「画面中央」という同じ表示座標を毎回積んでも常に同じ点にしかならない
   * （実際にこれで「軌跡が全く残らない」不具合になった）。復元ブラシの
   * recordCenterPoint と同じく、その場で画像座標へ変換してから積む必要が
   * あるため、専用の ref/state を別に持つ。
   */
  const [retransRecording, setRetransRecording] = useState(false);
  const retransRecordingRef = useRef(false);
  const retransRecordingSV = useSharedValue(false);
  /** 録画中の軌跡（画像座標）。retransTraceRef(なぞり用・表示座標)とは別物。 */
  const retransRecordImgRef = useRef<Array<[number, number]>>([]);
  /**
   * 録画中のライブプレビュー用。画像座標のまま持ち、描画側で ds を掛けて
   * 画像と同じ Group（パン/ズーム追従）の内側に描く。retransTraceLocal を
   * 描いている透明レイヤーは非追従の生の画面座標なので、そちらでは
   * 正しく動かせない（詳しくは描画側のコメント参照）。
   */
  const [retransRecordPts, setRetransRecordPts] = useState<Array<[number, number]>>([]);
  const retransRecordRafRef = useRef<number | null>(null);
  const flushRetransRecord = useCallback(() => {
    if (retransRecordRafRef.current != null) return;
    retransRecordRafRef.current = requestAnimationFrame(() => {
      retransRecordRafRef.current = null;
      setRetransRecordPts([...retransRecordImgRef.current]);
    });
  }, []);

  /** 録画終わりの処理。retransRecordImgRef は最初から画像座標なので変換不要。 */
  const finishRetransRecording = useCallback(() => {
    const pts = retransRecordImgRef.current;
    retransRecordImgRef.current = [];
    setRetransRecordPts([]);
    if (pts.length < 3) return;
    setRetransMaskPoints(pts);
    setRetransPicking(false);
    setRetransPanelCompact(true);
  }, []);

  const toggleRetransRecording = useCallback(() => {
    if (retransRecordingRef.current) {
      retransRecordingRef.current = false;
      retransRecordingSV.value = false;
      setRetransRecording(false);
      finishRetransRecording();
      return;
    }
    // 'drag' 設定なら、レティクル位置(dragReticleImg)は既に画像座標なので
    // そのまま使う。それ以外（'adjust'）は画面中央を画像座標へ変換する
    // （toggleRestoreRecording と同じ分岐）。
    let seed: { x: number; y: number } | null;
    if (dragReticleModeRef.current) {
      seed = dragReticleImgRef.current
        ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
    } else {
      const p = canvasCenter();
      seed = p ? localToImage(p.x, p.y, zoomRef.current) : null;
    }
    if (!seed) return;
    retransRecordImgRef.current = [[seed.x, seed.y]];
    setRetransRecordPts([[seed.x, seed.y]]);
    retransRecordingRef.current = true;
    retransRecordingSV.value = true;
    setRetransRecording(true);
  }, [finishRetransRecording, retransRecordingSV]);

  /**
   * パン1フレームぶん、中央固定の画像座標を軌跡に積む。録画中のブラシ選択
   * のみが呼ぶ。復元ブラシの recordCenterPoint と全く同じ仕組み（zoomSV の
   * useAnimatedReaction から呼ばれる。詳しくはそちら参照）。
   */
  const recordRetransCenterPoint = useCallback(() => {
    if (!retransRecordingRef.current) return;
    // recordCenterPoint と同じバグ修正: 'drag' 設定中は画面中央がレティクル
    // 位置と無関係なので、ここでは積まない（'drag' 中の軌跡追加は
    // drag_reticle の move ハンドラだけが担う）。
    if (dragReticleModeRef.current) return;
    const p = canvasCenter();
    if (!p) return;
    const { x, y } = localToImage(p.x, p.y, zoomRef.current);
    retransRecordImgRef.current.push([x, y]);
    flushRetransRecord();
  }, [flushRetransRecord]);

  // ツールを切り替えた／範囲選択を抜けた時に録画中のまま置き去りにしない。
  // 復元ブラシと違い、中途半端な形をそのまま確定するのはノイズになり
  // やすいので、ここでは確定せず素直に捨てる（onPanResponderTerminate と
  // 同じ扱い）。
  useEffect(() => {
    if (!(retransPicking && retransMethod === 'brush') && retransRecordingRef.current) {
      retransRecordingRef.current = false;
      retransRecordingSV.value = false;
      setRetransRecording(false);
      retransRecordImgRef.current = [];
      setRetransRecordPts([]);
    }
  }, [retransPicking, retransMethod, retransRecordingSV]);

  /**
   * ブラシ選択の録画中、zoomSV（パン中に毎フレーム更新される共有値）を
   * 直接監視して軌跡を積む。復元ブラシ側の useAnimatedReaction
   * （recordCenterPoint 参照）と全く同じ仕組みで、こちらは別の
   * useAnimatedReaction として持つ（recordRetransCenterPoint がこの
   * ファイルの後方で定義されているため、依存配列の評価順の都合上
   * 1つにまとめられない）。
   */
  useAnimatedReaction(
    () => zoomSV.value,
    (curr, prev) => {
      if (!prev || !retransRecordingSV.value) return;
      if (curr.tx === prev.tx && curr.ty === prev.ty && curr.scale === prev.scale) return;
      runOnJS(recordRetransCenterPoint)();
    },
    [recordRetransCenterPoint],
  );

  // ── draw モード「なぞって選択」────────────────────────────────────────────
  // 再透過の「ブラシで選択」と全く同じなぞり／録画の仕組みを流用しつつ、
  // 確定した形は retransMaskPoints ではなく通常のカット用ポリゴンとして
  // polygons に追加する（addRect と同じ確定手順）。

  /**
   * なぞり終わり（指を離した・録画を止めた、どちらからも呼ぶ）の共通処理。
   * simplifyClosedTrace で頂点数を編集できる程度まで間引いてから、addRect と
   * 同じ「pushHistory → polygons へ追加 → 選択して move モードへ」という
   * 確定手順を踏む。3点未満は面にならないので選択なしとして捨てる
   * （finishRetransTrace と同じ扱い）。
   */
  const finishDrawTrace = useCallback((rawPts: Array<[number, number]>) => {
    if (rawPts.length < 3) return;
    const points = simplifyClosedTrace(rawPts);
    const id = nextIdRef.current;
    pushHistory();
    const next = [...polygonsRef.current, { id, points }];
    setPolygons(next);
    setSelectedId(id);
    // addRect と同じ理由（コメント参照）で、'drag' 設定は先頭の頂点を
    // 自動選択しておく。
    setSelectedVertexIdx(settingsRef.current.loupeMode === 'drag' ? 0 : null);
    setAppMode('move'); // 追加後すぐ移動モードで頂点を微調整できるよう切替
    // addRect と同じ理由で、選び終えたら方式トグルを畳んだ状態にしておく。
    setDrawPanelCompact(true);
    notifyPolygonsChange(next); // 確定操作: セッションに保存
  }, [pushHistory, notifyPolygonsChange]);

  /** 指でなぞる版（'fixed' 設定）の終わり。表示座標→画像座標へ変換してから finishDrawTrace へ渡す。 */
  const finishDrawFingerTrace = useCallback(() => {
    const pts = drawTraceRef.current;
    drawTraceRef.current = [];
    setDrawTraceLocal([]);
    if (pts.length < 3) return;
    const z = zoomRef.current;
    const imgPts: Array<[number, number]> = pts.map(([lx, ly]) => {
      const { x, y } = localToImage(lx, ly, z);
      return [x, y];
    });
    finishDrawTrace(imgPts);
  }, [finishDrawTrace]);

  /**
   * 「なぞって選択」専用のジェスチャー。メインの PanResponder（パン・ピンチ・
   * 頂点操作…）とは完全に分離した、なぞって囲むためだけの単純な
   * PanResponder（retransTraceResponder と同じ作り）。
   */
  const drawTraceResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      drawTraceStartRef.current = [locationX, locationY];
      drawTraceRef.current = [[locationX, locationY]];
      setDrawTraceLocal([[locationX, locationY]]);
    },
    // evt.nativeEvent.locationX/Y を使わない理由は retransTraceResponder と同じ
    // （move イベント中 iOS で固まることがあるため gestureState.dx/dy を使う）。
    onPanResponderMove: (_evt, gs) => {
      const [startX, startY] = drawTraceStartRef.current;
      const lx = startX + gs.dx;
      const ly = startY + gs.dy;
      const pts = drawTraceRef.current;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(lx - last[0], ly - last[1]) < 3) return;
      pts.push([lx, ly]);
      setDrawTraceLocal([...pts]);
    },
    onPanResponderRelease: finishDrawFingerTrace,
    onPanResponderTerminate: () => {
      drawTraceRef.current = [];
      setDrawTraceLocal([]);
    },
  })).current;

  /** 録画終わりの処理。drawRecordImgRef は最初から画像座標なので変換不要。 */
  const finishDrawRecording = useCallback(() => {
    const pts = drawRecordImgRef.current;
    drawRecordImgRef.current = [];
    setDrawRecordPts([]);
    finishDrawTrace(pts);
  }, [finishDrawTrace]);

  /** 「なぞって選択」の 'adjust'/'drag' 設定版。toggleRetransRecording と同じ考え方。 */
  const toggleDrawRecording = useCallback(() => {
    if (drawRecordingRef.current) {
      drawRecordingRef.current = false;
      drawRecordingSV.value = false;
      setDrawRecording(false);
      finishDrawRecording();
      return;
    }
    let seed: { x: number; y: number } | null;
    if (dragReticleModeRef.current) {
      seed = dragReticleImgRef.current
        ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
    } else {
      const p = canvasCenter();
      seed = p ? localToImage(p.x, p.y, zoomRef.current) : null;
    }
    if (!seed) return;
    drawRecordImgRef.current = [[seed.x, seed.y]];
    setDrawRecordPts([[seed.x, seed.y]]);
    drawRecordingRef.current = true;
    drawRecordingSV.value = true;
    setDrawRecording(true);
  }, [finishDrawRecording, drawRecordingSV]);

  /** パン1フレームぶん、中央固定の画像座標を軌跡に積む。recordRetransCenterPoint と同じ仕組み。 */
  const recordDrawCenterPoint = useCallback(() => {
    if (!drawRecordingRef.current) return;
    // recordCenterPoint と同じバグ修正: 'drag' 設定中は画面中央がレティクル
    // 位置と無関係なので、ここでは積まない（'drag' 中の軌跡追加は
    // drag_reticle の move ハンドラだけが担う）。
    if (dragReticleModeRef.current) return;
    const p = canvasCenter();
    if (!p) return;
    const { x, y } = localToImage(p.x, p.y, zoomRef.current);
    drawRecordImgRef.current.push([x, y]);
    flushDrawRecord();
  }, [flushDrawRecord]);

  // draw+trace を抜けた時に録画中のまま置き去りにしない（retrans と同じ理由 —
  // 中途半端な形をそのまま確定するのはノイズになりやすいので素直に捨てる）。
  useEffect(() => {
    if (!(appMode === 'draw' && drawMethod === 'trace') && drawRecordingRef.current) {
      drawRecordingRef.current = false;
      drawRecordingSV.value = false;
      setDrawRecording(false);
      drawRecordImgRef.current = [];
      setDrawRecordPts([]);
    }
  }, [appMode, drawMethod, drawRecordingSV]);

  useAnimatedReaction(
    () => zoomSV.value,
    (curr, prev) => {
      if (!prev || !drawRecordingSV.value) return;
      if (curr.tx === prev.tx && curr.ty === prev.ty && curr.scale === prev.scale) return;
      runOnJS(recordDrawCenterPoint)();
    },
    [recordDrawCenterPoint],
  );

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
    const rawSelId = selectedIdRef.current;
    // 見えていないポリゴン（isPolyVisible が false）に対しては、辺ヒット
    // 判定も内部タップでの選択もしない。表示していない図形にタップで
    // 選択・選択解除・頂点挿入が起きるとかえって混乱するため。
    const selId  = (rawSelId != null && isPolyVisible(rawSelId)) ? rawSelId : null;
    const polys  = polygonsRef.current.filter(p => isPolyVisible(p.id));

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
    const nextId = hit ? (hit.id === selId ? null : hit.id) : null;
    if (nextId == null && retransOpenRef.current) {
      // 選択解除（同じポリゴンの再タップ／空タップ）。再透過が開いている間は
      // setSelectedId(null) するだけだと複製（青ハイライト）が polygons
      // 配列に残ってしまう（decideMoveSelect 参照）。clearRetransTempPoly で
      // 複製の削除と選択解除を同時に行う。
      clearRetransTempPoly();
    } else {
      setSelectedId(nextId);
      setSelectedVertexIdx(null); // ポリゴン選択変更で頂点選択は解除
    }
  }, [insertVertex, isPolyVisible, clearRetransTempPoly]);

  /**
   * 決定ボタン。ツールごとに「確定する場所／タイミング」が違うので振り分ける。
   *
   * ・スポイト／四角追加: 'adjust' 設定は画面中央に固定したレティクルの位置、
   *   'drag' 設定は指ドラッグで動かしてきたレティクル位置（dragReticleImg）。
   *   どちらも決定を押すとその場で1回確定する（指を離しただけでは確定しない
   *   —— 'drag' で別指に持ち替えて位置合わせを続けても誤って確定しないように）。
   * ・復元ブラシ: 単発の点ではなく軌跡が要るので、決定は「録画」の開始／
   *   終了トグルにしてある（toggleRestoreRecording）。
   * ・移動・調整: ハンドルを直接つまむ操作なので決定ボタン自体を出さない
   *   （呼び出し側の onDecide 条件で除外）。
   */
  const decideAtReticle = useCallback(() => {
    const mode = appModeRef.current;
    if (mode === 'restore') {
      toggleRestoreRecording();
      return;
    }
    // draw モード「なぞって選択」の 'adjust'/'drag' 設定版: 復元ブラシ・
    // 再透過のブラシ選択と同じく、決定は「録画」の開始／終了トグルにする
    // （toggleDrawRecording が dragReticleModeRef の分岐を内部で持つので、
    // 下の 'drag' 分岐より先にここで振り分ける）。
    if (mode === 'draw' && drawMethodRef.current === 'trace') {
      toggleDrawRecording();
      return;
    }
    if (dragReticleModeRef.current) {
      const p = dragReticleImgRef.current
        ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
      if (mode === 'eyedropper') {
        const { sx, sy } = imageToLocal(p.x, p.y, zoomRef.current);
        commitEyedropAt(sx, sy);
      } else if (mode === 'draw') {
        addRect(p.x, p.y);
      }
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
  }, [toggleRestoreRecording, commitEyedropAt, addRect, toggleDrawRecording]);

  /**
   * 再透過「範囲を指定してください」→「タップで囲む」用の決定ボタン。
   * 'adjust' 設定は指でタップする代わりに、画面中央固定のレティクルを
   * パン（十字ボタン）で狙いに合わせてから決定を押す。'drag' 設定は指で
   * レティクルそのものをつまんで動かした位置を使う（addRect の 'drag'
   * 分岐と同じ考え方）。
   */
  const decideRetransTapEnclose = useCallback(() => {
    if (dragReticleModeRef.current) {
      const p = dragReticleImgRef.current
        ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
      retransTapEnclose(p.x, p.y);
      return;
    }
    const p = canvasCenter();
    if (!p) return;
    const { x, y } = localToImage(p.x, p.y, zoomRef.current);
    retransTapEnclose(x, y);
  }, [retransTapEnclose]);

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
      // 再透過が開いている間の選択解除は、単に setSelectedId(null) するだけだと
      // 元ポリゴンの複製（青色でハイライトした一時ポリゴン）が polygons
      // 配列に残ったままになる。selectedId が null になると isPolyVisible が
      // 「未選択なら全部見せる」に倒れるため、消えたはずの複製が元の
      // ポリゴンと一緒に見えてしまう（報告のあった「青色が残る」不具合）。
      // clearRetransTempPoly が複製の削除と選択解除を同時にやってくれるので
      // そちらを使う。
      if (retransOpenRef.current) {
        clearRetransTempPoly();
      } else {
        setSelectedId(null);
        setSelectedVertexIdx(null);
      }
      return;
    }

    const isDrag = settingsRef.current.loupeMode === 'drag';
    const z = zoomRef.current;
    // 'drag' 設定は、指でドラッグしてきた独立レティクル(dragReticleImgRef、
    // 画像座標)を狙い所にする。'adjust' は従来通りキャンバス中央固定
    // （パンして狙いを合わせる方式なので、狙い所は常にキャンバス中央）。
    const p = isDrag
      ? (dragReticleImgRef.current
        ? (() => { const { sx, sy } = imageToLocal(dragReticleImgRef.current!.x, dragReticleImgRef.current!.y, z); return { x: sx, y: sy }; })()
        : null)
      : canvasCenter();
    if (!p) return;
    // 見えていないポリゴンは対象にしない（isPolyVisible と同じ考え方。
    // 再透過が開いている間は対象の一時ポリゴン以外は見えないので、
    // ここでも自動的にそれ以外へは触れなくなる）。
    const polys = polygonsRef.current.filter(poly => isPolyVisible(poly.id));
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
      } else if (retransOpenRef.current) {
        // 上と同じ理由（複製の消し忘れ防止）。
        clearRetransTempPoly();
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
      // 'drag' 設定はここでブロック選択に必ず止める（頂点までは自動ロック
      // しない）。ブロック移動と頂点移動を確実に別段階にするため —— 頂点まで
      // 進みたければ、レティクルを頂点へ合わせてもう一度決定を押す（②）。
      // 'adjust' は従来通り、近くに頂点があれば一緒にロックする。
      if (!isDrag) {
        const idx = nearestVertexOf(inside);
        if (idx >= 0) setSelectedVertexIdx(idx);
      }
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
  }, [showToast, t, isPolyVisible, clearRetransTempPoly]);

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
    // retransBrushActiveRef: 「範囲を指定する」→「ブラシで選択」でなぞって
    // いる間は、メイン側は一切 responder になろうとしない（詳しくは
    // retransBrushActiveRef の定義コメント参照）。drawTraceActiveRef も
    // draw モード「なぞって選択」（'fixed' 設定）版として全く同じ理由で譲る。
    onStartShouldSetPanResponder: () => !eyeBusyRef.current && !retransBrushActiveRef.current && !drawTraceActiveRef.current,
    // 微小なジッタ（タップ時の指ブレ）では responder を奪わず、明確なドラッグ
    // （PAN_THRESHOLD=8px 以上の移動）のときだけパンを開始する。これにより
    // キャンバス上のフローティングボタンの onPress が横取りされず生き残る。
    onMoveShouldSetPanResponder:  (_, gs) =>
      !uiInteractingRef.current && !retransBrushActiveRef.current && !drawTraceActiveRef.current &&
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

      // 'drag' 設定: レティクル（編集位置）を指ドラッグで直接動かす。3ツール共通、
      // それに加えて再透過「範囲を指定してください」中は move モードでも
      // 有効（dragReticleMode 自体の定義がその時だけ move を含むようにして
      // ある）。ピッキング中は selId が強制的に null になっていて頂点/辺/
      // 全体ドラッグの判定はどれも通らないので、ここで move モード分を
      // 追加しても既存の直接操作とはぶつからない。
      // キャンバス自体はパンさせず、dragReticleImg（画像座標）だけを動かす。
      // 指を離しても何も確定しない（下の release 側は 'drag_reticle' に反応する
      // 分岐を持たない）。別指で改めて位置合わせを続けても誤って確定しないよう、
      // 確定は必ず決定ボタン（decideAtReticle／復元ブラシは録画トグル／再透過は
      // decideRetransTapEnclose・toggleRetransRecording）の役目にする。
      // dragReticleModeRef 自体が対象ツール(スポイト・四角追加・復元ブラシ・
      // 再透過ピッキング中のmove)を内包した条件なので、ここでの appMode
      // 再チェックは不要。dragMoveFreeReticleRef は「'drag' 設定・move・
      // 何も選択していない」ケース専用（selectedId が dragReticleMode の
      // 宣言より後で state 宣言されているため、別変数にして OR している）。
      if (dragReticleModeRef.current || dragMoveFreeReticleRef.current) {
        gPhase.current = 'drag_reticle';
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        const p = dragReticleImgRef.current
          ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
        showLoupeAtImg(p.x, p.y, lx, ly);
        return;
      }

      // draw / eyedropper（'fixed' モード）はどちらも「タップで確定」。ここでは
      // pending にするだけで、release 側で移動量を見てタップかパンかを判定する。
      // こうすることでスポイト中でもキャンバスのパン・ピンチがそのまま使える
      // （grant で即実行すると、見回すためのパン開始で誤って色が消える）。
      if (appModeRef.current === 'draw' || appModeRef.current === 'eyedropper') {
        gPhase.current = 'pending';
        // どちらも押した瞬間の位置がそのまま確定候補になるので、押している
        // 間だけでも「どこに置く／どこを吸うのか」を見せる価値がある。
        showLoupe(lx, ly);
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

      // 'drag' 設定・move モード: すでに頂点を選択している間は、キャンバスの
      // どこを触っても「選択中の頂点をドラッグ量ぶん動かす」操作にする
      // （丸を直接つまむ必要をなくす）。頂点/辺/全体ドラッグや別ポリゴンの
      // タップ選択より前に判定し、選択中は一本指ドラッグをこれ専有にする。
      // 選び直し・解除は決定ボタン（decideMoveSelect、moveSelectEnabled）で行う。
      if (dragMoveVertexActiveRef.current) {
        gPhase.current = 'drag_vertex_free';
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        dragVertexMovedRef.current = false;
        return;
      }

      // move モード: 選択中ポリゴンの頂点ヒット判定
      // 見えていないポリゴン（isPolyVisible が false）に触れて頂点/辺/全体
      // ドラッグへ入ってしまわないよう、選択中でも見えていなければ selId を
      // null 扱いにし、ここから先の3つの判定ブロックをまとめてスキップして
      // 下の通常のパン処理へフォールスルーさせる。
      const rawSelId = selectedIdRef.current;
      const selId = (rawSelId != null && isPolyVisible(rawSelId)) ? rawSelId : null;
      // 'drag' 設定は頂点の直接ヒットテストを封印し、レティクル操作
      // （dragMoveVertexActive／決定ボタン）だけに統一する（dragMoveUnified 参照）。
      if (selId !== null && !dragMoveUnifiedRef.current) {
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
              // 掴んだ瞬間にルーペをその頂点へ出す。'固定' 設定の時だけ
              // （'微調整'/'ドラッグ調整' はレティクル位置の考え方が違うため対象外）。
              if (!reticleFixedRef.current && !dragReticleModeRef.current) {
                showLoupe(lx, ly);
              }

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
              // '固定' 設定の時だけ、掴んだ瞬間にルーペを出す。
              if (!reticleFixedRef.current && !dragReticleModeRef.current) {
                showLoupe(lx, ly);
              }
              return;
            }
          }
        }
      }

      // 'drag' 設定・move モード: ポリゴン（ブロック）だけ選択済み・頂点は
      // 未選択の間は、キャンバスのどこを触ってドラッグしてもポリゴン全体が
      // そのドラッグ量だけ平行移動する（丸/面を直接つまむ必要をなくす）。
      // 辺のヒットテスト（上）は残すので、そこに触れなかった場合だけここに来る。
      if (dragMovePolyActiveRef.current) {
        gPhase.current = 'drag_poly_free';
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        dragVertexMovedRef.current = false;
        return;
      }

      // ── ポリゴン全体移動の判定 ────────────────────────────────────────────
      // 頂点・辺のどちらにも当たらず、選択中ポリゴンの内部をタップした場合に
      // ポリゴン全体をドラッグ移動するモードに入る。'drag' 設定は上の
      // dragMovePolyActive に統一するため、ここは 'fixed'/'adjust' 専用になる。
      // 再透過カードが開いている間は、対象の一時ポリゴン（タップで囲むで
      // 作った物／既存ポリゴンの複製）だけ全体移動を許可する。本物の
      // ポリゴンではない使い捨ての複製なので、位置を丸ごとずらしても事故に
      // ならない（本物は selId に来ないよう isPolyVisible 側で既に除外して
      // あるので、ここでの分岐は主に「対象すら選ばれていない状態でのパン」
      // との区別のため）。
      if (selId !== null && !dragMoveUnifiedRef.current
        && (!retransOpenRef.current || selId === retransTempPolyIdRef.current)) {
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
            // '固定' 設定の時だけ、掴んだ瞬間にルーペを出す。
            if (!reticleFixedRef.current && !dragReticleModeRef.current) {
              showLoupe(lx, ly);
            }
            return;
          }
        }
      }

      // 頂点/辺/ポリゴンのどれも掴まなかった素のパン。以前は実際に
      // PAN_THRESHOLD を超えて動くまでルーペを出しておらず、指を置き直す
      // たびにルーペが古い位置に取り残されて見えた（特に選択中の頂点が
      // ある 'ドラッグ調整' 設定で、ルーペの中身とレティクル印がズレて見える
      // 原因になっていた）。触れた瞬間から追従を始めておく。
      // '微調整' 設定は常にレティクル（選択中の頂点／キャンバス中央）を映す
      // 方式なので、ここでは呼ばない（指の位置を出すと逆にレティクルから
      // 外れて見えてしまう）。
      if (!loupeIsAdjustRef.current) {
        showLoupe(lx, ly);
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
        // 変化しないポリゴンは同じ参照を返す → pathCacheRef がヒットし Path 再生成なし。
        // ベースは dragLastPolygonsRef（このドラッグ中の最新形状）—— setPolygons の
        // React への反映が rAF で遅れても、次のイベントは必ず最新の形状から
        // 差分を積むので巻き戻らない（詳しくは dragPolygonsRafRef 付近のコメント）。
        {
          const base = dragLastPolygonsRef.current ?? polygonsRef.current;
          const next = base.map(p => {
            if (p.id !== polyId) return p;
            const pts = [...p.points] as [number, number][];
            pts[vIdx] = [imgX, imgY];
            return { ...p, points: pts };
          });
          // 辺・ポリゴン移動と同じくルーペで位置を追従させる。'微調整'/'ドラッグ
          // 調整' 設定では、頂点を選択済み(selectedVertexIdx)にならないと
          // moveNudgePoint が使えず、ドラッグ中はレティクルが動いた頂点を
          // 映さない（キャンバス中央にフォールバックしたままになる）問題が
          // あったため、設定に関わらず常時ルーペを追従させる。
          // showLoupe(lx, ly) を別途呼ぶと scheduleLoupe の rAF と
          // scheduleDragPolygons の rAF が2本走り、同じフレームでも発火が
          // ずれて再レンダーが2回に分かれることがあったため、
          // updateDragVertexLive で1本の rAF にまとめる（imgX/imgY は
          // showLoupe が内部で計算する localToImage と同じ値なのでそのまま使う）。
          updateDragVertexLive(next, imgX, imgY, lx, ly);
        }
        return;
      }

      // ── 'drag' 設定: 選択済みの頂点をどこでもドラッグで動かす ─────────────
      // drag_vertex と違い、指が頂点の真上にある前提を置かない。表示px の
      // 差分をズーム倍率で画像pxへ変換し、頂点位置に加算する（頂点/辺/
      // ポリゴンドラッグと同じ変換式）。ルーペは意図的に更新しない — ここで
      // showLoupe(指の位置) を呼ぶと、頂点の実際の位置ではなく指の位置を
      // 映してしまう。moveNudgePoint（selectedPoly から毎レンダー再計算される
      // 選択中頂点の位置）が setPolygons のたびに追従するので、それに任せる。
      if (gPhase.current === 'drag_vertex_free') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;
        const dxImg = (lx - gPrevLX.current) / z.scale / dsRef.current;
        const dyImg = (ly - gPrevLY.current) / z.scale / dsRef.current;
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        const polyId = selectedIdRef.current;
        const vIdx   = selectedVertexIdxRef.current;
        if (polyId == null || vIdx == null) {
          gPhase.current = 'idle';
          return;
        }
        if (!dragVertexMovedRef.current) {
          dragVertexMovedRef.current = true;
          pushHistory();
        }
        {
          const base = dragLastPolygonsRef.current ?? polygonsRef.current;
          const next = base.map(p => {
            if (p.id !== polyId) return p;
            const pts = [...p.points] as [number, number][];
            pts[vIdx] = [pts[vIdx][0] + dxImg, pts[vIdx][1] + dyImg];
            return { ...p, points: pts };
          });
          scheduleDragPolygons(next);
        }
        return;
      }

      // ── 'drag' 設定: 選択済みのブロックをどこでもドラッグで動かす ─────────
      // drag_poly と違い、指がポリゴン内部にある前提を置かない。drag_vertex_free
      // と同じ変換式で、選択中ポリゴンの全頂点を同じ量だけ平行移動する。
      if (gPhase.current === 'drag_poly_free') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;
        const dxImg = (lx - gPrevLX.current) / z.scale / dsRef.current;
        const dyImg = (ly - gPrevLY.current) / z.scale / dsRef.current;
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        const polyId = selectedIdRef.current;
        if (polyId == null) {
          gPhase.current = 'idle';
          return;
        }
        if (!dragVertexMovedRef.current) {
          dragVertexMovedRef.current = true;
          pushHistory();
        }
        {
          const base = dragLastPolygonsRef.current ?? polygonsRef.current;
          const next = base.map(p => {
            if (p.id !== polyId) return p;
            const pts = p.points.map(([x, y]) => [x + dxImg, y + dyImg]) as [number, number][];
            return { ...p, points: pts };
          });
          scheduleDragPolygons(next);
        }
        return;
      }

      // ── 辺ドラッグ (両端頂点を同時移動) ──────────────────────────────────
      if (gPhase.current === 'drag_edge') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;
        // 辺も指の真下に来るので、頂点ドラッグと同じくルーペで位置を見せる。
        showLoupe(lx, ly);

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

        {
          const base = dragLastPolygonsRef.current ?? polygonsRef.current;
          const next = base.map(p => {
            if (p.id !== polyId) return p;
            const pts = [...p.points] as [number, number][];
            pts[ia] = [pts[ia][0] + dxImg, pts[ia][1] + dyImg];
            pts[ib] = [pts[ib][0] + dxImg, pts[ib][1] + dyImg];
            return { ...p, points: pts };
          });
          scheduleDragPolygons(next);
        }
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
        {
          const base = dragLastPolygonsRef.current ?? polygonsRef.current;
          const next = base.map(p => {
            if (p.id !== polyId) return p;
            const pts = p.points.map(([x, y]) => [x + dxImg, y + dyImg]) as [number, number][];
            return { ...p, points: pts };
          });
          // 指の真下が隠れるのは他のドラッグと同じなので、ルーペで位置を見せる。
          // showLoupe(lx, ly) を別途呼ぶと rAF が2本走り、同じフレームでも
          // 発火がずれて再レンダーが2回に分かれることがあるため、drag_vertex
          // と同じく updateDragPolyLive で1本の rAF にまとめる（imgX/imgY は
          // showLoupe が内部で計算する localToImage と同じ式で求める）。
          const { x: imgX, y: imgY } = localToImage(lx, ly, z);
          updateDragPolyLive(next, imgX, imgY, lx, ly);
        }
        return;
      }

      // ── 二本指: 拡大縮小＋移動（どのツールでも使える）─────────────────
      // 以前は移動モードでしか効かず、スポイトや復元ブラシの最中に見る場所を
      // 変えたいときに、いちいちツールを切り替える必要があった。
      // 二本指はどのツールでも「見る場所を変える」操作として空いているので、
      // そこに割り当てる（一本指はツールごとの操作のまま）。'drag' 設定の
      // レティクル調整中（drag_reticle）も対象— 二本目の指が乗ったら
      // レティクル移動より優先してパン/ピンチへ切り替える。
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

      // ── 'drag' 設定: レティクルを指ドラッグで動かす（3ツール共通）───────
      // キャンバスはパンさせず、レティクル位置(dragReticleImg)だけを、頂点/辺/
      // ポリゴンのドラッグと同じ変換式（表示px差分 ÷ ズーム倍率）で動かす。
      // ズームが高いほど同じ指の移動量でもレティクルは少ししか動かない。
      // 二本指チェックより後に置くことで、二本目の指が乗った瞬間はそちらの
      // パン/ピンチへ切り替わり、片手でレティクル調整→もう一方の指で
      // 見る場所を調整、が両立する。
      if (gPhase.current === 'drag_reticle') {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const z  = zoomRef.current;
        // locationX/Y ベースの差分をそのまま使う（一番指に正確・滑らかに
        // 追従する）。ただし指がフッター/ヘッダーのボタン等、別のネイティブ
        // ビューに一瞬重なると、iOS では locationX/Y がそのビュー基準の値に
        // 化けることがあり、それをそのまま「前フレームとの差分」に使うと
        // その1フレームだけ巨大な差分が積算されてレティクルが吹っ飛ぶ
        // （実際に報告のあった不具合）。
        // 対策は「別の値に差し替える」のではなく「そのフレームは無かった
        // ことにする」——gPrevLX/LY を更新せずに抜けることで、次のフレームで
        // 改めて今の（もう正常に戻っているはずの）locationX との差分を
        // 取り直せるようにする。gestureState.dx/dy に丸ごと乗り換える／
        // 差し替える案も試したが、locationX ほど追従が良くないらしく
        // 「もたつく」「指から少しずつ離れていく」と感じられたため、通常時は
        // 必ず locationX/Y を使う方針に戻した。
        const dxScreen = lx - gPrevLX.current;
        const dyScreen = ly - gPrevLY.current;
        const MAX_STEP_PX = 80; // 1フレーム(~16ms)で指が現実的に動きうる上限の目安
        if (Math.abs(dxScreen) > MAX_STEP_PX || Math.abs(dyScreen) > MAX_STEP_PX) {
          return;
        }
        gPrevLX.current = lx;
        gPrevLY.current = ly;
        const dxImg = dxScreen / z.scale / dsRef.current;
        const dyImg = dyScreen / z.scale / dsRef.current;
        const base = dragReticleImgRef.current
          ?? clampReticleImg(imageWRef.current / 2, imageHRef.current / 2);
        const next = clampReticleImg(base.x + dxImg, base.y + dyImg);
        updateDragReticleLive(next, lx, ly);
        // 復元ブラシは「録画中」(決定ボタンで開始済み)の間だけ、動いた軌跡を積む。
        // adjust 設定の recordCenterPoint と同じ考え方 — レティクルを動かすだけでは
        // 何も確定せず、録画トグルが入っている時だけ軌跡として記録する。
        if (appModeRef.current === 'restore' && restoreRecordingRef.current) {
          strokeImgRef.current.push([next.x, next.y]);
          flushStroke();
        }
        // 再透過のブラシ選択も同じ考え方。'drag' 設定でレティクルを動かして
        // いる間、録画中（toggleRetransRecording で開始済み）なら軌跡を積む。
        if (retransOpenRef.current && retransPickingRef.current
          && retransMethodRef.current === 'brush' && retransRecordingRef.current) {
          retransRecordImgRef.current.push([next.x, next.y]);
          flushRetransRecord();
        }
        // draw モード「なぞって選択」も同じ考え方。'drag' 設定でレティクルを
        // 動かしている間、録画中（toggleDrawRecording で開始済み）なら軌跡を積む。
        if (appModeRef.current === 'draw' && drawMethodRef.current === 'trace' && drawRecordingRef.current) {
          drawRecordImgRef.current.push([next.x, next.y]);
          flushDrawRecord();
        }
        return;
      }

      // スポイト・ペン(draw): 押したまま動かして狙いを定められるよう、指を追って
      // ルーペを更新する。以前は押した瞬間の1回しか出しておらず、動かしても
      // ルーペが固まったままだった。
      // reticleFixed 中はこの経路を使わず、下のパン処理に流す
      // （狙いは画面を動かして合わせるので、指の位置そのものは見せない）。
      if (gPhase.current === 'pending'
        && (appModeRef.current === 'eyedropper' || appModeRef.current === 'draw')
        && !reticleFixedRef.current) {
        showLoupe(gStartLX.current + gs.dx, gStartLY.current + gs.dy);
        return;
      }

      // 復元ブラシ（'fixed' モード）: 指の軌跡を貯める。実際の画素書き換えは
      // 離した時に1回だけ行う（毎フレーム画像全体を作り直すと重すぎるため）。
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
          // reticleFixed 中はレティクルが画面中央固定で、ルーペの追従・復元
          // ブラシの軌跡積みは下の useAnimatedReaction(zoomSV監視)がまとめて
          // 処理する。'move' モードの '微調整' 設定も同じくレティクル
          // （選択中の頂点／キャンバス中央）固定で追従するので、指の位置は
          // 使わない。それ以外（'move' モードの素のパン、'固定'/'ドラッグ調整'
          // 設定）は、指の真下も他のドラッグと同じく隠れるのでルーペで見せる。
          if (!reticleFixedRef.current && !loupeIsAdjustRef.current) {
            showLoupeThrottled(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
          }
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

      // 頂点/辺/ポリゴンドラッグ中、まだ rAF 待ちの polygons があれば
      // ここで確定させる。以降の分岐が読む polygons state（や、この直後の
      // 再レンダー）が最後の指の位置に確実に追いついた状態にするため
      // （dragLastPolygonsRef 自体は move のたびに同期更新済みなので、
      // 下の notifyPolygonsChange 呼び出しはこの flush の有無に関わらず
      // 最終座標を渡せるが、Canvas 側の表示を取り残さないために必要）。
      flushDragPolygons();

      if (gPhase.current === 'drag_vertex') {
        // バグ修正: updater 関数は render フェーズで実行されるため、
        // その時点では dragVertexIdxRef.current がすでに null になっている。
        // ローカル変数に capture してから ref を clear する。
        const capturedVIdx = dragVertexIdxRef.current;
        dragPolyIdRef.current    = null;
        dragVertexIdxRef.current = null;
        dragVertexMovedRef.current = false;
        gPhase.current = 'idle';

        // 移動なし（タップ）= 頂点を選択状態にする。移動あり = 選択を解除
        // ……が、'drag' 設定だけは例外。丸を直接つまんで動かした場合でも
        // 選択を保ったままにする（動かした瞬間に解除されると、次の
        // タッチから dragMoveVertexActive の「どこでもドラッグ」に入れず、
        // 毎回また丸を直接つまみ直す羽目になるため）。
        // dragVertexMovedRef.current はすでに false にリセット済みなので
        // gs.dx/dy で判定する（gs は PanResponder が集計した累積移動量）。
        const tapped = Math.abs(gs.dx) <= PAN_THRESHOLD && Math.abs(gs.dy) <= PAN_THRESHOLD;
        if (settingsRef.current.loupeMode === 'drag') {
          if (tapped && capturedVIdx !== null) {
            // 同じ頂点を再タップでトグル解除、別の頂点なら選択
            setSelectedVertexIdx(prev => prev === capturedVIdx ? null : capturedVIdx);
          } else if (capturedVIdx !== null) {
            setSelectedVertexIdx(capturedVIdx);
          }
        } else if (tapped && capturedVIdx !== null) {
          // 同じ頂点を再タップでトグル解除、別の頂点なら選択
          // capture した値を updater 内で使う（ref は null 済みのため参照不可）
          setSelectedVertexIdx(prev => prev === capturedVIdx ? null : capturedVIdx);
        } else {
          setSelectedVertexIdx(null); // ドラッグ移動したら頂点選択を解除
        }
        // dragLastPolygonsRef が null でない = 実際に移動が起きた → セッションに保存
        if (dragLastPolygonsRef.current) {
          notifyPolygonsChange(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        return;
      }

      if (gPhase.current === 'drag_poly') {
        dragPolyIdRef.current = null;
        gPhase.current = 'idle';
        if (dragLastPolygonsRef.current) {
          notifyPolygonsChange(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        return;
      }

      // 'drag' 設定: 選択済みの頂点をどこでもドラッグで動かした後。drag_vertex
      // と違い、移動後も選択を解除しない — 同じ頂点を続けて微調整できるように
      // する（選び直し・解除は決定ボタンの役目）。
      if (gPhase.current === 'drag_vertex_free') {
        dragVertexMovedRef.current = false;
        gPhase.current = 'idle';
        if (dragLastPolygonsRef.current) {
          notifyPolygonsChange(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        return;
      }

      // 'drag' 設定: 選択済みのブロックをどこでもドラッグで動かした後。
      // drag_vertex_free と同じく、移動後も選択を解除しない（解除は決定ボタン）。
      if (gPhase.current === 'drag_poly_free') {
        dragVertexMovedRef.current = false;
        gPhase.current = 'idle';
        if (dragLastPolygonsRef.current) {
          notifyPolygonsChange(dragLastPolygonsRef.current);
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
          notifyPolygonsChange(dragLastPolygonsRef.current);
          dragLastPolygonsRef.current = null;
        }
        dragEdgeMovedRef.current   = false;
        dragPolyIdRef.current      = null;
        gPhase.current = 'idle';
        return;
      }

      // 'drag' 設定: 指を離しただけでは何も確定しない。位置合わせを別指で
      // 続けても誤って確定しないよう、確定は決定ボタン（decideAtReticle／
      // 復元ブラシは録画トグル）だけの役目にする。ここでは何もせず、
      // 下の共通処理（hideLoupe/commitZoom/idle化）だけを通す。

      if (gPhase.current === 'pending') {
        const moved = Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD;
        // スポイトだけは「動かしてから離す」を正式な操作にしているので、
        // 移動量で捨てない。ルーペで位置を確かめてから離す使い方に合わせる。
        // （以前はここで moved 判定に弾かれ、微調整すると何も起きなかった）
        // reticleFixed 中は、タップだけでは何も確定しない（狙いは画面を
        // 動かして合わせ、確定は決定ボタンの役目）。
        if ((!moved || appModeRef.current === 'eyedropper') && !reticleFixedRef.current) {
          if (retransPickingRef.current && retransMethodRef.current === 'polygon' && !moved) {
            // 「範囲を指定する」→「タップで囲む」選択中: ペンと同じ
            // bbox 検出でその場に四角を作り、そのまま選択範囲として確定する
            // （addRect と違い polygons には積まない。詳しくは
            // retransTapEnclose 参照）。
            const z = zoomRef.current;
            const { x, y } = localToImage(gStartLX.current, gStartLY.current, z);
            retransTapEnclose(x, y);
          } else if (retransPickingRef.current) {
            // 「範囲を指定してください」段階（方式選択中、またはブラシ選択中）
            // のキャンバスタップは何もしない。ここで handleMoveTap に落ちると
            // 元からあるポリゴンを選択できてしまう（見えないはずのポリゴンへの
            // 当たり判定が残る不具合になっていた）。方式はボタンで選ぶもので、
            // ブラシはなぞり用の透明レイヤーが別途タッチを奪うので、
            // どちらのケースもここでは無視してよい。
          } else if (appModeRef.current === 'draw' && !moved) {
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
          pushPast({ kind: 'edit' });
          setFuture([]);
          const radius = brushRadiusRef.current;
          // 保存サイズ対策。操作列は永続化されるので、同じ場所に溜まった点を
          // 落としてから渡す。塗る側が補間するので結果は変わらない。
          const thinned = thinStroke(pts, radius);
          runHeavy(() => onRestoreRef.current?.(thinned, radius), 'editor.restoreBusy');
        }
      }

      // 離した後もルーペは最後に触れていた位置を映したままにする（ここで
      // hideLoupe() すると毎回キャンバス中央へ戻ってしまい、次に触る場所を
      // 探す手がかりが消えてしまうため、明示的には隠さない）。
      commitZoom();   // ジェスチャー中は SharedValue だけ動かしているので確定する
      gPhase.current = 'idle';
    },

    onPanResponderTerminate: () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current     = null;
        longPressVertexRef.current = null;
      }
      // release と同じく、中断された瞬間までの形状は確定させる（巻き戻さない）。
      // 保存しない（notifyPolygonsChange を呼ばない）のは下の
      // dragLastPolygonsRef=null だけの役目で、polygons state 自体は
      // 最後の位置のまま残す（以前の毎フレーム setPolygons と同じ挙動）。
      flushDragPolygons();
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
      // release と同じく、中断時もルーペは最後の位置のまま残す。
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

  /** ブラシ選択の 'adjust' 録画中の軌跡のパス（画像座標 × ds）。点が無い時は null。 */
  const retransRecordPath = useMemo(() => {
    if (retransRecordPts.length === 0) return null;
    const p = Skia.Path.Make();
    p.moveTo(retransRecordPts[0][0] * ds, retransRecordPts[0][1] * ds);
    for (let i = 1; i < retransRecordPts.length; i++) {
      p.lineTo(retransRecordPts[i][0] * ds, retransRecordPts[i][1] * ds);
    }
    if (retransRecordPts.length === 1) {
      p.lineTo(retransRecordPts[0][0] * ds + 0.01, retransRecordPts[0][1] * ds);
    }
    return p;
  }, [retransRecordPts, ds]);

  /** draw「なぞって選択」の 'adjust'/'drag' 録画中の軌跡のパス（画像座標 × ds）。点が無い時は null。 */
  const drawRecordPath = useMemo(() => {
    if (drawRecordPts.length === 0) return null;
    const p = Skia.Path.Make();
    p.moveTo(drawRecordPts[0][0] * ds, drawRecordPts[0][1] * ds);
    for (let i = 1; i < drawRecordPts.length; i++) {
      p.lineTo(drawRecordPts[i][0] * ds, drawRecordPts[i][1] * ds);
    }
    if (drawRecordPts.length === 1) {
      p.lineTo(drawRecordPts[0][0] * ds + 0.01, drawRecordPts[0][1] * ds);
    }
    return p;
  }, [drawRecordPts, ds]);

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

  // 「範囲を指定する」→「タップで囲む」で作った一時ポリゴンが選択された瞬間に
  // ピッキング状態を終えてカード表示へ戻す（詳しくは retransTapEnclose 参照。
  // 実際は retransTapEnclose が selectedId と retransPicking=false を同時に
  // 設定するのでこの効果はほぼ発火しないが、保険として残す）。
  // ブラシ方式の完了は別（トレース側の onPanResponderRelease で処理する）。
  useEffect(() => {
    if (retransPicking && retransMethod === 'polygon' && selectedId != null) {
      setRetransPicking(false);
      setRetransPanelCompact(true);
    }
  }, [retransPicking, retransMethod, selectedId]);

  /**
   * 再透過カードを開いた直後（まだ「範囲を指定する」を選んでいない段階）でも、
   * 画面上に既にペンで囲んであるポリゴンがあってそれをタップして選択した場合は、
   * わざわざ「範囲を指定する」→「タップで囲む」を経由させず、その場でそれを
   * 対象として扱う。方式選択・ピッキングは「まだ何も囲んでいない」場合の
   * ための手順であって、既にある形をもう一度囲み直させる必要は無いため。
   *
   * retransMethod がまだ null（このエフェクトより前に「タップで囲む」
   * ／「ブラシで選択」を明示的に選んでいない）の時だけ発火する。一時ポリゴン
   * (retransTapEnclose 由来) は退出のたびに片付けているので、ここで
   * selectedId が指しているのは常に本物のポリゴンだけ。
   */
  useEffect(() => {
    if (retransOpen && retransMethod === null && selectedId != null) {
      // 元のポリゴンには一切触れず、複製を作ってそれを対象にする。
      // 対象は頂点をつまんで微調整できる（retransTapEnclose と同じ操作感）が、
      // それをそのまま本物のポリゴンに対して行うと、範囲選択をやり直す／
      // 戻るを押した時に「動かした頂点だけ本物に残ってしまう」（選択解除
      // しても形は元に戻らない）事故になる。複製なら、やめる時は
      // clearRetransTempPoly で複製を消すだけで本物は一切変更されずに済む。
      const original = polygonsRef.current.find(p => p.id === selectedId);
      if (!original) return;
      const cloneId = nextIdRef.current;
      const next = [...polygonsRef.current, {
        id: cloneId,
        points: original.points.map(p => [...p] as [number, number]),
      }];
      setPolygons(next);
      setSelectedId(cloneId);
      setSelectedVertexIdx(null);
      retransTempPolyIdRef.current = cloneId;
      retransTempIsCloneRef.current = true;
      setRetransScope('selection');
      setRetransMethod('polygon');
    }
  }, [retransOpen, retransMethod, selectedId]);

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
  const moveNudgeEnabled = loupeIsAdjust && appMode === 'move' && selectedPoly != null && selectedVertexIdx != null;
  /**
   * move モードで '微調整' 設定の間は、常にレティクル（選択中の頂点、
   * 無ければキャンバス中央）をルーペに映す。指でパンしている間も、指の
   * 位置ではなくレティクルを追従させ続ける — reticleFixed（スポイト等）
   * と同じ「レティクル固定、パンで狙いを合わせる」考え方を move モードにも
   * 揃える。'ドラッグ調整'・'固定' はここに含めない（それぞれ独自の追従方式
   * を維持する）。
   */
  const moveAdjustReticle = loupeIsAdjust && appMode === 'move';
  /**
   * move モードで頂点を選択している間、ルーペ・実寸レティクル印の両方に
   * 映す狙い所（画像座標）＝選択中の頂点。十字ボタン(moveNudgeEnabled)は
   * 'adjust' 設定でしか出さないが、「選択中の頂点をレティクルとして
   * 常に映す」こと自体は 'drag' 設定でも同じように必要（'drag' 設定は
   * 指ドラッグ中のみ dragReticleImg で追従し、それ以外（頂点を選択した
   * 直後など）は何も映さなくなっていたため、常にレティクルへ行く設定に揃える）。
   * 'fixed' はそもそもレティクルという概念を使わないので対象外。
   */
  const moveReticleEnabled = settings.loupeMode !== 'fixed'
    && appMode === 'move' && selectedPoly != null && selectedVertexIdx != null;
  const moveNudgePoint = moveReticleEnabled && selectedPoly && selectedVertexIdx != null
    ? { x: selectedPoly.points[selectedVertexIdx][0], y: selectedPoly.points[selectedVertexIdx][1] }
    : null;
  /**
   * move モードで十字ボタン・決定ボタンを出すかどうか。'adjust'・'drag'
   * どちらの設定でも出す（'fixed' では意味がないので除外）。
   * 'adjust' は十字ボタンでの微調整に、'drag' は決定ボタンによる
   * 選択⇄解除のトグルに使う（頂点選択中はキャンバスの一本指ドラッグを
   * 「選択中の頂点を動かす」操作が専有するため、別の頂点/ポリゴンへ
   * 選び直すには一度ここで解除する必要がある —— dragMoveVertexActive 参照）。
   * 頂点を選択済みかどうかは問わず常時表示する — ボタン自体は常にそこに
   * あってよく、頂点未選択の間に十字を押しても何も起きないだけでよい
   * （nudgeSelection 側で弾く）。決定はトグルなので、こちらも常時表示。
   */
  const moveSelectEnabled = (loupeIsAdjust || settings.loupeMode === 'drag') && appMode === 'move';
  /**
   * 'drag' 設定・move モードで、頂点をすでに選択している間。この間は
   * キャンバスのどこを触ってドラッグしても、選択中の頂点がそのドラッグ量
   * （ズーム倍率で変換した相対移動）だけ動く —— スポイト等の「ドラッグ調整」
   * （指の位置とは独立にレティクルを動かす）と同じ考え方を、選択済みの
   * 頂点にも適用したもの。丸を直接つまむ必要がなくなる代わりに、選択中は
   * 一本指ドラッグが他の用途（別ポリゴンのタップ選択・素のパン）に使えなく
   * なるので、選び直し／解除は決定ボタン（decideMoveSelect）で行う。
   */
  // retransOpen 中（再透過機能そのものが開いている間）は対象外にする。
  // 再透過は対象ポリゴンの選び方・確定の仕方が独自（dragReticleMode の
  // 専用分岐・decideRetransTapEnclose 等）なので、この「move ツール全体を
  // レティクル操作に統一する」変更とは完全に切り離す。混ざると、例えば
  // 決定ボタンでの全解除(setSelectedId(null))が再透過の対象選択そのものを
  // 巻き込んで消してしまう、といった事故になる。
  const dragMoveVertexActive = settings.loupeMode === 'drag' && appMode === 'move' && !retransOpen
    && selectedPoly != null && selectedVertexIdx != null;
  const dragMoveVertexActiveRef = useRef(dragMoveVertexActive);
  dragMoveVertexActiveRef.current = dragMoveVertexActive;
  /**
   * 'drag' 設定・move モードで、ポリゴン（ブロック）だけ選択していて頂点は
   * まだ選択していない間。dragMoveVertexActive のブロック版 — この間は
   * キャンバスのどこを触ってドラッグしても、選択中のポリゴン全体がその
   * ドラッグ量だけ平行移動する（辺のヒット判定だけは残す。辺追加は
   * 「移動操作」ではなく「編集機能」として別枠にするため）。
   */
  // dragMoveVertexActive と同じ理由で retransOpen 中は対象外。
  const dragMovePolyActive = settings.loupeMode === 'drag' && appMode === 'move' && !retransOpen
    && selectedPoly != null && selectedVertexIdx == null;
  const dragMovePolyActiveRef = useRef(dragMovePolyActive);
  dragMovePolyActiveRef.current = dragMovePolyActive;
  /**
   * 'drag' 設定・move モードで、まだ何も選択していない間。指ドラッグで
   * 独立したレティクル（dragReticleImg）を自由に動かし、決定ボタンで
   * その位置にあるものを選ぶ（ポリゴン内部ならブロック選択）。
   * dragReticleMode 自体の定義には含めていない（selectedId は
   * dragReticleMode の宣言より後で state 宣言されるため、ここで別変数に
   * している —— 下の grant 側で dragReticleModeRef と OR して使う）。
   */
  // dragMoveVertexActive と同じ理由で retransOpen 中は対象外
  // （retransOpen 中の独立レティクルは dragReticleMode 自身の専用分岐が
  // 別途担当する —— retransMethod 選択前はあえてパンできるように
  // 除外してある。ここで包含し直すとその「方式選択前は素のパン」が
  // 壊れる）。
  const dragMoveFreeReticle = settings.loupeMode === 'drag' && appMode === 'move'
    && !retransOpen && selectedId == null;
  const dragMoveFreeReticleRef = useRef(dragMoveFreeReticle);
  dragMoveFreeReticleRef.current = dragMoveFreeReticle;
  // dragMoveFreeReticle も dragReticleMode と同じ独立レティクル(dragReticleImg)
  // を使うので、こちらが true になった時も種を蒔く（selectedId が
  // dragReticleMode の宣言より後で state 宣言されているため、上の
  // seeding useEffect には含められず、ここに分けてある）。ここで蒔いておかないと、
  // 一度もドラッグしないまま決定ボタンを押した時 dragReticleImgRef が null の
  // ままで何も選べない（decideMoveSelect 参照）。
  useEffect(() => {
    if (!dragMoveFreeReticle || dragReticleImgRef.current) return;
    const p = canvasCenter();
    const z = zoomRef.current;
    const seed = p ? localToImage(p.x, p.y, z) : { x: imageWRef.current / 2, y: imageHRef.current / 2 };
    setDragReticlePos(seed);
  }, [dragMoveFreeReticle, setDragReticlePos]);
  /**
   * dragReticleImg（独立レティクル）を実際に画面へ出す(ルーペ・実寸マーカー)
   * べきかどうか。dragReticleMode（スポイト等）と dragMoveFreeReticle
   * （'drag' 設定・move・未選択）の両方が対象 —— どちらも「指ドラッグで
   * 動かした先を決定ボタンで確定する」同じ独立レティクルを使うため。
   * これを分けて OR し忘れると、move ツールで何も選択していない間は
   * レティクルが画面のどこにも見えず、「今どこを決定しようとしているか」
   * が分からないまま指だけ動かすことになる（パンしているだけに見える不具合）。
   */
  const dragReticleVisible = dragReticleMode || dragMoveFreeReticle;
  /**
   * 'drag' 設定・move モード全体（選択状態を問わない）。頂点・ポリゴン内部の
   * 直接ヒットテスト（丸や面を直接つまむ操作）を封印するためだけに使う ——
   * 「レティクル操作」に統一する方針のため、'drag' 設定では直接つまみを
   * 一切通さない。辺（EDGE_HIT_PX のヒットテスト）だけは対象外
   * （辺追加・編集は「移動操作」ではなく別の編集機能として残す）。
   */
  // dragMoveVertexActive と同じ理由で retransOpen 中は対象外
  // （直接ヒットテストの封印も、再透過が開いている間は今まで通り生かす）。
  const dragMoveUnified = settings.loupeMode === 'drag' && appMode === 'move' && !retransOpen;
  const dragMoveUnifiedRef = useRef(dragMoveUnified);
  dragMoveUnifiedRef.current = dragMoveUnified;

  /**
   * レティクルの位置を、ルーペの中だけでなく実物大の画面にも示す印。
   * reticleFixed（スポイト・四角追加・復元ブラシ、すべて adjust モード）は
   * 常にキャンバス中央固定。move モードで頂点を選択している間
   * （moveReticleEnabled、'adjust'/'drag' どちらの設定でも）は、選択中の
   * 頂点位置を示す。それ以外でも 'adjust' 設定中（moveモードで頂点未選択の
   * 時など）は、パン中も含めてキャンバス中央にフォールバック表示する
   * （ルーペ自体を常時表示にしているのと同じ理由 — adjust 設定の間は
   * レティクルが画面から消える瞬間を作らない）。
   * 'drag' 設定のツール操作中（eyedropper/draw/restore）は React state
   * 経由のこの値では使わない（下の dragMainReticleStyle が
   * dragReticleSV/zoomSV から直接、共有値ベースで描画する — 指ドラッグの
   * 毎フレーム更新をヌルヌルさせるため）。
   */
  const mainReticlePos = reticleFixed
    ? canvasCenter()
    : (moveReticleEnabled && moveNudgePoint
      ? (() => { const { sx, sy } = imageToLocal(moveNudgePoint.x, moveNudgePoint.y, zoom); return { x: sx, y: sy }; })()
      : (loupeIsAdjust ? canvasCenter() : null));
  /**
   * 'drag' 設定のレティクル印。dragReticleSV（画像座標）と zoomSV（キャンバスの
   * パン/ズーム）から毎フレーム UI スレッドで表示座標を計算する。React の
   * 再レンダーを挟まないので、指ドラッグにヌルヌル追従する
   * （imageToLocal と同じ式: sx = ix*ds*scale + tx）。
   */
  const dragMainReticleStyle = useAnimatedStyle(() => {
    const p = dragReticleSV.value;
    const z = zoomSV.value;
    const sx = p.x * ds * z.scale + z.tx;
    const sy = p.y * ds * z.scale + z.ty;
    return {
      left: sx - MAIN_RETICLE_R,
      top: sy - MAIN_RETICLE_R,
    };
  }, [ds]);


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

  // 再透過カードの「戻る」。段階(方式選択/ピッキング中/選択済みフォーム)ごとに
  // 挙動が違う（カード本体内に3箇所ばらけていたのを1つにまとめた）。
  // ToolHint 見出し行の左上（×と対称の位置）に固定で出す。選択済みフォーム
  // でも「まだ何も選んでいない」時は戻る先が無いので undefined のまま。
  const retransBackAction = !retransOpen ? undefined
    : retransPicking
      ? () => {
          // ピッキング中はどの状態でも「範囲を指定する」フォームへ丸ごと戻す。
          // 方式トグルはペンモードと同じ常時表示にしたので、方式選択だけの
          // 中間段階が無くなり、分岐も1本化できる。
          clearRetransTempPoly();
          // 既存ポリゴンをタップして自動採用していた場合（一時形ではないので
          // 上の clearRetransTempPoly では消えない）も解除する。
          setSelectedId(null);
          setSelectedVertexIdx(null);
          setRetransMethod(null);
          setRetransMaskPoints(null);
          setRetransPicking(false);
        }
    : retransScope === 'selection' && (retransMethod === 'brush' ? retransMaskPoints : selectedPoly)
      ? () => {
          // 「やり直す」を廃止したぶん、戻るがその役目も引き受ける。選択を
          // 解除してピッキング状態へ戻し、方式トグルも展開する（「戻ったら
          // 展開してくれればいい」という要望）ので、そこから同じ方式なり
          // 別の方式なりを選び直せる。以前は「タップで囲む」の一時形と
          // 元ポリゴンの複製（自動採用）とで挙動を分けていたが、selectedId
          // を必ずクリアするので複製側でも自動採用エフェクトが再発火する
          // 心配は無く、分ける必要が無くなった。
          if (retransMethod === 'brush') {
            setRetransMaskPoints(null);
          } else {
            clearRetransTempPoly();
            setSelectedId(null);
            setSelectedVertexIdx(null);
          }
          setRetransApplied(false);
          setRetransMethod(null);
          setRetransPicking(true);
          setRetransPanelCompact(false);
        }
    : undefined;

  // 再透過カード見出しの titleExtra（畳んでいる間の方式アイコン＋展開ボタン、
  // 透過強度の数字、および元画像の透かしトグル）。どれも出す物が無ければ
  // null にして、空の行だけが残らないようにする。
  //
  // 透過強度の数字（cellTol）は、以前はスライダーのすぐ上（カード本体側）に
  // 単独の行として出していたが、「上の説明の横に置けないか」という要望を
  // 受け、スポイト/復元ブラシの値表示と同じ場所（見出し行）へ統合した。
  const retransTitleExtra = retransOpen && (ghostImage || (retransPicking && retransPanelCompact) || !retransPicking) ? (
    <View style={styles.toolHintStepperRow}>
      {retransPicking && retransPanelCompact && (
        <>
          <Icon name={retransMethod === 'brush' ? 'gesture' : TOOL_ICONS.draw} size={14} color="rgba(255,255,255,0.85)" />
          <AnimatedPressable
            style={styles.toolHintStepperBtn}
            onPress={() => setRetransPanelCompact(false)}
            pressedScale={0.85}
          >
            <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
          </AnimatedPressable>
        </>
      )}
      {!retransPicking && (
        <Text style={styles.zoomCompactTxt}>{Math.round(cellTol)}</Text>
      )}
      {ghostImage && (
        <AnimatedPressable
          style={[styles.ghostBtn, ghostOn && styles.ghostBtnOn]}
          onPress={() => setGhostOn(v => !v)}
          pressedScale={0.9}
        >
          <Icon name="layers" size={14} color="#FFF" />
        </AnimatedPressable>
      )}
    </View>
  ) : null;

  // ToolHint 見出し右上の「畳む」ボタン。×と同じ列にまとめて出す（詳しくは
  // ToolHint.tsx の onCollapse 参照）。畳める中身（スポイト/復元ブラシの
  // パネル、ペン・再透過の方式トグル）が今まさに展開表示されている時だけ出す。
  // パネルごとに独立したフラグを持つので、今どのパネルがアクティブかで
  // 畳む先の setter も切り替える。
  const toolHintOnCollapse = (retransOpen && retransPicking && !retransPanelCompact) ? () => setRetransPanelCompact(true)
    : (!retransOpen && appMode === 'eyedropper' && !eyedropperPanelCompact) ? () => setEyedropperPanelCompact(true)
    : (!retransOpen && appMode === 'restore' && !restorePanelCompact) ? () => setRestorePanelCompact(true)
    : (!retransOpen && appMode === 'draw' && !drawPanelCompact) ? () => setDrawPanelCompact(true)
    : undefined;

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
            {/* 元画像の透かし。復元ブラシ中・再透過カードが開いている間、
                現在の画像の下に薄く敷く。透過済みの部分だけがここから覗く
                ので、消えた範囲が見える（再透過は「消えすぎた場所」を狙って
                選ぶ操作なので、境界が見えないと選びようがないため）。 */}
            {(appMode === 'restore' || retransOpen) && ghostOn && ghostImage && (
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

            {/* ブラシ選択の 'adjust' 録画中の軌跡。retransTraceLocal（指で
                なぞる版、非追従の透明レイヤーに描く）と違い、こちらは画像と
                同じ Group の中に置くことでパン・ズームに自動追従させる
                （retransRecordPath のコメント参照）。ブラシのなぞり中と同じ
                色にして「同じ意味の線」だと伝わるようにする。 */}
            {retransRecordPath && (
              <Path
                path={retransRecordPath}
                color="rgba(10,132,255,0.9)"
                style="stroke"
                strokeWidth={2.5 / zoom.scale}
                strokeCap="round"
                strokeJoin="round"
              />
            )}

            {/* draw「なぞって選択」の 'adjust'/'drag' 録画中の軌跡。retransRecordPath
                と全く同じ理由・同じ色（「なぞって範囲を作る」という同じ意味の
                線だと伝わるようにする）。 */}
            {drawRecordPath && (
              <Path
                path={drawRecordPath}
                color="rgba(10,132,255,0.9)"
                style="stroke"
                strokeWidth={2.5 / zoom.scale}
                strokeCap="round"
                strokeJoin="round"
              />
            )}

            {/* 確定ポリゴン。表示条件は isPolyVisible に1本化してある
                （頂点/辺/全体ドラッグ・タップ選択の当たり判定も同じ関数を
                通すので、「見えないのに触れる」がここでも起きない）。
                結果確認段階（「これでどうですか？」）は、対象を判別したい
                という要望のため塗り・外枠とも通常どおり表示する。 */}
            {polyPaths.map((path, idx) => {
              const id = polygons[idx].id;
              const isSel = id === selectedId;
              if (!isPolyVisible(id)) return null;
              // 「タップで囲む」で作った一時ポリゴンは、実物のカット扱いでは
              // ないので通常のポリゴン配色(POLY_COLORS)を使わず、ブラシで
              // 選択した時と同じ固定の青にする（どちらも「再透過の対象範囲」
              // という同じ意味を表しているため、見た目も揃える）。
              const isRetransTemp = id === retransTempPolyIdRef.current;
              const fillColor = isRetransTemp ? 'rgba(10,132,255,0.28)' : POLY_COLORS[idx % POLY_COLORS.length].fill;
              const strokeColor = isRetransTemp ? 'rgba(10,132,255,0.9)'
                : isSel ? (bgMode === 'white' ? '#000000' : '#FFFFFF') : POLY_COLORS[idx % POLY_COLORS.length].border;
              return (
                <React.Fragment key={id}>
                  <Path path={path} color={fillColor} style="fill" />
                  <Path path={path} color={strokeColor} style="stroke"
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

            {/* 「範囲を指定する」→「ブラシで選択」で確定した選択範囲。
                この Group（画像と同じ zoomSV 駆動の transform）の内側に、
                他のポリゴンと同じ「画像座標×ds」で描くことで、パン・ズーム
                中も画像とまったく同じなめらかさで追従する（別レイヤーで
                作ると zoom 中だけズレて見える）。retransPicking の間だけで
                なく、確定待ち（「この範囲を再透過」）のレビュー中も出す。 */}
            {retransMaskPoints && (
              <Path
                path={(() => {
                  const p = Skia.Path.Make();
                  p.moveTo(retransMaskPoints[0][0] * ds, retransMaskPoints[0][1] * ds);
                  for (let i = 1; i < retransMaskPoints.length; i++) {
                    p.lineTo(retransMaskPoints[i][0] * ds, retransMaskPoints[i][1] * ds);
                  }
                  p.close();
                  return p;
                })()}
                color="rgba(10,132,255,0.28)"
                style="fill"
              />
            )}
          </Group>

          {/* 選択中ポリゴンの頂点ハンドル (Group 外: 常に固定サイズ)。
              位置は VertexHandle 内部で zoomSV から直接計算する
              （パン中も塗り・輪郭と同じなめらかさで追従させるため）。 */}
          {!chromeHidden && selectedPoly?.points.map(([px, py], vi) => (
            <VertexHandle
              key={vi}
              px={px} py={py} ds={ds} zoomSV={zoomSV}
              selected={vi === selectedVertexIdx}
            />
          ))}

        </Canvas>}

        {/* 「範囲を指定する」→「ブラシで選択」。メインの PanResponder（パン・
            ピンチ・頂点操作…）とは別の、なぞって囲むためだけの透明レイヤーを
            キャンバスの上に重ねる。なぞっている間だけタッチを奪う（それ以外は
            下の pan.panHandlers がそのまま効く）。'adjust'/'drag' 設定は
            レティクル＋決定ボタンの録画方式（toggleRetransRecording）を
            使うので、この透明レイヤー自体を出さない（出したままだと、
            'adjust' は指でパンしたつもりが軌跡を描いてしまい、'drag' は
            レティクルをつまむ操作をこちらが奪ってしまう）。 */}
        {canvasReady && retransPicking && retransMethod === 'brush' && !retransMaskPoints
          && settings.loupeMode === 'fixed' && (
          <View
            style={{ position: 'absolute', left: 0, top: 0, width: canvasSize.w, height: canvasSize.h, zIndex: 1 }}
            {...retransTraceResponder.panHandlers}
          >
            <Canvas style={{ width: canvasSize.w, height: canvasSize.h }} pointerEvents="none">
              {retransTraceLocal.length > 1 && (
                <Path
                  path={(() => {
                    const p = Skia.Path.Make();
                    p.moveTo(retransTraceLocal[0][0], retransTraceLocal[0][1]);
                    for (let i = 1; i < retransTraceLocal.length; i++) {
                      p.lineTo(retransTraceLocal[i][0], retransTraceLocal[i][1]);
                    }
                    return p;
                  })()}
                  color="rgba(10,132,255,0.9)"
                  style="stroke"
                  strokeWidth={2.5}
                  strokeCap="round"
                  strokeJoin="round"
                />
              )}
            </Canvas>
          </View>
        )}

        {/* draw モード「なぞって選択」。retransTraceResponder と全く同じ理由・
            同じ作りの専用透明レイヤー（なぞっている間だけタッチを奪う）。
            'adjust'/'drag' 設定はレティクル＋決定ボタンの録画方式
            （toggleDrawRecording）を使うので、こちらも 'fixed' 設定の時だけ出す。 */}
        {canvasReady && appMode === 'draw' && drawMethod === 'trace'
          && settings.loupeMode === 'fixed' && (
          <View
            style={{ position: 'absolute', left: 0, top: 0, width: canvasSize.w, height: canvasSize.h, zIndex: 1 }}
            {...drawTraceResponder.panHandlers}
          >
            <Canvas style={{ width: canvasSize.w, height: canvasSize.h }} pointerEvents="none">
              {drawTraceLocal.length > 1 && (
                <Path
                  path={(() => {
                    const p = Skia.Path.Make();
                    p.moveTo(drawTraceLocal[0][0], drawTraceLocal[0][1]);
                    for (let i = 1; i < drawTraceLocal.length; i++) {
                      p.lineTo(drawTraceLocal[i][0], drawTraceLocal[i][1]);
                    }
                    return p;
                  })()}
                  color="rgba(10,132,255,0.9)"
                  style="stroke"
                  strokeWidth={2.5}
                  strokeCap="round"
                  strokeJoin="round"
                />
              )}
            </Canvas>
          </View>
        )}

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
            元画像の該当セル範囲から作り直すので、消えすぎも消え足りないも直せる。
            「範囲を選択して再透過」を選んで実行すると、まず対象ポリゴンを選ぶ
            段階（retransPicking）を挟む。設定と選択を同じ画面に混ぜず段階を
            分けることで、「今から範囲を選ぶんだな」と迷わず伝わるようにする。 */}

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

        {/* 'drag' 設定のレティクル印。上と見た目は同じだが、位置は
            dragMainReticleStyle（dragReticleSV/zoomSV から UI スレッドで直接
            計算）で決めるので、指ドラッグに完全に同じなめらかさで追従する。 */}
        {dragReticleVisible && dragReticleImg && (
          <Animated.View pointerEvents="none" style={[styles.mainReticle, dragMainReticleStyle]}>
            <View style={[styles.mrArmH, styles.mrArmLeft]} />
            <View style={[styles.mrArmH, styles.mrArmRight]} />
            <View style={[styles.mrArmV, styles.mrArmTop]} />
            <View style={[styles.mrArmV, styles.mrArmBottom]} />
            <View style={styles.mrDot} />
          </Animated.View>
        )}

        {/* ポリゴン連番バッジ。位置は PolyBadge 内部で zoomSV から直接計算する
            （パン中も塗り・輪郭と同じなめらかさで追従させるため）。
            ルーペ（この下）より先に描く — 後から描く方が上に乗るので、
            バッジがルーペの上に透けて見えないよう、ここで先に描いておく。
            隠す条件は上の確定ポリゴン(polyPaths)と揃える — 数字だけ残ると
            「隠したはずなのに何か出ている」になるため。 */}
        {labelCentroids.map((c, idx) => {
          const id = polygons[idx].id;
          const isSel = id === selectedId;
          // 「タップで囲む」の一時ポリゴンは実物のカットではないので連番を
          // 付けない。それ以外は isPolyVisible（確定ポリゴンと共通）に従う。
          if (id === retransTempPolyIdRef.current || !isPolyVisible(id)) return null;
          return (
            <PolyBadge
              key={id}
              cxImg={c[0]} cyImg={c[1]} ds={ds} zoomSV={zoomSV}
              selected={isSel}
              label={idx + 1}
            />
          );
        })}

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
                // 'move' モードで '微調整' 設定の間は、指の位置(loupe.img)は
                // 一切使わず、常にレティクル（選択中の頂点、無ければキャンバス
                // 中央）を映す。以前は素のパン中に loupe.img（指の位置）が
                // 優先されてしまい、「微調整なのにパンすると指の位置に
                // ルーペが移ってレティクルから外れる」ことがあった。
                : moveAdjustReticle
                  ? (moveNudgePoint ?? (canvasSize.w > 0 && canvasSize.h > 0
                    ? localToImage(canvasSize.w / 2, canvasSize.h / 2, zoom)
                    : null))
                // 'fixed' 設定でも常時表示にする（触っていない間はキャンバス
                // 中央を映す）。以前は 'adjust' の時だけ常時表示にしていたが、
                // 「固定レティクルの時も常に表示してほしい」というフィード
                // バックを受けて、設定に関わらず常時表示に揃えた。
                // 'drag' 設定は触っていない間も dragReticleImg（指ドラッグで
                // 動かしてきた位置）を映す — キャンバス中央にフォールバックすると
                // 決定ボタンで確定する位置と食い違って見えるため。
                : (loupe?.img ?? (
                  moveNudgePoint ?? (
                    dragReticleVisible && dragReticleImg
                      ? dragReticleImg
                      : (canvasSize.w > 0 && canvasSize.h > 0
                        ? localToImage(canvasSize.w / 2, canvasSize.h / 2, zoom)
                        : null)
                  )
                ))
            }
            touch={loupe?.touch ?? null}
            canvasW={canvasSize.w}
            canvasH={canvasSize.h}
            // ルーペが「画面中央にある画像座標」を映している間（reticleFixed、
            // または 'move'+'微調整' で頂点未選択の時のキャンバス中央
            // フォールバック、または move モードで頂点未選択の時のキャンバス
            // 中央フォールバック ——上の point の分岐と同じ条件）は、zoomSV から
            // 直接(UIスレッドで)追従させ、React の再レンダーを挟まない。
            // メインキャンバスのパン・ピンチと完全に同じなめらかさになる
            // （詳しくは TouchLoupe 参照）。
            // 選択中の頂点など「画像上の固定点」を映している時は、パンしても
            // その点自体は動かないので、ここは不要（静的な point のままでよい）。
            // 'drag' 設定のレティクルも画像上の固定点（キャンバスはパンしない）
            // なので、ここでは zoomSV 追従の対象から外す（下の pointSV で
            // 直接、共有値ベースの追従をする）。
            panZoomSV={(
              reticleFixed
              || (moveAdjustReticle && !moveNudgePoint)
              || (!moveAdjustReticle && !loupe?.img && !moveNudgePoint && !dragReticleVisible)
            ) ? zoomSV : undefined}
            // 'drag' 設定: レティクル位置を共有値から直接（UI スレッドで）
            // 追従させる。指ドラッグの毎フレーム更新を React の再レンダー
            // なしで反映できるので、adjust のパンや二本指ピンチと同じ
            // なめらかさになる（詳しくは TouchLoupe の pointSV 参照）。
            // dragReticleImg (state) が seed される前は共有値がまだ初期値
            // {x:0,y:0} のままなので、それまでは point prop 側の
            // フォールバック（キャンバス中央）に任せ、一瞬だけ左上に飛んで
            // 見える事故を防ぐ。
            // move モードの素のパン（頂点/辺/ポリゴン移動を含む、上の
            // panZoomSV が undefined になる場合と同じ条件）中は、showLoupe が
            // 毎イベント書き込む moveLoupeImgSV から直接追従させる。これも
            // React の再レンダーを挟まないので、上の 'drag' 設定と同じ
            // なめらかさになる。'微調整' 設定の間はこの経路自体を使わない
            // （常にレティクル追従、指の位置は使わないため）。
            pointSV={
              dragReticleVisible && dragReticleImg
                ? dragReticleSV
                : (appMode === 'move' && !reticleFixed && !moveAdjustReticle && loupe?.img)
                  ? moveLoupeImgSV
                  : undefined
            }
            // ルーペ倍率の loupeZoomMode 設定。panZoomSV がある間は、この
            // base値とモードを使って毎フレーム倍率も滑らかに追従させる
            // （詳しくは TouchLoupe の zoomMode/baseMagnify 参照）。
            baseMagnify={loupeBaseMagnify}
            zoomMode={settings.loupeZoomMode}
            dotGridEnabled={settings.loupeDotGrid}
            checkerImage={bgMode === 'checker' ? checkerImage : null}
            checkerTile={CHECKER_TILE}
            bgColor={bgMode === 'white' ? '#FFFFFF' : bgMode === 'black' ? '#000000' : undefined}
            brushRadius={appMode === 'restore' ? brushRadius : undefined}
            // 復元ブラシの軌跡と同じ仕組みで、ブラシ選択の 'adjust' 録画中も
            // ルーペの中に軌跡を出す。ルーペは狙いを合わせるための拡大表示
            // なので、そこに跡が付かないと「今までどこをなぞったか」が
            // ルーペの中では分からなかった。
            strokePoints={
              appMode === 'restore' ? strokePts
                : retransRecording ? retransRecordPts
                : undefined
            }
            size={loupeSize}
            compactSize={loupeMedium}
            dockedSize={loupeMini}
            magnify={loupeMagnify}
            topOffset={loupeTopOffset}
            fullWidth
            // move モードはハンドルを直接つまむ操作が基本だが、十字ボタンは
            // 常時出しておく（moveSelectEnabled）。頂点未選択の間は
            // 「レティクル（中央固定）を狙いに合わせるためのパン」として
            // 働かせ（nudgeReticle）、頂点選択後だけその頂点をドット単位に
            // 動かす（nudgeSelection）よう切り替える。頂点未選択のまま
            // 押しても何もしない仕様だと、スポイト等と違って十字が反応せず
            // 壊れて見える、という指摘への対応。
            // 再透過「範囲を指定してください」中は、方式選択前(retransMethod
            // === null)だけ矢印を出さない。タップで囲む方式・ブラシ方式
            // どちらも 'adjust' 設定ユーザーが reticle をパンで狙いに
            // 合わせられるよう、通常の moveSelectEnabled 経路（nudgeReticle）
            // をそのまま生かす（ブラシの録画中はこのパンが軌跡そのものになる。
            // recordRetransCenterPoint 参照）。
            //
            // 「範囲を指定してください」を抜けたフォーム段階（透過強度の
            // スライダーを触る段階）では、対象ポリゴン（タップで囲む方式の
            // 一時形）が無ければ矢印・決定とも無関係なので出さない。
            // 「画像全体」を選んだ時や、まだ範囲を選んでいない時、ブラシ方式
            // （頂点という概念自体が無い）がこれに当たる。対象を選んだ後
            // （タップで囲む方式で一時形がある間）だけ、頂点の微調整用に
            // 生かしたままにする。
            // 十字ボタン(矢印)自体は 'adjust' 設定専用。'drag' 設定は
            // moveSelectEnabled に含まれるが、矢印は出さず決定ボタンだけにする
            // （TouchLoupe は onNudge 未指定・onDecide のみでも decide-only
            // 表示になる）。
            onNudge={
              retransOpen && retransPicking && retransMethod === null ? undefined
                : retransOpen && !retransPicking && !selectedPoly ? undefined
                : reticleFixed ? nudgeReticle
                : ((loupeIsAdjust && appMode === 'move') ? (moveNudgeEnabled ? nudgeSelection : nudgeReticle) : undefined)
            }
            // move モードの決定はトグル。何も選択していなければ「レティクルに
            // 一番近い頂点／ポリゴンを選ぶ」、既に選択中なら「解除する」。
            // 頂点ハンドルを直接タップする代わりに、パン(1本指/2本指どちらも)
            // で狙いを合わせてから押す — ズームで拡大していて小さな丸を
            // 正確にタップしにくい時の代替手段。
            //
            // 再透過「範囲を指定してください」中は4通りに分かれる。
            // ・方式選択前: 決定ボタンは無関係なので無効（あの段階で
            //   decideMoveSelect を生かしていた時は、reticle 経由で本物の
            //   ポリゴンの頂点選択・ドラッグに入れてしまい、非表示にしたはずの
            //   ポリゴンへ「見えない当たり判定」が残る不具合になっていた）。
            // ・タップで囲む方式・まだ何も選んでいない: reticle 位置に
            //   四角を作る（decideRetransTapEnclose、addRect の 'adjust'
            //   分岐と同じ考え方）。
            // ・ブラシ方式: 復元ブラシと同じ録画トグル（toggleRetransRecording）。
            // ・対象（一時ポリゴン）を選んだ後: decideMoveSelect 内部でも
            //   isPolyVisible で本物のポリゴンを除外しているので、そのまま
            //   使って頂点を微調整できる。
            //
            // フォーム段階（透過強度）は、上の onNudge と同じ理由で対象
            // ポリゴンが無ければ無効にする。
            onDecide={
              retransOpen && retransPicking
                // 'fixed' 設定は直接操作で完結する（ポリゴン方式は直接タップで
                // retransTapEnclose、ブラシ方式は retransTraceResponder の直接
                // なぞり——どちらも決定ボタンを使わない）。決定ボタンは
                // 'adjust'/'drag' の時だけ出す（retransBrushActiveRef が
                // 'fixed' 限定になっているのと対になる条件）。
                ? ((loupeIsAdjust || dragReticleMode)
                  ? (retransMethod === 'polygon' ? decideRetransTapEnclose
                    : retransMethod === 'brush' ? toggleRetransRecording
                    : undefined)
                  : undefined)
                : retransOpen && !retransPicking && !selectedPoly
                ? undefined
                : appMode === 'move'
                ? (moveSelectEnabled ? decideMoveSelect : undefined)
                : ((loupeIsAdjust || dragReticleMode) ? decideAtReticle : undefined)
            }
            decideActive={
              retransOpen && retransPicking && retransMethod === 'brush' ? retransRecording
                : appMode === 'restore' ? restoreRecording
                : appMode === 'draw' && drawMethod === 'trace' ? drawRecording
                : (appMode === 'move' ? selectedVertexIdx != null : false)
            }
            decideActiveKind={
              retransOpen && retransPicking && retransMethod === 'brush' ? 'recording'
                : appMode === 'move' ? 'selected' : 'recording'
            }
            dpadBottom={loupeIsAdjust || moveSelectEnabled || dragReticleMode ? dpadBottom : undefined}
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
            画面が寂しかったので、3モードとも「名前＋やること」を1行で示す。
            再透過カードが開いている間は、素の appMode の説明のままだと
            「今は再透過中」だと伝わらないため、内容を差し替える。 */}
        {!chromeHidden && (
          <ToolHint
            icon={retransOpen ? 'auto-fix-high' : TOOL_HINTS[appMode].icon}
            title={retransOpen
              ? (retransPicking ? t('editor.retransPickHint')
                : retransApplied ? t('editor.retransResultTitle') : t('editor.retransTitle'))
              : t(TOOL_HINTS[appMode].titleKey)}
            desc={retransOpen
              ? (retransPicking
                ? (retransMethod === 'brush' ? t('editor.retransBrushDesc')
                  : retransMethod === 'polygon' ? t('editor.retransPickDesc')
                  : t('editor.retransChooseMethodDesc'))
                : retransApplied ? t('editor.retransResultDesc') : t('editor.retransHintDesc'))
              : t(TOOL_HINTS[appMode].descKey)}
            // ズームは右端へ移したので、下端は説明とブラシ設定だけになった。
            bottom={12}
            // 実測の高さを dpadBottom の計算に使う（詳しくは dpadBottom 参照）。
            onLayout={e => setToolHintHeight(e.nativeEvent.layout.height)}
            // 収納中（'adjust' 設定でパネルを畳んでいる間）のスポイト/復元
            // ブラシは、以前は別の小さいピルボタンとして浮いていたが、値の
            // 増減も含めてここに統合する。上下矢印が無いと「値をタップで
            // 増減できる」と伝わらないため必ず添える。
            //
            // 再透過カードが開いている間は、元画像の透かし(ghost)トグルを
            // 出す。「消えすぎた部分を再透過したいのに、どこまで消えたか
            // 分からない」という声への対応で、復元ブラシの透かしをそのまま
            // 使い回す。方式選択・ピッキング中・結果確認中、どの段階でも
            // 境界を確認したくなるので、状態を問わず同じ場所に固定で出す。
            titleExtra={(!retransOpen && panelCompact && (appMode === 'eyedropper' || appMode === 'restore')) ? (
              <View style={styles.toolHintStepperRow}>
                <Text style={styles.zoomCompactTxt}>
                  {appMode === 'restore' ? `${Math.round(brushPx)}px` : Math.round(eyeTol)}
                </Text>
                <AnimatedPressable
                  style={styles.toolHintStepperBtn}
                  onPress={() => (appMode === 'restore' ? setRestorePanelCompact(false) : setEyedropperPanelCompact(false))}
                  pressedScale={0.85}
                >
                  <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
                </AnimatedPressable>
              </View>
            ) : (!retransOpen && panelCompact && appMode === 'draw') ? (
              // ペンの編集方法パネルを畳んでいる間は、今選んでいる方式の
              // アイコンだけ残して展開ボタンを添える（スポイト/復元ブラシの
              // 値＋展開ボタンと同じ考え方）。
              <View style={styles.toolHintStepperRow}>
                <Icon name={drawMethod === 'tap' ? TOOL_ICONS.draw : 'gesture'} size={14} color="rgba(255,255,255,0.85)" />
                <AnimatedPressable
                  style={styles.toolHintStepperBtn}
                  onPress={() => setDrawPanelCompact(false)}
                  pressedScale={0.85}
                >
                  <Icon name="unfold-more" size={14} color="rgba(255,255,255,0.85)" />
                </AnimatedPressable>
              </View>
            ) : retransTitleExtra || undefined}
            // 「戻る」は見出し左上に固定（×と対称の位置）。中身のカードに
            // 埋もれて気づかれにくい／押しにくいという声への対応。
            onBack={onRetransparent ? retransBackAction : undefined}
            // 「畳む」は×と同じ右上へ統一（以前は各パネルの本体側にバラバラに
            // あった）。
            onCollapse={toolHintOnCollapse}
            // 再透過カード本体をここに差し込む（説明行の下に divider 付きで
            // 積む）。以前は別のフローティングカードだったが、「同じ場所に
            // まとまっている方が分かりやすい」という要望で統合した。
            onClose={onRetransparent && retransOpen ? () => {
              if (retransPicking) {
                // ピッキング中のクローズ（方式選択前後どちらでも）: 選びかけの
                // 状態を残さずカードごと閉じる。
                clearRetransTempPoly();
                setRetransPicking(false);
                setRetransOpen(false);
                setRetransMethod(null);
              } else {
                // フォーム段階のクローズ。「これでどうですか？」の結果確認中
                // （retransApplied）なら、確定せずに閉じる＝この結果は要らない
                // ということなので、適用済みの再透過をここで取り消してから
                // 閉じる。確定したい時は必ず「確定」ボタンを押させ、×は常に
                // 「今の結果を捨てる」で統一する。
                if (retransApplied) handleUndo();
                clearRetransTempPoly();
                setRetransOpen(false);
                setRetransMethod(null);
                setRetransMaskPoints(null);
                setRetransApplied(false);
              }
            } : undefined}
          >
            {onRetransparent && retransOpen ? (
              retransPicking && panelCompact ? (
                // 畳んでいる間は ToolHint 見出しの titleExtra（方式アイコン＋
                // 展開ボタン）だけで済ませ、本体側には何も出さない。
                null
              ) : retransPicking ? (
                // 選択段階: draw モードの「編集方法」トグル（drawMethodBtn）と
                // 全く同じ見た目・挙動に揃える。選んだ後も消さずに出したまま、
                // 選択中をハイライトし、いつでも別の方式にワンタップで
                // 切り替えられるようにする（切り替え時は前の方式の選びかけを
                // 破棄する）。
                <View style={styles.retransFormBody}>
                  <View style={styles.drawMethodRow}>
                    <AnimatedPressable
                      style={[styles.drawMethodBtn, retransMethod === 'polygon' && styles.drawMethodBtnOn]}
                      onPress={() => {
                        if (retransMethod === 'polygon') return;
                        setRetransMaskPoints(null);
                        setSelectedId(null);
                        setSelectedVertexIdx(null);
                        setRetransMethod('polygon');
                        // 方式を選んだ時点でトグル自体はもう用が済んでいるので畳む。
                        setRetransPanelCompact(true);
                      }}
                      pressedScale={0.96}
                    >
                      <Icon name={TOOL_ICONS.draw} size={18} color="#FFF" />
                      <Text style={[styles.drawMethodTitle, retransMethod === 'polygon' && styles.drawMethodTitleOn]}>
                        {t('editor.retransMethodPolygon')}
                      </Text>
                      <Text style={styles.drawMethodDesc}>{t('editor.drawMethodTapDesc')}</Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      style={[styles.drawMethodBtn, retransMethod === 'brush' && styles.drawMethodBtnOn]}
                      onPress={() => {
                        if (retransMethod === 'brush') return;
                        clearRetransTempPoly();
                        setSelectedId(null);
                        setSelectedVertexIdx(null);
                        setRetransMethod('brush');
                        // 方式を選んだ時点でトグル自体はもう用が済んでいるので畳む。
                        setRetransPanelCompact(true);
                      }}
                      pressedScale={0.96}
                    >
                      <Icon name="gesture" size={18} color="#FFF" />
                      <Text style={[styles.drawMethodTitle, retransMethod === 'brush' && styles.drawMethodTitleOn]}>
                        {t('editor.retransMethodBrush')}
                      </Text>
                      <Text style={styles.drawMethodDesc}>{t('editor.drawMethodTraceDesc')}</Text>
                    </AnimatedPressable>
                  </View>
                </View>
              ) : (
                <View style={styles.retransFormBody}>
                  {/* 透過強度の数字は見出し行（titleExtra側の retransTitleExtra）
                      へ移した。ここでは対象範囲から。ピル自体の文言
                      （画像全体/範囲を指定する）で何を選ぶかは伝わるので、
                      上のキャプションは省く。 */}
                  <View style={styles.retransScopeRow}>
                    <AnimatedPressable
                      style={[styles.retransScopeBtn, retransScope === 'all' && styles.retransScopeBtnOn]}
                      onPress={() => setRetransScope('all')}
                      pressedScale={0.96}
                    >
                      <Text style={[styles.retransScopeTxt, retransScope === 'all' && styles.retransScopeTxtOn]}>
                        {t('editor.retransScopeAll')}
                      </Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      style={[styles.retransScopeBtn, retransScope === 'selection' && styles.retransScopeBtnOn]}
                      onPress={() => setRetransScope('selection')}
                      pressedScale={0.96}
                    >
                      <Text style={[styles.retransScopeTxt, retransScope === 'selection' && styles.retransScopeTxtOn]}>
                        {t('editor.retransScopeSelection')}
                      </Text>
                    </AnimatedPressable>
                  </View>
                  <View style={styles.retransRow}>
                    {/* 「被写体優先／背景優先」の文字だと日英どちらでも横幅を
                        食い、他のコントロールと合わせて窮屈になっていたため、
                        アイコンに置き換えて圧縮（意味は accessibilityLabel で
                        引き続き伝える）。 */}
                    <Icon name="person" size={14} color="rgba(255,255,255,0.6)"
                      accessibilityLabel={t('granularity.personPriority')} />
                    <Slider
                      style={styles.retransSlider}
                      minimumValue={0}
                      maximumValue={100}
                      value={cellTol}
                      onSlidingStart={() => { uiInteractingRef.current = true; discardStroke(); }}
                      onValueChange={v => { setCellTol(v); setRetransApplied(false); }}
                      onSlidingComplete={() => { uiInteractingRef.current = false; discardStroke(); }}
                      minimumTrackTintColor={IOS.blue}
                      maximumTrackTintColor="rgba(255,255,255,0.28)"
                      thumbTintColor="#FFF"
                    />
                    <Icon name="image" size={14} color="rgba(255,255,255,0.6)"
                      accessibilityLabel={t('granularity.backgroundPriority')} />
                  </View>
                  {/* 「やり直す」は廃止し、戻る（見出し左上の onBack）に統合した。
                      戻るを押すと選択を解除してピッキング状態へ戻り、方式トグルも
                      展開する（retransBackAction 参照）ので、そこから同じ方式を
                      選び直せば「やり直す」と同じことができる。 */}
                  <AnimatedPressable
                    style={styles.retransApply}
                    onPress={() => {
                      // ポリゴン選択・ブラシで囲んだ選択、どちらも「点列」という
                      // 同じ形なので、対象範囲を1つの変数にそろえてから共通処理する。
                      const targetPoints = retransMethod === 'brush' ? retransMaskPoints
                        : retransMethod === 'polygon' ? (selectedPoly?.points ?? null)
                        : null;

                      if (retransScope === 'selection' && !targetPoints) {
                        // まだ何も選んでいない: 方式選択（ポリゴン/ブラシ）へ進む。
                        // 既存の選択が残っていると紛らわしいので一旦解除する。
                        clearRetransTempPoly();
                        setRetransMaskPoints(null);
                        setRetransMethod(null);
                        setRetransPicking(true);
                        return;
                      }
                      if (retransScope === 'selection' && targetPoints) {
                        if (retransApplied) {
                          // 結果を見せている段階で押した＝「これでいい」の確定。
                          // 選択も範囲も既に反映済みなので、ここでは閉じるだけ。
                          clearRetransTempPoly();
                          setRetransMaskPoints(null);
                          setRetransMethod(null);
                          setRetransOpen(false);
                          setRetransApplied(false);
                          return;
                        }
                        // 対象の外接矩形に余白を足した範囲だけ元画像から作り直し、
                        // 実際に貼り戻すのは多角形（targetPoints）の内側だけにする。
                        // 余白が無いと矩形の四隅が背景ではなく被写体自身に乗る
                        // ことがあり、そこを起点にするフラッドフィルが誤動作する
                        // （このアプリの背景除去は「矩形の四隅＝背景」が前提のため）。
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (const [x, y] of targetPoints) {
                          if (x < minX) minX = x; if (x > maxX) maxX = x;
                          if (y < minY) minY = y; if (y > maxY) maxY = y;
                        }
                        const pad = Math.max(24, Math.round(Math.max(maxX - minX, maxY - minY) * 0.15));
                        // スポイト・復元ブラシと同じく、この操作を undo/redo 履歴に積む。
                        // ここを忘れると canUndoEdit（親の edits 件数）だけが増えて
                        // undo ボタンは活性表示になるのに、押しても pastRef.current が
                        // 空のまま(handleUndo 冒頭で即 return)で何も起きない、という
                        // 見た目だけ動くボタンになってしまう。
                        pushPast({ kind: 'edit' });
                        setFuture([]);
                        // 元画像から作り直す重い処理なので、他の重い操作と同じく
                        // 処理中オーバーレイを出す（時間がかかることが伝わるように）。
                        runHeavy(() => {
                          onRetransparent(cellTol, {
                            minX: Math.max(0, Math.floor(minX - pad)),
                            minY: Math.max(0, Math.floor(minY - pad)),
                            maxX: Math.min(bgResult.width - 1, Math.ceil(maxX + pad)),
                            maxY: Math.min(bgResult.height - 1, Math.ceil(maxY + pad)),
                            maskPoints: targetPoints,
                          });
                          // すぐには閉じない。「これでどうですか？」の結果確認段階へ。
                          setRetransApplied(true);
                        }, 'editor.retransBusy');
                        return;
                      }
                      // 「画像全体」も、選択範囲の再透過と同じく結果をすぐには
                      // 閉じずに見せる（「これでどうですか？」段階を挟む）。
                      if (retransApplied) {
                        setRetransOpen(false);
                        setRetransApplied(false);
                        return;
                      }
                      // 元画像からセルを作り直す重い処理なので、選択範囲の再透過と
                      // 同じく処理中オーバーレイを出す。
                      runHeavy(() => {
                        onRetransparent(cellTol);
                        setRetransApplied(true);
                      }, 'editor.retransBusy');
                    }}
                    pressedScale={0.96}
                  >
                    <Icon name={retransApplied ? 'check' : 'auto-fix-high'} size={16} color="#FFF" />
                    <Text style={styles.retransApplyTxt}>
                      {retransApplied ? t('editor.retransConfirm')
                        : retransScope === 'all' ? t('editor.retransApply')
                          : (retransMethod === 'brush' ? retransMaskPoints : selectedPoly)
                            ? t('editor.retransApplyRegion') : t('editor.retransPickStart')}
                    </Text>
                  </AnimatedPressable>
                </View>
              )
            ) : appMode === 'eyedropper' && !panelCompact ? (
              // スポイトの許容値。設定画面まで行かずに「もう少し広く／狭く」を
              // 調整できるようにする。
              <>
                <View style={styles.brushHead}>
                  <Text style={styles.brushLabel}>{t('settings.eyedropperTolerance')}</Text>
                  <View style={styles.brushHeadRight}>
                    <Text style={styles.brushValue}>{Math.round(eyeTol)}</Text>
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
              </>
            ) : appMode === 'restore' && !panelCompact ? (
              // 復元ブラシの太さ。透過強度が開いている間は出さない（同じ場所を
              // 使うため、appMode === 'restore' の間だけ出るのでその心配は無い）。
              <>
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
              </>
            ) : appMode === 'draw' && panelCompact ? (
              // 畳んでいる間は titleExtra（方式アイコン＋展開ボタン）だけで済ませる。
              null
            ) : appMode === 'draw' ? (
              // draw モードの編集方法。再透過の「ポリゴンで選択／ブラシで選択」
              // と同じ2択カードの見た目に揃える。ただし再透過の方式選択は
              // 選んだ瞬間に別画面（ピッキング）へ進む一度きりの選択なのに対し、
              // こちらは draw モードにいる間ずっと出しておき、いつでも
              // 選び直せるトグルにする（appMode を move へ切り替えて頂点調整に
              // 入っても drawMethod 自体は保持される）。
              <View style={styles.drawMethodRow}>
                <AnimatedPressable
                  style={[styles.drawMethodBtn, drawMethod === 'tap' && styles.drawMethodBtnOn]}
                  onPress={() => setDrawMethod('tap')}
                  pressedScale={0.96}
                >
                  <Icon name={TOOL_ICONS.draw} size={18} color="#FFF" />
                  <Text style={[styles.drawMethodTitle, drawMethod === 'tap' && styles.drawMethodTitleOn]}>
                    {t('editor.drawMethodTapTitle')}
                  </Text>
                  <Text style={styles.drawMethodDesc}>{t('editor.drawMethodTapDesc')}</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.drawMethodBtn, drawMethod === 'trace' && styles.drawMethodBtnOn]}
                  onPress={() => setDrawMethod('trace')}
                  pressedScale={0.96}
                >
                  <Icon name="gesture" size={18} color="#FFF" />
                  <Text style={[styles.drawMethodTitle, drawMethod === 'trace' && styles.drawMethodTitleOn]}>
                    {t('editor.drawMethodTraceTitle')}
                  </Text>
                  <Text style={styles.drawMethodDesc}>{t('editor.drawMethodTraceDesc')}</Text>
                </AnimatedPressable>
              </View>
            ) : undefined}
          </ToolHint>
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
              <Text style={styles.zoomBadgeTxt}>×{formatZoom(sliderToZoom(sliderV))}</Text>
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
                  <Text style={styles.zoomCompactTxt}>×{formatZoom(sliderToZoom(sliderV))}</Text>
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

                {/* ルーペ操作(loupeMode)の切替。設定画面と同じ項目を、編集中に
                  すぐ変えられるようここにも置く。畳んでおく理由は下地と同じ。 */}
                <AnimatedPressable
                  style={[styles.floatBtn, loupeModePickerOpen && styles.floatBtnActive]}
                  onPress={() => setLoupeModePickerOpen(o => !o)}
                  pressedScale={0.9}
                >
                  <Icon name={LOUPE_MODE_ICONS[settings.loupeMode]} size={20} color="#FFF" />
                </AnimatedPressable>
                {loupeModePickerOpen && (
                  <View style={styles.bgColumn}>
                    {(['fixed', 'adjust', 'drag'] as const).map(mode => (
                      <AnimatedPressable
                        key={mode}
                        style={[styles.bgDot, settings.loupeMode === mode && styles.bgDotOn]}
                        onPress={() => {
                          void updateSettings({ loupeMode: mode });
                          setLoupeModePickerOpen(false);
                        }}
                        pressedScale={0.9}
                      >
                        <Icon name={LOUPE_MODE_ICONS[mode]} size={16} color="#FFF" />
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
                      // 下部パネルを共有しているので、開く時は必ず move モードへ
                      // 切り替える（'draw'/'eyedropper'/'restore' のままだと
                      // moveSelectEnabled が false のままになり、'ドラッグ調整'
                      // 設定のユーザーはレティクル・決定ボタンが一切出せなく
                      // なっていた —— 「パンになる」と表現された不具合）。
                      if (next && appMode !== 'move') setAppMode('move');
                      if (next) {
                        // 開く前に選択していたポリゴンをそのまま対象として拾って
                        // しまわないよう、開く瞬間に選択を解除する（既存ポリゴンを
                        // 対象にしたい時は、開いた後で改めてタップし直してもらう）。
                        setSelectedId(null);
                        setSelectedVertexIdx(null);
                      }
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
    zIndex: 2,
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
  // ToolHint の見出し行に差し込む、収納中のスポイト/復元ブラシの値＋増減。
  // 上下矢印が無いと「これは触れる値なんだ」と伝わらないため付けている。
  toolHintStepperRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  toolHintStepperBtn: { padding: 4 },
  floatBtn: {
    width: 34, height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(30,30,30,0.72)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  // 現在のツールの下に出す小さな矢印。「押すと他のツールが出る」ことを示す。
  // トグル(floatBtn)を押して展開される選択肢の入れ物。上のツール本体ボタン
  // 群（floatBtn が直接並ぶ）と見分けがつくよう、窪んだ別パネルとして囲む
  // ——枠なしで背景色だけ揃えると「元々ある別のボタン」と誤認されるため。
  bgColumn: {
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    padding: 3,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  // 中の選択肢自体は floatBtn より一回り小さく・枠なしの「チップ」にして、
  // 独立したボタンではなく bgColumn 内の選択肢だと分かるようにする。
  bgDot: {
    width: 30, height: 24,
    borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bgDotOn: { backgroundColor: IOS.blue },
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
  // つまみ半径ぶんトラックが内側に寄るので、左右に同じだけ余白を取る
  // （実機のつまみ半径に合わせて調整した値。10 では右にずれて見えた）。
  zoomTicks: {
    position: 'absolute',
    left: 17, right: 17,
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
    zIndex: 2,
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
  // ToolHint に差し込むフォーム段階の中身。以前は retransCard 自体が
  // gap を持っていたが、今は ToolHint 側のカード枠に同居するので、
  // ここで縦の間隔だけ引き継ぐ。
  retransFormBody: { gap: 6 },
  retransTitle: { color: '#FFF', fontSize: 13, fontWeight: '600' },
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
  retransUndoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 6,
  },
  retransUndoTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  retransScopeLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 },
  retransScopeRow: { flexDirection: 'row', gap: 6 },
  retransScopeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retransScopeBtnOn: { backgroundColor: 'rgba(10,132,255,0.35)' },
  retransScopeTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  retransScopeTxtOn: { color: '#FFF', fontWeight: '600' },

  // ── draw モードの編集方法（ポリゴン／なぞって選択）───────────────────────
  // 再透過の方式選択カード(retransScope*)と同じ2択レイアウトだが、こちらは
  // アイコン＋タイトル＋説明の3段構成で、選択後も出したままにするトグル。
  drawMethodRow: { flexDirection: 'row', gap: 6 },
  drawMethodBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  drawMethodBtnOn: { backgroundColor: 'rgba(10,132,255,0.22)', borderColor: 'rgba(10,132,255,0.9)' },
  drawMethodTitle: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  drawMethodTitleOn: { color: '#FFF' },
  drawMethodDesc: { color: 'rgba(255,255,255,0.55)', fontSize: 10, textAlign: 'center' },

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
    // floatingTop・panelSlot（zIndex:2、なぞり用レイヤーより上に来るよう
    // 明示した）よりさらに上に出す。ここが負けると処理中でも再透過カードの
    // ボタンが押せてしまう。
    zIndex: 3,
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
