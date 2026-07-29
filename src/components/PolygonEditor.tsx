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
  Alert,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import ImageZoomModal from './ui/ImageZoomModal';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {
  Canvas,
  Image as SkiaImage,
  Path,
  Circle,
  Group,
  Rect,     // 下地レイヤーの単色塗り・市松タイルに使用
  Skia,
  ColorType,
  AlphaType,
} from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import type { RemoveBgResult, BBox } from '../imaging';
import { splitConnected, removeColorAt, isTransparentAt } from '../imaging';
import { useThumbBg } from '../hooks/useThumbBg';
import { useSettings } from '../settings/SettingsContext';
// イラスト輪郭切り抜きでは直線スナップの利得が小さく点が飛ぶ副作用が大きいため除去した。

// ── 定数 ───────────────────────────────────────────────────────────────────

/** 四角の初期サイズ: 画像短辺の何割か */
const RECT_RATIO     = 0.30;
const ZOOM_MIN       = 1;
const ZOOM_MAX       = 6;
const ZOOM_STEP      = 0.5; // ボタン1回分のズーム量
const PAD_L = 24; // キャンバス左余白 (表示px)
const PAD_R = 64; // 右余白（フローティングボタン分を含む）
const PAD_T = 24; // 上余白
const PAD_B = 24; // 下余白
const PAN_THRESHOLD  = 8;          // この距離(表示px)を超えたらパンとみなす
const VERTEX_HIT_PX  = 20;         // 頂点ヒット判定半径(表示px)
const EDGE_HIT_PX    = 15;         // 辺ヒット判定距離(表示px)
const LONG_PRESS_MS  = 500;        // 長押し判定時間(ms)
/**
 * 履歴に保持する rgba スナップショットの最大数。
 * 1枚が画像まるごと（長辺2500pxなら約25MB）なので無制限には積めない。
 * 超えた分は古いスナップショットから捨てる＝それより前には戻せなくなるだけで、
 * 残りの履歴は繋がったまま。
 */
const MAX_RGBA_SNAPSHOTS = 3;

// ── 型 ─────────────────────────────────────────────────────────────────────

export type Polygon = { id: number; points: [number, number][] };
/** eyedropper = スポイト: タップした色を透過させる（ポリゴンは操作しない） */
type AppMode = 'draw' | 'move' | 'eyedropper';

/**
 * undo/redo の履歴エントリ。
 * ポリゴン形状の巻き戻しと、スポイトによる画像の巻き戻しを1本のスタックで扱う
 * （undo ボタンが目の前にあるのにスポイトだけ戻らない、という状態を避けるため）。
 */
type HistEntry =
  | { kind: 'polygons'; polygons: Polygon[] }
  | { kind: 'rgba';     rgba: Uint8Array };
/** ジェスチャーの内部フェーズ */
type GesPhase =
  | 'idle'
  | 'pending'      // タップか動きか判定中
  | 'pan'
  | 'pinch'
  | 'drag_vertex'  // 頂点ドラッグ中
  | 'drag_poly'    // ポリゴン全体移動中
  | 'drag_edge';   // 辺の両端頂点を同時移動中

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

