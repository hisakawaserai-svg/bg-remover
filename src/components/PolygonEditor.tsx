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
  useAnimatedStyle,
  withTiming,
  Easing,
  ReduceMotion,
} from 'react-native-reanimated';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ToolHint, { TOOL_ICONS } from './ui/ToolHint';
import { useT } from '../i18n';
import type { TKey } from '../i18n';
import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import Slider from '@react-native-community/slider';
import ImageZoomModal from './ui/ImageZoomModal';
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
import { splitConnected, isTransparentAt, findUncoveredRegions, initialRectFromBBox } from '../imaging';
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
const ZOOM_STEP      = 0.5; // ボタン1回分のズーム量
/** 倍率プリセット。スライダーの目盛りと、離した時の吸い付き先を兼ねる。 */
const ZOOM_PRESETS   = [1, 2, 4, 8, 16, 24] as const;
/** ズームバーの高さ(px)。ツール説明を上へ逃がす量の計算に使う。 */
const ZOOM_BAR_H     = 40;

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

/** スポイトのタップ波紋の半径(px)。 */
const EYE_RIPPLE_R = 26;

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
 */
function clampZoom(z: ZoomState, dW: number, dH: number, natW: number, natH: number): ZoomState {
  const availW = dW - PAD_L - PAD_R;
  const availH = dH - PAD_T - PAD_B;
  const imgW   = natW * z.scale;
  const imgH   = natH * z.scale;
  const tx = imgW <= availW
    ? PAD_L + (availW - imgW) / 2                                   // 中央固定
    : Math.max(PAD_L - (imgW - availW), Math.min(PAD_L, z.tx));    // パン許容
  const ty = imgH <= availH
    ? PAD_T + (availH - imgH) / 2
    : Math.max(PAD_T - (imgH - availH), Math.min(PAD_T, z.ty));
  return { scale: z.scale, tx, ty };
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
  // 元画像の透かし表示。復元ブラシでは既定 ON（消えた場所が見えないと塗れない）。
  const [ghostOn, setGhostOn] = useState(true);
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
  const zoomRef       = useRef(zoom);       zoomRef.current       = zoom;

  // ── ジェスチャー中のズーム更新を 1フレーム1回にまとめる ─────────────────────
  //
  // onPanResponderMove はタッチイベントごと（60〜120Hz）に来る。そのたびに setZoom
  // すると同じ数だけ再レンダーが走り、指を動かしている間ずっと重くなる。
  // ズーム値そのものは zoomRef に即時反映し（同じジェスチャー中の計算はこれを読む）、
  // React への反映だけを requestAnimationFrame でまとめる。
  const pendingZoomRef = useRef<ZoomState | null>(null);
  const zoomRafRef     = useRef<number | null>(null);
  const scheduleZoom = useCallback((next: ZoomState) => {
    zoomRef.current = next;      // 後続の計算がすぐ読めるよう先に入れる
    pendingZoomRef.current = next;
    if (zoomRafRef.current != null) return; // このフレームぶんは予約済み
    zoomRafRef.current = requestAnimationFrame(() => {
      zoomRafRef.current = null;
      const pending = pendingZoomRef.current;
      pendingZoomRef.current = null;
      if (pending) setZoom(pending);
    });
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
  // スポイト用。許容値は設定画面で変わるので、クロージャ直参照だと初回値に固定される。
  const rgbaRef       = useRef(bgResult.rgba);   rgbaRef.current   = bgResult.rgba;
  const eyeTolRef     = useRef(settings.eyedropperTolerance);
  eyeTolRef.current   = settings.eyedropperTolerance;
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
      duration: 420,
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
  const pendingHeavyRef = useRef<(() => void) | null>(null);

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
   * [+]/[−] ボタン用の中心固定ズーム。
   * 焦点 = 表示領域の中心 (displayW/2, displayH/2)。
   * tx = focal - (focal - tx) * (newScale / oldScale) で
   * 焦点が画面上で動かないよう tx/ty を補正する。
   */
  const stepZoom = useCallback((direction: 1 | -1) => {
    setZoom(prev => {
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.scale + direction * ZOOM_STEP));
      if (newScale === prev.scale) return prev;
      const focalX = canvasSizeRef.current.w / 2;
      const focalY = canvasSizeRef.current.h / 2;
      const ratio  = newScale / prev.scale;
      return clampZoom({
        scale: newScale,
        tx: focalX - (focalX - prev.tx) * ratio,
        ty: focalY - (focalY - prev.ty) * ratio,
      }, canvasSizeRef.current.w, canvasSizeRef.current.h,
         imageWRef.current * dsRef.current, imageHRef.current * dsRef.current);
    });
  }, []);

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
   * 全体表示へ戻す。等倍にしたうえで clampZoom に中央へ寄せさせる。
   * 「拡大しすぎた」「画像がどこかへ行った」ときの復帰専用。
   */
  const resetZoom = useCallback(() => {
    setZoom(clampZoom(
      { scale: 1, tx: 0, ty: 0 },
      canvasSizeRef.current.w, canvasSizeRef.current.h,
      imageWRef.current * dsRef.current, imageHRef.current * dsRef.current,
    ));
  }, []);

  /**
   * 予約された重い処理を、ローディング表示が描画された後に実行する。
   *
   * useEffect はコミット後に走るので、ここまで来ればオーバーレイは
   * ビューツリーに乗っている。さらに rAF を1つ挟んで実際に描画が
   * 走る猶予を与えてから、同期処理へ入る。
   */
  useEffect(() => {
    if (!eyeBusy) return;
    const work = pendingHeavyRef.current;
    if (!work) return;
    pendingHeavyRef.current = null;
    const id = requestAnimationFrame(() => {
      try {
        work();
      } finally {
        // 例外が出ても必ず解除する（漏らすと以後スポイトが死ぬ）。
        eyeBusyRef.current = false;
        setEyeBusy(false);
        // タップ表示を明示的に消す。残すと波紋の View が出しっぱなしになる。
        setRipple(null);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [eyeBusy]);

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
      onUndoEditRef.current?.();          // 画像の巻き戻しは親が行う
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
      onRedoEditRef.current?.();
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
    onStartShouldSetPanResponder: () => !eyeBusyRef.current,
    // 微小なジッタ（タップ時の指ブレ）では responder を奪わず、明確なドラッグ
    // （PAN_THRESHOLD=8px 以上の移動）のときだけパンを開始する。これにより
    // キャンバス上のフローティングボタンの onPress が横取りされず生き残る。
    onMoveShouldSetPanResponder:  (_, gs) =>
      Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD,

    onPanResponderGrant: (evt) => {
      const lx = evt.nativeEvent.locationX;
      const ly = evt.nativeEvent.locationY;
      gStartLX.current   = lx;
      gStartLY.current   = ly;
      gStartZoom.current = { ...zoomRef.current };

      // draw / eyedropper はどちらも「タップで確定」。ここでは pending にするだけで、
      // release 側で移動量を見てタップかパンかを判定する。こうすることで
      // スポイト中でもキャンバスのパン・ピンチがそのまま使える
      // （grant で即実行すると、見回すためのパン開始で誤って色が消える）。
      if (appModeRef.current === 'draw' || appModeRef.current === 'eyedropper') {
        gPhase.current = 'pending';
        return;
      }

      // 復元ブラシ: なぞり始め。指を動かすたびに軌跡を伸ばし、離した時に確定する。
      if (appModeRef.current === 'restore') {
        gPhase.current = 'restore';
        const z = zoomRef.current;
        const { x, y } = localToImage(lx, ly, z);
        strokeImgRef.current = [[x, y]];
        flushStroke();
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

      // ── ピンチ (move モードのみ) ───────────────────────────────────────
      if (appModeRef.current === 'move' && touches.length >= 2) {
        const d    = touchDist(touches[0], touches[1]);
        const offX = viewOffsetRef.current.x;
        const offY = viewOffsetRef.current.y;
        // pageX をキャンバスローカル座標に変換
        const midX = (touches[0].pageX + touches[1].pageX) / 2 - offX;
        const midY = (touches[0].pageY + touches[1].pageY) / 2 - offY;

        if (gPhase.current !== 'pinch') {
          gPhase.current      = 'pinch';
          gPinchDist0.current = d;
          gPinchMidX.current  = midX;
          gPinchMidY.current  = midY;
          gStartZoom.current  = { ...zoomRef.current };
        }
        const { scale: s0, tx: tx0, ty: ty0 } = gStartZoom.current;
        const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s0 * d / gPinchDist0.current));
        // 焦点固定: ピンチ開始中点が画面上で動かないよう tx/ty を補正
        const focalX = (gPinchMidX.current - tx0) / s0;
        const focalY = (gPinchMidY.current - ty0) / s0;
        scheduleZoom(clampZoom({
          scale: newScale,
          tx: gPinchMidX.current - focalX * newScale,
          ty: gPinchMidY.current - focalY * newScale,
        }, canvasSizeRef.current.w, canvasSizeRef.current.h,
           imageWRef.current * dsRef.current, imageHRef.current * dsRef.current));
        return;
      }

      if (gPhase.current === 'pinch') return;

      // 復元ブラシ: 指の軌跡を貯める。実際の画素書き換えは離した時に1回だけ行う
      // （毎フレーム画像全体を作り直すと重すぎるため）。
      if (gPhase.current === 'restore') {
        const lx = gStartLX.current + gs.dx;
        const ly = gStartLY.current + gs.dy;
        const z = zoomRef.current;
        const { x, y } = localToImage(lx, ly, z);
        strokeImgRef.current.push([x, y]);
        flushStroke();
        return;
      }

      // ── パン (move モードのみ) ─────────────────────────────────────────
      if (appModeRef.current === 'move') {
        if (gPhase.current === 'pending') {
          if (Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD)
            gPhase.current = 'pan';
        }
        if (gPhase.current === 'pan') {
          const { scale, tx, ty } = gStartZoom.current;
          scheduleZoom(clampZoom({ scale, tx: tx + gs.dx, ty: ty + gs.dy },
            canvasSizeRef.current.w, canvasSizeRef.current.h,
            imageWRef.current * dsRef.current, imageHRef.current * dsRef.current));
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
        if (!moved) {
          if (appModeRef.current === 'draw') {
            // draw モード: タップ座標に四角を追加
            const z = zoomRef.current;
            const { x, y } = localToImage(gStartLX.current, gStartLY.current, z);
            addRect(x, y);
          } else if (appModeRef.current === 'eyedropper') {
            // スポイト: タップ位置の色を透過させる。画像外のタップは無視する。
            const z = zoomRef.current;
            const { x, y } = localToImage(gStartLX.current, gStartLY.current, z);
            if (x >= 0 && x < imageWRef.current && y >= 0 && y < imageHRef.current
                // 透過済みの場所のタップは見た目が変わらない（空振り）ので、
                // 履歴を積まずに無視する。積むと undo が1回無反応になり、
                // 重い rgba スナップショットの枠も無駄に消費する。
                && !isTransparentAt(rgbaRef.current, imageWRef.current, imageHRef.current, x, y)
                // 前のスポイトが反映され終わるまでは受け付けない（連打対策）。
                && !eyeBusyRef.current) {
              // 画像の書き換えと記録は親が行う（元画像＋操作列を親が持っているため）。
              // 先に波紋を描いてから実処理へ（処理中は JS が止まるので順序が重要）。
              eyeBusyRef.current = true;
              setPast(p => [...p, { kind: 'edit' }]);
              setFuture([]);
              setRipple({ x: gStartLX.current, y: gStartLY.current });
              startRipple();
              // 実処理は「表示が確定してから」走らせる。ここで直接呼ぶと、
              // 重い同期処理が描画コミットより先に走り、ローディングが
              // 出ないまま終わったように見える。予約だけしておき、
              // eyeBusy の描画が済んだ後に useEffect 側から実行する。
              pendingHeavyRef.current = () =>
                onEyedropRef.current?.(x, y, eyeTolRef.current, featherRef.current);
              setEyeBusy(true);
            }
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
          // スポイトと同じく、表示が確定してから重い処理に入る。
          pendingHeavyRef.current = () =>
            onRestoreRef.current?.(pts, brushRadiusRef.current);
          eyeBusyRef.current = true;
          setEyeBusy(true);
        }
      }

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

  const groupTransform = [
    { translateX: zoom.tx },
    { translateY: zoom.ty },
    { scale: zoom.scale },
  ];

  // 連番ラベルの画面座標
  const labelPositions = useMemo(() =>
    polygons.map(poly => {
      const [cx, cy] = centroid(poly.points);
      return { sx: cx * ds * zoom.scale + zoom.tx, sy: cy * ds * zoom.scale + zoom.ty };
    }),
  [polygons, ds, zoom]);

  const selectedPoly = selectedId !== null ? polygons.find(p => p.id === selectedId) : null;


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
          // 実測サイズで ds を計算し、画像をキャンバス内に収まるよう zoom を確定
          // 初期 zoom { scale:1, tx:0, ty:0 } を起点に clampZoom が中央に配置する
          const measuredDs = Math.min(
            (width  - PAD_L - PAD_R) / bgResult.width,
            (height - PAD_T - PAD_B) / bgResult.height,
          );
          setZoom(clampZoom(
            { scale: 1, tx: 0, ty: 0 },
            width, height,
            bgResult.width * measuredDs, bgResult.height * measuredDs,
          ));
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

          {/* 選択中ポリゴンの頂点ハンドル (Group 外: 常に固定サイズ) */}
          {selectedPoly?.points.map(([px, py], vi) => {
            const sx = px * ds * zoom.scale + zoom.tx;
            const sy = py * ds * zoom.scale + zoom.ty;
            const isSelVtx = vi === selectedVertexIdx; // この頂点が選択中か
            return (
              <React.Fragment key={vi}>
                {/* 外側のグロー */}
                <Circle cx={sx} cy={sy} r={13} color="rgba(255,255,255,0.12)" />
                {/* ハンドル本体: 選択中は赤リングで強調（削除可能であることを示す） */}
                <Circle cx={sx} cy={sy} r={8} color="#FFFFFF" />
                <Circle cx={sx} cy={sy} r={8}
                  color={isSelVtx ? IOS.red : 'rgba(0,0,0,0.25)'}
                  style="stroke" strokeWidth={isSelVtx ? 2.5 : 1} />
              </React.Fragment>
            );
          })}

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
          <View style={styles.retransWrap} pointerEvents="box-none">
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
                  onValueChange={setCellTol}
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
        {appMode === 'restore' && !chromeHidden && (
          <View style={styles.brushBar} pointerEvents="box-none">
            <View style={styles.brushCard}>
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
                onSlidingStart={() => { discardStroke(); setBrushSliding(true); }}
                onValueChange={setBrushPx}
                onSlidingComplete={() => setBrushSliding(false)}
                minimumTrackTintColor={IOS.blue}
                maximumTrackTintColor="rgba(255,255,255,0.28)"
                thumbTintColor="#FFF"
              />
            </View>
          </View>
        )}

        {/* スポイト処理中の全面ブロック。処理は同期的に JS を止めるので、
            eyeBusy の描画が確定してから実処理に入る（下の useEffect が担保）。 */}
        {eyeBusy && (
          <View style={styles.busyOverlay}>
            <View style={styles.busyCard}>
              <ActivityIndicator color="#FFF" />
              <Text style={styles.busyTxt}>{t('editor.eyedropBusy')}</Text>
            </View>
          </View>
        )}

        {/* ポリゴン連番バッジ */}
        {labelPositions.map((pos, idx) => (
          <View
            key={polygons[idx].id}
            pointerEvents="none"
            style={[
              styles.badge,
              polygons[idx].id === selectedId && styles.badgeSelected,
              { left: pos.sx - 13, top: pos.sy - 13 },
            ]}
          >
            <Text style={[styles.badgeTxt, polygons[idx].id === selectedId && { color: '#FFF' }]}>
              {idx + 1}
            </Text>
          </View>
        ))}

        {/* 現在のツールの説明。常時出す。
            アイコンだけだと何のツールか分からず、移動モードでは何も出ていなくて
            画面が寂しかったので、3モードとも「名前＋やること」を1行で示す。*/}
        {!chromeHidden && (
          <ToolHint
            icon={TOOL_HINTS[appMode].icon}
            title={t(TOOL_HINTS[appMode].titleKey)}
            desc={t(TOOL_HINTS[appMode].descKey)}
            // ズームバー（高さ約40 + 下余白8）のぶん上へ逃がす。
            bottom={ZOOM_BAR_H + 16}
          />
        )}

        {/* ── フローティング上部: 下地切替 ── */}
        <View style={styles.floatingTop} pointerEvents="box-none">
          <View style={styles.bgSegmented}>
            {([
              // 'gray' は廃止（市松・白・黒で用は足りるため）。設定の「背景色」も同じ3択。
              { mode: 'checker', label: t('colors.checker') },
              { mode: 'white',   label: t('colors.white') },
              { mode: 'black',   label: t('colors.black') },
            ] as const).map(({ mode, label }) => (
              <AnimatedPressable
                key={mode}
                style={[styles.bgSegBtn, bgMode === mode && styles.bgSegBtnOn]}
                onPress={() => setBgMode(mode)}
                pressedScale={0.94}
              >
                <Text style={[styles.bgSegTxt, bgMode === mode && styles.bgSegTxtOn]}>
                  {label}
                </Text>
              </AnimatedPressable>
            ))}
          </View>
          {/* 現在倍率。常時表示。編集中は今どれだけ拡大しているかを常に確認したい。 */}
          <View style={styles.zoomBadge} pointerEvents="none">
            <Text style={styles.zoomBadgeTxt}>×{zoom.scale.toFixed(1)}</Text>
          </View>
        </View>

        {/* ── フローティングボタン群 (右端: モード切替) ── */}
        <View style={styles.floating} pointerEvents="box-none">
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'draw' && styles.floatBtnActive]}
            disabled={eyeBusy}
            onPress={() => setAppMode('draw')}
          >
            <Icon name="edit" size={22} color="#FFF" />
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'move' && styles.floatBtnActive]}
            disabled={eyeBusy}
            onPress={() => setAppMode('move')}
          >
            <Icon name="pan-tool" size={22} color="#FFF" />
          </AnimatedPressable>
          {/* スポイト: タップした色を透過させる。描画/移動と排他のツール。 */}
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'eyedropper' && styles.floatBtnActive]}
            disabled={eyeBusy}
            onPress={() => setAppMode('eyedropper')}
          >
            <Icon name="colorize" size={22} color="#FFF" />
          </AnimatedPressable>
          {/* 復元ブラシ: 消えすぎた部分を元画像から戻す。親が対応している時だけ出す。 */}
          {onRestore && (
            <AnimatedPressable
              style={[styles.floatBtn, appMode === 'restore' && styles.floatBtnActive]}
              disabled={eyeBusy}
              onPress={() => setAppMode('restore')}
            >
              <Icon name="healing" size={22} color="#FFF" />
            </AnimatedPressable>
          )}
          {/* 透過強度パネルの開閉。既定は閉じていて画像を覆わない。 */}
          {onRetransparent && (
            <AnimatedPressable
              style={[styles.floatBtn, retransOpen && styles.floatBtnActive]}
              disabled={eyeBusy}
              onPress={() => { setRetransOpen(o => !o); setChromeHidden(false); }}
            >
              <Icon name="tune" size={22} color="#FFF" />
            </AnimatedPressable>
          )}
          {/* 重なっているものを一時的に全部隠す。画像の端を直す時の逃げ道。 */}
          <AnimatedPressable
            style={[styles.floatBtn, chromeHidden && styles.floatBtnActive]}
            disabled={eyeBusy}
            onPress={() => setChromeHidden(h => !h)}
          >
            <Icon name={chromeHidden ? 'visibility' : 'visibility-off'} size={22} color="#FFF" />
          </AnimatedPressable>
        </View>

        {/* ── ズームバー: [−] 倍率スライダー [＋] │ 全体表示 ──
            ズーム操作を横1列にまとめる。スライダーは対数目盛りで、
            ×1/×2/×4/×8/×12 の目盛りに吸い付く。細かく詰めたい時は連続値、
            決め打ちしたい時は目盛り、と両方できる。 */}
        {!chromeHidden && (
        <View style={styles.zoomBar} pointerEvents="box-none">
          <View style={styles.zoomRow}>
            <AnimatedPressable
              style={styles.zoomStepBtn}
              disabled={zoom.scale <= ZOOM_MIN}
              onPress={() => stepZoom(-1)}
            >
              <Text style={styles.zoomStepTxt}>－</Text>
            </AnimatedPressable>
            {/* 倍率スライダー（対数目盛り）。目盛りは ×1/×2/×4/×8/×12 で、
                指を離した時に近ければ吸い付く。連続値でも刻みでも狙える。 */}
            <View style={styles.zoomSliderWrap}>
              <View style={styles.zoomTicks} pointerEvents="none">
                {ZOOM_PRESETS.map(p => (
                  <View
                    key={p}
                    style={[
                      styles.zoomTick,
                      // トラック両端はつまみ半径ぶん内側なので、目盛りも同じ式で置く。
                      { left: `${zoomToSlider(p) * 100}%` },
                    ]}
                  />
                ))}
              </View>
              <Slider
                style={styles.zoomSlider}
                minimumValue={0}
                maximumValue={1}
                value={sliderV}
                onSlidingStart={() => { zoomDraggingRef.current = true; discardStroke(); }}
                onValueChange={v => {
                  setSliderV(v);
                  setZoomScale(sliderToZoom(v));
                }}
                onSlidingComplete={v => {
                  // 目盛りの近くで離したらぴったりの倍率へ寄せる。
                  const near = ZOOM_PRESETS.find(
                    p => Math.abs(zoomToSlider(p) - v) <= ZOOM_SNAP_R);
                  const finalV = near !== undefined ? zoomToSlider(near) : v;
                  setSliderV(finalV);
                  setZoomScale(near !== undefined ? near : sliderToZoom(v));
                  zoomDraggingRef.current = false;
                }}
                minimumTrackTintColor={IOS.blue}
                maximumTrackTintColor="rgba(255,255,255,0.28)"
                thumbTintColor="#FFF"
              />
            </View>
            <AnimatedPressable
              style={styles.zoomStepBtn}
              disabled={zoom.scale >= ZOOM_MAX}
              onPress={() => stepZoom(1)}
            >
              <Text style={styles.zoomStepTxt}>＋</Text>
            </AnimatedPressable>
            {/* 全体表示に戻す。拡大しすぎた・画像がどこかへ行った時の復帰専用。
                バーの外に置くとツール説明と重なるため、[＋] の隣に並べる。 */}
            <View style={styles.zoomSep} />
            <AnimatedPressable style={styles.zoomStepBtn} onPress={resetZoom} pressedScale={0.9}>
              <Icon name="refresh" size={19} color="#FFF" />
            </AnimatedPressable>
          </View>
        </View>
        )}
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
    right:     8,
    top:       8,
  },

  // ── フローティングボタン群 (キャンバス右端縦並び) ─────────────────────────
  floating: {
    position: 'absolute',
    right: 8,
    top: '30%',
    alignItems: 'center',
    gap: 8,
  },
  floatBtn: {
    width: 44, height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(30,30,30,0.72)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
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

  // ── 倍率バッジ / ズームバー ────────────────────────────────────────────────
  zoomBadge: {
    marginTop: 6,
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(30,30,30,0.72)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  zoomBadgeTxt: {
    color: '#FFF',
    fontSize: 13,
    fontVariant: ['tabular-nums'],  // 倍率が動いても幅が揺れないようにする
  },
  zoomBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 8,
    alignItems: 'center',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(30,30,30,0.72)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  zoomStepBtn: {
    width: 32, height: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  zoomStepTxt: { fontSize: 18, color: '#FFF' },
  // ── 透過強度パネル（セル編集のみ）─────────────────────────────────────────
  retransWrap: {
    position: 'absolute',
    left: 12, right: 12, top: 56,
    alignItems: 'center',
  },
  retransCard: {
    width: '100%',
    maxWidth: 340,
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
  brushBar: {
    position: 'absolute',
    left: 12, right: 12, bottom: ZOOM_BAR_H + 56,
    alignItems: 'center',
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

  zoomSliderWrap: {
    width: 150,
    height: 30,
    justifyContent: 'center',
  },
  zoomSlider: { width: '100%', height: 30 },
  // 目盛り。トラックの裏に細い縦線を置く。
  zoomTicks: {
    position: 'absolute',
    left: 10, right: 10,
    top: 13, height: 4,
  },
  zoomTick: {
    position: 'absolute',
    width: 1.5, height: 4,
    marginLeft: -0.75,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  // [＋] と全体表示ボタンの間の区切り。役割が違うことを示す。
  zoomSep: {
    width: 0.5,
    height: 20,
    marginHorizontal: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },


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