export default function PolygonEditor({ bgResult, displayW, displayH, onPreview, onBack, initialPolygons, onPolygonsChange, onSettings, onHome, originalImageUri }: Props) {

  const { settings } = useSettings();
  // スポイトで bgResult.rgba を直接書き換えるため参照は変わらない。
  // SkImage を作り直すトリガーとして使う。
  const [imgVersion, setImgVersion] = useState(0);

  // ── SkImage ──────────────────────────────────────────────────────────────
  const skImage = useMemo<SkImage | null>(() => {
    const { rgba, width, height } = bgResult;
    const data = Skia.Data.fromBytes(rgba);
    return Skia.Image.MakeImage(
      { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      data, width * 4,
    );
    // imgVersion: スポイトで rgba を書き換えた後に作り直すための依存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgResult, imgVersion]);

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
  // BgMode は ThumbMode('white'|'gray'|'checker') に 'black' を足した上位集合のため、
  // 設定値をそのまま初期値に使える。
  type BgMode = 'checker' | 'white' | 'gray' | 'black';
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
  /**
   * 入場時の画像（リセット用）。スポイトを初めて使った時のスナップショットを
   * そのまま流用するので、追加のコピーは発生しない。
   * null = スポイト未使用 = 画像は入場時のまま。
   */
  const originalRgbaRef = useRef<Uint8Array | null>(null);

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

  // ── Undo/Redo ─────────────────────────────────────────────────────────────

  /** 現在の polygons を past に積んで future をクリアする */
  const pushHistory = useCallback(() => {
    setPast(p  => [...p, { kind: 'polygons', polygons: polygonsRef.current }]);
    setFuture([]);
  }, []);

  /**
   * スポイト実行「前」の画像を past に積む。
   * rgba は重いので MAX_RGBA_SNAPSHOTS を超えたら古い rgba から間引く
   * （ポリゴンのエントリは軽いのでそのまま残す）。
   *
   * NOTE: スナップショットは必ず呼び出し側が「書き換える前」に同期でコピーして渡すこと。
   * updater 関数の中で rgbaRef から取ると、updater は render フェーズで走るため
   * その時点では既に removeColorAt が書き換え済み＝変更後の画像を積んでしまい、
   * undo しても何も戻らなくなる。
   */
  const pushRgbaHistory = useCallback((snapshot: Uint8Array) => {
    setPast(p => {
      const next: HistEntry[] = [...p, { kind: 'rgba', rgba: snapshot }];
      let over = next.filter(e => e.kind === 'rgba').length - MAX_RGBA_SNAPSHOTS;
      if (over <= 0) return next;
      // 先頭（＝古い方）から over 個だけ rgba エントリを落とす。
      return next.filter(e => {
        if (e.kind === 'rgba' && over > 0) { over--; return false; }
        return true;
      });
    });
    setFuture([]);
  }, []);

  /**
   * 画像を巻き戻す/やり直す共通処理。
   * bgResult.rgba は App 側と共有している同一の配列なので、参照を差し替えず
   * 中身を書き戻す（差し替えると書き出し側が古い配列を見続けてしまう）。
   */
  const applyRgbaSnapshot = useCallback((snapshot: Uint8Array): HistEntry => {
    const current: HistEntry = { kind: 'rgba', rgba: rgbaRef.current.slice() };
    rgbaRef.current.set(snapshot);
    setImgVersion(v => v + 1);
    return current;
  }, []);

  const handleUndo = () => {
    if (pastRef.current.length === 0) return;
    const prev = [...pastRef.current];
    const snap = prev.pop()!;
    setPast(prev);
    if (snap.kind === 'rgba') {
      const current = applyRgbaSnapshot(snap.rgba);
      setFuture(f => [current, ...f]);
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
    if (snap.kind === 'rgba') {
      const current = applyRgbaSnapshot(snap.rgba);
      setPast(p => [...p, current]);
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
  const handleReset = () => {
    Alert.alert(
      '編集をリセット',
      'ポリゴンとスポイトで消した色を、この画面に入った直後の状態に戻します。\nこの操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'リセット',
          style: 'destructive',
          onPress: () => {
            if (originalRgbaRef.current) {
              // App 側と共有している配列なので中身を書き戻す（参照は差し替えない）。
              rgbaRef.current.set(originalRgbaRef.current);
              originalRgbaRef.current = null;
              setImgVersion(v => v + 1);
            }
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
      // ヒット時: bbox の4隅をそのまま四角にする（位置もサイズも bbox 由来＝ズレない）。
      points = [[hit.minX, hit.minY], [hit.maxX, hit.minY], [hit.maxX, hit.maxY], [hit.minX, hit.maxY]];
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
          if (distPointToSegment(lx, ly, a.sx, a.sy, b.sx, b.sy) < EDGE_HIT_PX) {
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
    onStartShouldSetPanResponder: () => true,
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

      // move モード: 選択中ポリゴンの頂点ヒット判定
      const selId = selectedIdRef.current;
      if (selId !== null) {
        const poly = polygonsRef.current.find(p => p.id === selId);
        if (poly) {
          const z = zoomRef.current;
          for (let i = 0; i < poly.points.length; i++) {
            const { sx, sy } = imageToLocal(poly.points[i][0], poly.points[i][1], z);
            if (Math.hypot(lx - sx, ly - sy) < VERTEX_HIT_PX) {
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
            if (distPointToSegment(lx, ly, a.sx, a.sy, b.sx, b.sy) < EDGE_HIT_PX) {
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
        setZoom(clampZoom({
          scale: newScale,
          tx: gPinchMidX.current - focalX * newScale,
          ty: gPinchMidY.current - focalY * newScale,
        }, canvasSizeRef.current.w, canvasSizeRef.current.h,
           imageWRef.current * dsRef.current, imageHRef.current * dsRef.current));
        return;
      }

      if (gPhase.current === 'pinch') return;

      // ── パン (move モードのみ) ─────────────────────────────────────────
      if (appModeRef.current === 'move') {
        if (gPhase.current === 'pending') {
          if (Math.abs(gs.dx) > PAN_THRESHOLD || Math.abs(gs.dy) > PAN_THRESHOLD)
            gPhase.current = 'pan';
        }
        if (gPhase.current === 'pan') {
          const { scale, tx, ty } = gStartZoom.current;
          setZoom(clampZoom({ scale, tx: tx + gs.dx, ty: ty + gs.dy },
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
                && !isTransparentAt(rgbaRef.current, imageWRef.current, imageHRef.current, x, y)) {
              // 書き換える前に「同期で」コピーする（updater 内で取ると手遅れになる）。
              const before = rgbaRef.current.slice();
              // 初回のスポイトのスナップショット = 入場時の画像。リセット用に保持する。
              if (!originalRgbaRef.current) originalRgbaRef.current = before;
              pushRgbaHistory(before); // 実行前の画像を undo 用に退避
              removeColorAt(rgbaRef.current, imageWRef.current, imageHRef.current, x, y, eyeTolRef.current, featherRef.current);
              setImgVersion(v => v + 1);
            }
          } else {
            // move モード: 辺タップ・ポリゴン選択
            handleMoveTap(gStartLX.current, gStartLY.current);
          }
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
      gPhase.current             = 'idle';
    },
  })).current;

  // ── Skia 描画データ ───────────────────────────────────────────────────────

  // ポリゴンパスのキャッシュ: ポリゴンID → { points参照, ds, SkPath }
  // poly.points の参照が変わったときだけ Path を再生成することで、
  // ドラッグ中に変化しないポリゴンは Skia.Path.Make() を毎フレーム呼ばなくて済む。
  // setPolygons の updater 関数は変化のないポリゴンを「同じ参照のまま」返すためキャッシュがヒットする。
  const pathCacheRef = useRef(new Map<number, { pts: [number,number][]; ds: number; path: ReturnType<typeof Skia.Path.Make> }>());

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

  // 市松タイルを useMemo でキャッシュ: canvasSize/bgMode が変わらない限り毎レンダーで再生成しない。
  // ドラッグ中は canvasSize も bgMode も変化しないのでキャッシュがヒットし続ける。
  const CHECKER_TILE = 20;
  const checkerTiles = useMemo(() => {
    if (bgMode !== 'checker') return null;
    const cols = Math.ceil(canvasSize.w / CHECKER_TILE);
    const rows = Math.ceil(canvasSize.h / CHECKER_TILE);
    const tiles: React.ReactElement[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const light = (r + c) % 2 === 0;
        tiles.push(
          <Rect key={`${r}-${c}`} x={c * CHECKER_TILE} y={r * CHECKER_TILE}
            width={CHECKER_TILE} height={CHECKER_TILE}
            color={light ? '#CCCCCC' : '#999999'} />,
        );
      }
    }
    return tiles;
  }, [bgMode, canvasSize]);

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
    return <View style={styles.root}><Text style={styles.error}>画像の読み込みに失敗しました</Text></View>;
  }

  const canPreview = polygons.length > 0;
  // onLayout 前は canvasSize が未確定 → Canvas を描画しない（ズレ防止）
  const canvasReady = canvasSize.w > 0;

  const header = (
    <AppHeader
      title="手動切り抜き"
      onBack={() => onBack(polygons)}
      backLabel="戻る"
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
          {bgMode === 'gray' && (
            <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h} color="#888888" />
          )}
          {bgMode === 'black' && (
            <Rect x={0} y={0} width={canvasSize.w} height={canvasSize.h} color="#000000" />
          )}
          {/* 市松はドラッグ中にも canvasSize/bgMode が変わらないため useMemo でキャッシュ済み */}
          {checkerTiles}

          <Group transform={groupTransform}>
            {/* 背景除去済み画像 */}
            <SkiaImage
              image={skImage}
              x={0} y={0}
              width={bgResult.width * ds}
              height={bgResult.height * ds}
              fit="fill"
            />

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

        {/* draw / スポイト モード インジケーター（同じヒント枠を流用）*/}
        {(appMode === 'draw' || appMode === 'eyedropper') && (
          <View style={styles.drawHint} pointerEvents="none">
            <Text style={styles.drawHintTxt}>
              {appMode === 'draw' ? '✦ タップで追加' : '✦ 消したい色をタップ'}
            </Text>
          </View>
        )}

        {/* ── フローティング上部: 下地切替 ── */}
        <View style={styles.floatingTop} pointerEvents="box-none">
          <View style={styles.bgSegmented}>
            {([
              { mode: 'checker', label: '市松' },
              { mode: 'white',   label: '白'   },
              { mode: 'gray',    label: '灰'   },
              { mode: 'black',   label: '黒'   },
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
        </View>

        {/* ── フローティングボタン群 (右端: モード切替 + ズーム) ── */}
        <View style={styles.floating} pointerEvents="box-none">
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'draw' && styles.floatBtnActive]}
            onPress={() => setAppMode('draw')}
          >
            <Icon name="edit" size={22} color="#FFF" />
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'move' && styles.floatBtnActive]}
            onPress={() => setAppMode('move')}
          >
            <Icon name="pan-tool" size={22} color="#FFF" />
          </AnimatedPressable>
          {/* スポイト: タップした色を透過させる。描画/移動と排他のツール。 */}
          <AnimatedPressable
            style={[styles.floatBtn, appMode === 'eyedropper' && styles.floatBtnActive]}
            onPress={() => setAppMode('eyedropper')}
          >
            <Icon name="colorize" size={22} color="#FFF" />
          </AnimatedPressable>
          {/* 区切り */}
          <View style={styles.floatDivider} />
          {/* ズームボタン */}
          <AnimatedPressable
            style={styles.floatBtn}
            disabled={zoom.scale >= ZOOM_MAX}
            onPress={() => stepZoom(1)}
          >
            <Text style={styles.floatBtnTxt}>＋</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.floatBtn}
            disabled={zoom.scale <= ZOOM_MIN}
            onPress={() => stepZoom(-1)}
          >
            <Text style={styles.floatBtnTxt}>－</Text>
          </AnimatedPressable>
        </View>
      </View>

      {/* ── 下部コントロールバー: undo / redo / 削除 / 保存 ── */}
      <View style={styles.bar}>
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={past.length === 0}
          onPress={handleUndo}
        >
          <Icon name="undo" size={24} color={IOS.label} />
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={future.length === 0}
          onPress={handleRedo}
        >
          <Icon name="redo" size={24} color={IOS.label} />
        </AnimatedPressable>
        {/* 削除ボタン: 頂点選択中=頂点削除 / ポリゴン選択中=ポリゴン削除 / 未選択=非活性 */}
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={selectedId === null}
          onPress={deleteSelected}
        >
          <Icon name="delete" size={24} color={selectedId !== null ? IOS.red : IOS.label} />
        </AnimatedPressable>
        {/* リセット: ポリゴンもスポイトも入場時に戻す（確認ダイアログあり）。
            戻すものが何も無い時は非活性。 */}
        <AnimatedPressable
          style={styles.barIconBtn}
          disabled={polygons.length === 0 && past.length === 0}
          onPress={handleReset}
        >
          <Icon name="refresh" size={24} color={IOS.label} />
        </AnimatedPressable>
        {/* プレビューボタン: ポリゴンが 1 枚以上ある時だけ活性 */}
        <AnimatedPressable
          style={styles.exportBtn}
          disabled={!canPreview}
          onPress={() => onPreview(polygons)}
          pressedScale={0.96}
        >
          <Icon name="preview" size={20} color="#FFF" />
          <Text style={styles.exportBtnTxt}>プレビュー</Text>
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
  floatDivider: {
    width: 28,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginVertical: 2,
  },

  // draw モードのオーバーレイヒント（iOS のトースト風）
  drawHint: {
    position: 'absolute', bottom: 20, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
  },
  drawHintTxt: { fontSize: 13, fontWeight: '600', color: '#FFF', letterSpacing: 0.2 },

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
