/**
 * SetupScreen.tsx — 自動分割の行数確認 + 分割境界線プレビュー画面
 *
 * removeBackground 完了後、実際に分割する前に表示する。
 * 横線: 画像を rows 等分した行境界 y（全幅共通）
 * 縦線: 画像を cols 等分した列境界 x（全幅共通・画像の上端から下端まで貫く1本）
 * rows×cols の均等グリッドとして描画し、行数/列数ステッパー変更で両線が更新される。
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import ImageZoomModal from './ui/ImageZoomModal';
import Card from './ui/Card';
import CheckerboardBg from './ui/CheckerboardBg';
import ToleranceSlider from './ui/ToleranceSlider';
import { TOOL_ICONS } from './ui/ToolHint';
import Divider from './ui/Divider';
import { useT } from '../i18n';
// 均等グリッド化に伴い calcColEdgesPerRow の呼び出しは廃止（関数自体は splitObjects 側に残置）。
import { calcRowBoundaries } from '../imaging/splitObjects';
import { useSettings } from '../settings/SettingsContext';
import { useThumbBg } from '../hooks/useThumbBg';
import { isTransparentAt, detectRowCount, detectColCount, toleranceToGapParams } from '../imaging';
import type { RemoveBgResult } from '../imaging';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// 隣接線と入れ替わらないよう最小すき間。線を動かす時のクランプに使う。
const MIN_GAP = 1;
/**
 * 配列 arr の index 番目の線を valImg（画像座標）へ動かす際、両隣の線（無ければ端 0/dim）の
 * 内側に MIN_GAP 以上残して収める。順序が崩れて格子が破綻するのを防ぐ。
 */
function clampBetween(valImg: number, arr: number[], index: number, dim: number) {
  const lo = (index > 0 ? arr[index - 1] : 0) + MIN_GAP;
  const hi = (index < arr.length - 1 ? arr[index + 1] : dim) - MIN_GAP;
  return Math.round(clamp(valImg, lo, hi));
}

type SetupMode = 'auto' | 'manual';

interface Props {
  bgResult: RemoveBgResult;
  initialRows: number;
  /** 列数ステッパーの初期値。自動推定した列数（detectColCount）を渡す。 */
  initialCols?: number;
  /**
   * 分割境界線の初期値（画像座標系）。分割後に戻ってきた時に前回編集した線を復元するため。
   * null/未指定なら等分割で初期化する。本数が initialRows/initialCols と食い違う場合も等分割にフォールバック。
   */
  initialBounds?: { rowYsImg: number[]; colXsImg: number[] } | null;
  initialMode?: SetupMode;
  onConfirm: (
    rows: number,
    cols: number,
    mode: SetupMode,
    noSplit: boolean,
    /** 編集後の分割境界（画像座標系）。自動モードで実際に切る位置に使う。 */
    bounds?: { rowYsImg: number[]; colXsImg: number[] },
  ) => void;
  onBack: () => void;
  /**
   * 画像編集は「元画像 + 操作列」を呼び出し側が持ち、この画面は操作を通知するだけ。
   * 取り消し・やり直し・リセットも呼び出し側で列を操作して画像を作り直す。
   * bgVersion は作り直しの通知（rgba は同一参照のまま中身が変わるため）。
   */
  onEyedrop?: (x: number, y: number, tolerance: number, feather: boolean) => void;
  onUndoEdit?: () => void;
  onRedoEdit?: () => void;
  onResetEdits?: () => void;
  canUndoEdit?: boolean;
  canRedoEdit?: boolean;
  bgVersion?: number;
  onSettings?: () => void;
  onHome?: () => void;
  /** ヘッダーの「元画像」ズーム用。分割結果(ResultScreen)とヘッダーを揃える。 */
  originalImageUri?: string;
}

export default function SetupScreen({ bgResult, initialRows, initialCols, initialBounds, initialMode = 'auto', onConfirm, onBack, onEyedrop, onUndoEdit, onRedoEdit, onResetEdits, canUndoEdit, canRedoEdit, bgVersion = 0, onSettings, onHome, originalImageUri }: Props) {
  const { settings, updateSettings } = useSettings();
  const { t } = useT();
  const thumbBg = useThumbBg();
  const [rows, setRows] = useState(initialRows);
  // 列数。行数ステッパーと全く同じUI・挙動。初期値は自動推定した列数(initialCols)。
  const [cols, setCols] = useState(initialCols ?? 1);
  // ヘッダー「元画像」ズームモーダルの表示状態（分割結果と同挙動）
  const [zoomVisible, setZoomVisible] = useState(false);
  // スライダー操作中の表示用。確定時に updateSettings へ反映する。
  // 背景除去の settings.tolerance とは別キー（splitTolerance）を使う。
  // 共有していた頃は、分割の細かさを動かすと以後の背景除去の強さまで変わってしまった。
  const [splitTolerance, setSplitTolerance] = useState(settings.splitTolerance);
  const [mode, setMode] = useState<SetupMode>(initialMode);
  // スポイトモード: ON中は画像タップでその位置の色を消す（線のドラッグは無効化）。
  // 枠付きシートのように自動透過が内側まで届かない画像で、背景を抜いてから
  // 行数・列数の再検出に乗せるための下ごしらえ用。
  const [eyedropperMode, setEyedropperMode] = useState(false);
  const [noSplit, setNoSplit] = useState(false);
  const [viewSize, setViewSize] = useState<{ width: number; height: number } | null>(null);
  // ── グリッド線の選択状態（今回は「タップ選択＋ハイライト表示」まで）─────────────
  // axis='row'→横線、'col'→縦線。index は lineYs / lineXs の添字。null=未選択。
  const [selected, setSelected] = useState<{ axis: 'row' | 'col'; index: number } | null>(null);
  // 行数/列数が変わると線の本数・添字がずれるので選択をリセットする。
  useEffect(() => { setSelected(null); }, [rows, cols]);
  // モードを切り替えたらスポイトを必ず解除する。ONのまま手動モードへ行って戻ると
  // ボタンは消えているのに eyedropperModeRef が true のまま残り、
  // 線のタップ/ドラッグを黙って奪ってしまうため。
  useEffect(() => { setEyedropperMode(false); }, [mode]);
  // 画像が作り直されたら行数・列数を検出し直す（スポイト・取り消し・やり直し共通）。
  // 検出は alpha の帯だけを見るので、背景が抜ける前は区切りが無く 1×1 になる。
  // 初期表示(bgVersion=0)は親が渡した推定値を尊重するので何もしない。
  // 列数の自動推定は「まだステッパーを手動で触っていない時だけ」効かせるためのフラグ。
  // 手動で決めた列数を、スライダー操作の再推定で勝手に上書きしないための歯止め。
  const colsManualRef = useRef(false);
  /**
   * 「分割の細かさ」(splitTolerance) を列検出のしきい値に変換して、列数を推定し直す。
   * この値をここで使うのは、スライダーが動かしている対象が
   * 「どれくらいの隙間を列の切れ目とみなすか」＝列検出のしきい値そのものだから。
   * 既定値 30 では従来の定数(MIN_REAL_GAP=6 / RELATIVE_GAP_THRESHOLD=0.3)と
   * 完全に一致するので、スライダーを触らない限り従来と同じ推定結果になる。
   */
  const recalcCols = useCallback((nextRows: number, tol: number) => {
    const { minRealGap, relativeGapThreshold } = toleranceToGapParams(tol);
    setCols(detectColCount(
      bgResult.rgba, bgResult.width, bgResult.height, nextRows,
      minRealGap, relativeGapThreshold,
    ));
  }, [bgResult]);

  const firstVersionRef = useRef(true);
  useEffect(() => {
    if (firstVersionRef.current) { firstVersionRef.current = false; return; }
    const dRows = detectRowCount(bgResult.rgba, bgResult.width, bgResult.height);
    setRows(dRows);
    // 画像そのものが作り直された場合は手動指定の前提が崩れるので、手動フラグを
    // 解除して行数・列数とも推定し直す（従来どおりの挙動）。
    colsManualRef.current = false;
    recalcCols(dRows, splitTolerance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgVersion]);

  // ── 簡易トースト（連打防止つき）─────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastOpacity = useSharedValue(0);
  const toastBusy = useRef(false);
  const showToast = useCallback((msg: string) => {
    if (toastBusy.current) return; // 表示中は再発火しない
    toastBusy.current = true;
    setToastMsg(msg);
    toastOpacity.value = withTiming(1, { duration: 150 });
    setTimeout(() => {
      toastOpacity.value = withTiming(0, { duration: 250 });
      setTimeout(() => { setToastMsg(null); toastBusy.current = false; }, 250);
    }, 1400);
  }, [toastOpacity]);
  const toastAnim = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  // bgResult.rgba → base64 PNG URI（変換は1回だけ）
  const imageUri = useMemo(() => {
    const data = Skia.Data.fromBytes(bgResult.rgba);
    const img = Skia.Image.MakeImage(
      {
        width: bgResult.width,
        height: bgResult.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      data,
      bgResult.width * 4,
    );
    if (!img) return null;
    const b64 = img.encodeToBase64();
    img.dispose();
    return `data:image/png;base64,${b64}`;
    // bgVersion: 親が rgba の中身を作り直したときにプレビューを作り直すための依存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgResult, bgVersion]);

  /** 自動背景除去も含めて全部取り消し、元画像の状態に戻す。取り消せないので確認する。 */
  const handleResetEdits = useCallback(() => {
    Alert.alert(
      t('setup.resetTitle'),
      t('setup.resetMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.reset'), style: 'destructive', onPress: () => onResetEditsRef.current?.() },
      ],
    );
  }, [t]);
  const onResetEditsRef = useRef(onResetEdits); onResetEditsRef.current = onResetEdits;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  // ── プレビュー枠の高さを画像のアスペクト比から決める ──────────────────────────
  // 高さを 280px 固定にしていた頃は、縦長のスタンプシートが contain フィットで
  // 細く縮小され、左右にチェッカー柄の余白が大きく出ていた。枠自体を画像の形に
  // 寄せることでその余白を無くす。
  //
  // 高さは画像から決めたいので、先に「枠の幅」だけを外側の View で測る
  // （previewBox 自身の onLayout は高さが決まった後の実測値で、
  //   fitParams/線の位置/CheckerboardBg に使う既存の測定なのでそのまま残す）。
  const [containerWidth, setContainerWidth] = useState(0);
  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const dynamicPreviewHeight = useMemo(() => {
    if (!containerWidth) return 280; // 初回計測前のフォールバック（従来の固定値）
    const aspect = bgResult.width / bgResult.height; // 幅/高さ
    const idealHeight = containerWidth / aspect;
    const screenH = Dimensions.get('window').height;
    const maxHeight = screenH * 0.65; // 上限: 下のステッパー等を隠さないため
    const minHeight = 200; // 下限: 横長シート(1段だけ等)で潰れすぎないため
    return Math.min(Math.max(idealHeight, minHeight), maxHeight);
  }, [containerWidth, bgResult.width, bgResult.height]);

  // contain フィット変換パラメータ（横・縦両線で共用）
  const fitParams = useMemo(() => {
    if (!viewSize) return null;
    const { width: vW, height: vH } = viewSize;
    const { width: imgW, height: imgH } = bgResult;
    const scale = Math.min(vW / imgW, vH / imgH);
    return {
      scale,
      padX: (vW - imgW * scale) / 2,
      padY: (vH - imgH * scale) / 2,
    };
  }, [viewSize, bgResult]);

  // ── グリッド線を画像座標系（表示座標ではなく）の編集可能な state として保持する ──
  // 初期値は「前回編集した線(initialBounds)」があり本数が一致すればそれを、無ければ等分割。
  // 分割後に戻ってきた時に編集内容を復元するため（本数不一致時は安全側で等分割に倒す）。
  const [rowYsImg, setRowYsImg] = useState<number[]>(() =>
    initialBounds && initialBounds.rowYsImg.length === rows - 1
      ? initialBounds.rowYsImg
      : calcRowBoundaries(bgResult.height, rows),
  );
  // colXsImg: calcRowBoundaries は「長さを等分して内部境界を返す」汎用関数なので幅にも流用する。
  const [colXsImg, setColXsImg] = useState<number[]>(() =>
    initialBounds && initialBounds.colXsImg.length === cols - 1
      ? initialBounds.colXsImg
      : calcRowBoundaries(bgResult.width, cols),
  );
  // 行数/画像高さが「マウント後に」変わったら等分で再初期化（本数が変わり編集は保持不可のため破棄）。
  // マウント初回は上の初期値(=前回編集の復元)を上書きしないよう ref でスキップする。
  const rowInitRef = useRef(true);
  const colInitRef = useRef(true);
  useEffect(() => {
    if (rowInitRef.current) { rowInitRef.current = false; return; }
    setRowYsImg(calcRowBoundaries(bgResult.height, rows));
  }, [bgResult.height, rows]);
  useEffect(() => {
    if (colInitRef.current) { colInitRef.current = false; return; }
    setColXsImg(calcRowBoundaries(bgResult.width, cols));
  }, [bgResult.width, cols]);

  // 横線: 各 rowYsImg を display y に変換（全幅共通の線）
  const lineYs = useMemo(() => {
    if (!fitParams) return [];
    const { scale, padY } = fitParams;
    return rowYsImg.map(y => padY + y * scale);
  }, [fitParams, rowYsImg]);

  // 縦線: 各 colXsImg を display x に変換（全幅共通・全高を貫く線）
  const lineXs = useMemo(() => {
    if (!fitParams) return [];
    const { scale, padX } = fitParams;
    return colXsImg.map(x => padX + x * scale);
  }, [fitParams, colXsImg]);

  // splitCount: 均等グリッドなので rows × cols の単純な掛け算
  const splitCount = rows * cols;

  const lineColor = settings.splitLineColor ?? '#007AFF';
  // 選択中の線の色（未選択の線と明確に見分けるためオレンジで強調）
  const selColor = '#FF9500';

  // 分割線「伸びる」アニメ: 初回表示(レイアウト確定)＋行数変更で 0→1 を再生する。
  // transform のみで動かし（白化回避）、全線が同じ grow を共有する。
  // tolerance は線に無関係なので依存に入れない。
  const grow = useSharedValue(0);
  const fitReady = fitParams != null;
  useEffect(() => {
    if (!fitReady) return;
    grow.value = 0;
    grow.value = withTiming(1, { duration: 280 });
  }, [rows, cols, fitReady, grow]);
  // 横線=左から右へ（scaleX のみ / 原点 left）, 縦線=上から下へ（scaleY のみ / 原点 top）
  const hAnim = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));
  const vAnim = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));

  // ── 線のドラッグ移動（PanResponder は RectEditor と同じ「JS側ヒット判定」方式）──────
  // PanResponder のコールバックは初回生成なので、変化する値は ref 経由で読む（stale closure 対策）。
  const fitRef = useRef(fitParams); fitRef.current = fitParams;
  const rowRef = useRef(rowYsImg); rowRef.current = rowYsImg;
  const colRef = useRef(colXsImg); colRef.current = colXsImg;
  const imgWRef = useRef(bgResult.width); imgWRef.current = bgResult.width;
  const imgHRef = useRef(bgResult.height); imgHRef.current = bgResult.height;
  // スポイト用。rgba/許容値も PanResponder のクロージャからは stale になるため ref 経由で読む
  // （許容値は設定画面で変わるので直接参照すると初回値のまま固定されてしまう）。
  const eyedropperModeRef = useRef(eyedropperMode); eyedropperModeRef.current = eyedropperMode;
  // 連打対策。スポイト1回の再計算は重いので、反映が終わるまで次のタップは捨てる。
  // 受け付けて積むと処理が直列に溜まって固まり続ける（範囲調整側と同じ方針）。
  const eyeBusyRef = useRef(false);
  const rgbaRef = useRef(bgResult.rgba); rgbaRef.current = bgResult.rgba;
  const eyeTolRef = useRef(settings.eyedropperTolerance);
  eyeTolRef.current = settings.eyedropperTolerance;
  const featherRef = useRef(settings.featherEdges);
  featherRef.current = settings.featherEdges;
  const onEyedropRef = useRef(onEyedrop); onEyedropRef.current = onEyedrop;
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const colsRef = useRef(cols); colsRef.current = cols;
  // ジェスチャー中の状態。snapVal = 掴んだ瞬間の線の画像座標（RectEditor の snap と同じ役割）。
  const g = useRef<{ mode: 'idle' | 'drag'; axis: 'row' | 'col'; index: number; snapVal: number }>(
    { mode: 'idle', axis: 'row', index: 0, snapVal: 0 },
  );
  const HIT_PX = 18; // 線をタップ/ドラッグ開始とみなす表示座標の許容距離

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => !eyedropperModeRef.current && g.current.mode === 'drag',

      onPanResponderGrant: (evt) => {
        const fp = fitRef.current;
        if (!fp) return;
        const { scale, padX, padY } = fp;
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;

        // スポイトモード中は線のヒット判定を行わず、タップ位置の色を消して終了する。
        if (eyedropperModeRef.current) {
          const imgX = (lx - padX) / scale;
          const imgY = (ly - padY) / scale;
          const w = imgWRef.current;
          const h = imgHRef.current;
          if (imgX >= 0 && imgX < w && imgY >= 0 && imgY < h
              // 透過済みの場所は見た目が変わらない（空振り）ので再検出まで走らせない。
              && !isTransparentAt(rgbaRef.current, w, h, imgX, imgY)
              // 前のスポイトが反映され終わるまでは受け付けない（連打対策）。
              && !eyeBusyRef.current) {
            // 画像の書き換えと記録は親が行う（元画像＋操作列を親が持っているため）。
            eyeBusyRef.current = true;
            try {
              onEyedropRef.current?.(imgX, imgY, eyeTolRef.current, featherRef.current);
            } finally {
              // 例外が出ても必ず解除する（漏らすと以後スポイトが死ぬ）。
              eyeBusyRef.current = false;
            }
          }
          return;
        }

        const rys = rowRef.current;
        const cxs = colRef.current;
        // 最も近い線を探す。横線は y 距離、縦線は x 距離だけで判定（全幅/全高に貫くため）。
        let best: { axis: 'row' | 'col'; index: number; dist: number } | null = null;
        rys.forEach((y, i) => {
          const d = Math.abs(ly - (padY + y * scale));
          if (d <= HIT_PX && (!best || d < best.dist)) best = { axis: 'row', index: i, dist: d };
        });
        cxs.forEach((x, i) => {
          const d = Math.abs(lx - (padX + x * scale));
          if (d <= HIT_PX && (!best || d < best.dist)) best = { axis: 'col', index: i, dist: d };
        });
        if (best) {
          const b = best as { axis: 'row' | 'col'; index: number; dist: number };
          setSelected({ axis: b.axis, index: b.index });
          g.current.mode = 'drag';
          g.current.axis = b.axis;
          g.current.index = b.index;
          g.current.snapVal = b.axis === 'row' ? rys[b.index] : cxs[b.index];
        } else {
          // 線から離れた場所のタップは選択解除。
          setSelected(null);
          g.current.mode = 'idle';
        }
      },

      onPanResponderMove: (_, gs) => {
        if (g.current.mode !== 'drag') return;
        const fp = fitRef.current;
        if (!fp) return;
        const { scale } = fp;
        const { axis, index, snapVal } = g.current;
        if (axis === 'row') {
          // display の移動量を画像座標へ戻して初期位置に足す（RectEditor と同じ snap+delta 方式）。
          const nv = clampBetween(snapVal + gs.dy / scale, rowRef.current, index, imgHRef.current);
          setRowYsImg(prev => { const n = prev.slice(); n[index] = nv; return n; });
        } else {
          const nv = clampBetween(snapVal + gs.dx / scale, colRef.current, index, imgWRef.current);
          setColXsImg(prev => { const n = prev.slice(); n[index] = nv; return n; });
        }
      },

      onPanResponderRelease: () => { g.current.mode = 'idle'; },
      onPanResponderTerminate: () => { g.current.mode = 'idle'; },
    }),
  ).current;

  // ◀▶ / ▲▼ ボタンで選択中の線を微調整する。dir=-1 は左/上、+1 は右/下。
  // 1タップの移動量は画像サイズの約 0.5%（最低1px）。ドラッグより細かく合わせる用。
  const nudge = useCallback((dir: -1 | 1) => {
    const sel = selected;
    if (!sel) return;
    if (sel.axis === 'row') {
      const step = Math.max(1, Math.round(bgResult.height / 200));
      setRowYsImg(prev => {
        const n = prev.slice();
        n[sel.index] = clampBetween(prev[sel.index] + dir * step, prev, sel.index, bgResult.height);
        return n;
      });
    } else {
      const step = Math.max(1, Math.round(bgResult.width / 200));
      setColXsImg(prev => {
        const n = prev.slice();
        n[sel.index] = clampBetween(prev[sel.index] + dir * step, prev, sel.index, bgResult.width);
        return n;
      });
    }
  }, [selected, bgResult.width, bgResult.height]);

  // 微調整コントロールの表示/非表示は opacity のフェードだけで行う（要素の出し入れや
  // height 変更をしないことでレイアウトを固定＝白フラッシュ回避）。選択有無で 0↔1。
  const nudgeOpacity = useSharedValue(0);
  useEffect(() => {
    nudgeOpacity.value = withTiming(selected ? 1 : 0, { duration: 150 });
  }, [selected, nudgeOpacity]);
  const nudgeAnim = useAnimatedStyle(() => ({ opacity: nudgeOpacity.value }));
  // フェードアウト中(selected=null)でも直前の軸の表示を保つための参照。
  const shownAxisRef = useRef<'row' | 'col'>('col');
  if (selected) shownAxisRef.current = selected.axis;
  const shownAxis = selected?.axis ?? shownAxisRef.current;

  const header = (
    <AppHeader
      title={t('setup.title')}
      onBack={onBack}
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
    <Screen bg={IOS.bg} header={header}>
      {/* 線を選択中に、線・コントロール・ボタン以外の空き領域をタップしたら選択解除する。
          子（ボタン/プレビューの PanResponder 等）が先に responder を取るので、ここは
          それらに拾われなかった余白タップだけを受ける。選択中のみ responder を取り、
          スクロールは move で ScrollView に奪われるため邪魔しない（release=タップ時だけ解除）。*/}
      <View
        style={styles.wrap}
        onStartShouldSetResponder={() => selected != null}
        onResponderRelease={() => setSelected(null)}
      >
        {/* モードセレクタ */}
        <View style={styles.modeRow}>
          <AnimatedPressable
            style={[styles.modeBtn, mode === 'auto' && styles.modeBtnOn]}
            onPress={() => setMode('auto')}
            pressedScale={0.96}
          >
            <Text style={[styles.modeTxt, mode === 'auto' && styles.modeTxtOn]}>{t('setup.modeAuto')}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.modeBtn, mode === 'manual' && styles.modeBtnOn]}
            onPress={() => setMode('manual')}
            pressedScale={0.96}
          >
            <Text style={[styles.modeTxt, mode === 'manual' && styles.modeTxtOn]}>{t('setup.modeManual')}</Text>
          </AnimatedPressable>
        </View>

        {/* スポイト: モード切替ではなく独立トグルなので、セグメンテッドコントロールの
            外に単独の行として置く（中に入れると3等分されて文字が折り返す）。
            枠付きシートなど自動透過が内側まで届かない画像で、背景を抜いて
            行数・列数の検出に乗せるための下ごしらえ用。*/}
        {mode === 'auto' && !noSplit && (
          <View style={styles.eyeRow}>
            <AnimatedPressable
              style={[styles.eyeBtn, eyedropperMode && styles.eyeBtnOn]}
              onPress={() => setEyedropperMode(v => !v)}
              pressedScale={0.98}
            >
              <Icon
                name="colorize"
                size={18}
                color={eyedropperMode ? '#FFF' : IOS.label}
              />
              {/* ON/OFF で文字数を揃えてある。長さが変わるとボタン幅が伸縮して
                  隣のアイコンが動くため。折り返しも1行に固定して防ぐ。*/}
              <Text
                style={[styles.eyeTxt, eyedropperMode && styles.eyeTxtOn]}
                numberOfLines={1}
              >
                {eyedropperMode ? t('setup.tapToRemoveBg') : t('setup.eyedropperHint')}
              </Text>
            </AnimatedPressable>
            {/* 取り消し / やり直し / リセットは常時表示し、使えない時は非活性にする。
                アイコンは範囲を調整画面の下部バーと揃える。
                取り消しは自動背景除去まで遡れるので、押し続ければ元画像に戻る。*/}
            <AnimatedPressable
              style={[styles.eyeIconBtn, !canUndoEdit && styles.eyeIconBtnOff]}
              disabled={!canUndoEdit}
              onPress={() => onUndoEdit?.()}
              pressedScale={0.94}
            >
              <Icon name="undo" size={20} color={canUndoEdit ? IOS.label : IOS.secondary} />
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.eyeIconBtn, !canRedoEdit && styles.eyeIconBtnOff]}
              disabled={!canRedoEdit}
              onPress={() => onRedoEdit?.()}
              pressedScale={0.94}
            >
              <Icon name="redo" size={20} color={canRedoEdit ? IOS.label : IOS.secondary} />
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.eyeIconBtn, !canUndoEdit && styles.eyeIconBtnOff]}
              disabled={!canUndoEdit}
              onPress={handleResetEdits}
              pressedScale={0.94}
            >
              <Icon name="refresh" size={20} color={canUndoEdit ? IOS.label : IOS.secondary} />
            </AnimatedPressable>
          </View>
        )}

        {/* プレビュー + 分割境界線オーバーレイ（自動モードのみ線を表示）*/}
        {/* PanResponder で線のタップ選択＋ドラッグ移動を処理（自動モード時のみ意味を持つ）*/}
        {/* 外側の View は「枠の幅」を測るためだけの器。高さは中の previewBox が
            画像のアスペクト比から決めるので、ここでは高さを指定しない。*/}
        <View onLayout={handleContainerLayout}>
        <View style={[styles.previewBox, { height: dynamicPreviewHeight }]} onLayout={handleLayout} {...pan.panHandlers}>
          {/* 下地は設定「背景色」に準拠する。透過の見え方を確認する場所なので、
              保存先の一覧や範囲を調整と同じ下地で見えたほうが判断しやすい。*/}
          {viewSize && (
            <CheckerboardBg
              mode={thumbBg}
              tile={20}
              width={viewSize.width}
              height={viewSize.height}
            />
          )}
          {imageUri && (
            <Image
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          )}

          {mode === 'auto' && !noSplit && (
            <>
              {/* 横線（行境界）: 左から右へ伸びる（scaleX のみ・原点 left）*/}
              {lineYs.map((y, i) => {
                const on = selected?.axis === 'row' && selected.index === i;
                return (
                  <React.Fragment key={`h${i}`}>
                    {/* 選択中はハイライトのハロー（太い半透明帯）を線の下に敷く */}
                    {on && <Animated.View style={[styles.hHalo, { top: y - 6 }, hAnim]} pointerEvents="none" />}
                    <Animated.View style={[styles.hLineBg, { top: y - 2 }, hAnim]} pointerEvents="none" />
                    <Animated.View style={[styles.hLine, { top: y - 1, backgroundColor: on ? selColor : lineColor }, hAnim]} pointerEvents="none" />
                  </React.Fragment>
                );
              })}

              {/* 縦線（列境界: 全幅共通・画像の上端から下端まで貫く1本）: 上から下へ伸びる（scaleY のみ・原点 top）*/}
              {lineXs.map((x, i) => {
                const on = selected?.axis === 'col' && selected.index === i;
                return (
                  <React.Fragment key={`v${i}`}>
                    {on && <Animated.View style={[styles.vHalo, { left: x - 6 }, vAnim]} pointerEvents="none" />}
                    <Animated.View style={[styles.vLineBg, { left: x - 2 }, vAnim]} pointerEvents="none" />
                    <Animated.View style={[styles.vLine, { left: x - 1, backgroundColor: on ? selColor : lineColor }, vAnim]} pointerEvents="none" />
                  </React.Fragment>
                );
              })}
            </>
          )}
        </View>
        </View>

        {/* 自動モード: 行数ステッパー + 許容値スライダー */}
        {mode === 'auto' && (
          <>
            {/* カードを relative コンテナで包み、微調整コントロールをその上端に絶対配置する。
                固定高さエリアは廃止（非選択時に無駄な余白が出るため）。absolute なので
                コントロールは下の要素を一切押し下げず、非選択時はスペースを取らない。*/}
            <View style={styles.cardAnchor}>
            <Card style={styles.card}>
              <View style={styles.rowInput}>
                <Text style={[styles.rowLabel, noSplit && styles.disabledTxt]}>{t('setup.rows')}</Text>
                {/* 行数ステッパー: noSplit 時はグレーアウト＋上に Pressable を重ねてタップを横取り */}
                <View style={[styles.stepper, noSplit && styles.disabled]}>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    onPress={() => setRows(v => clamp(v - 1, 1, 20))}
                  >
                    <Text style={styles.stepTxt}>−</Text>
                  </AnimatedPressable>
                  <Text style={styles.stepVal}>{rows}</Text>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    onPress={() => setRows(v => clamp(v + 1, 1, 20))}
                  >
                    <Text style={styles.stepTxt}>+</Text>
                  </AnimatedPressable>
                  {noSplit && (
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={() => showToast(t('setup.rowsDisabled'))}
                    />
                  )}
                </View>
              </View>

              {/* 列数ステッパー（行数と同じUI・初期値は自動推定値）: noSplit 時は無効化 */}
              <Divider />
              <View style={styles.rowInput}>
                <Text style={[styles.rowLabel, noSplit && styles.disabledTxt]}>{t('setup.columns')}</Text>
                <View style={[styles.stepper, noSplit && styles.disabled]}>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    // 直接操作したら以後は自動推定を止める（スライダーで上書きしない）
                    onPress={() => { colsManualRef.current = true; setCols(v => clamp(v - 1, 1, 20)); }}
                  >
                    <Text style={styles.stepTxt}>−</Text>
                  </AnimatedPressable>
                  <Text style={styles.stepVal}>{cols}</Text>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    onPress={() => { colsManualRef.current = true; setCols(v => clamp(v + 1, 1, 20)); }}
                  >
                    <Text style={styles.stepTxt}>+</Text>
                  </AnimatedPressable>
                  {noSplit && (
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={() => showToast(t('setup.columnsDisabled'))}
                    />
                  )}
                </View>
              </View>

              {/* 分割しないチェックボックス */}
              <Divider />
              <AnimatedPressable
                style={styles.checkRow}
                onPress={() => setNoSplit(v => !v)}
                pressedScale={0.98}
              >
                <View style={[styles.checkBox, noSplit && styles.checkBoxOn]}>
                  {noSplit && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>{t('setup.noSplit')}</Text>
              </AnimatedPressable>
            </Card>

            {/* 微調整コントロール: カード上端に重なる absolute オーバーレイ（下を押し下げない）。
                表示/非表示は opacity のフェードのみ（transform/opacity だけ・height や要素の
                出し入れはしない＝白フラッシュ回避）。非選択時は pointerEvents none でタップを
                透過し下のカード操作を邪魔しない。フェードアウト中(selected=null)でも崩れない
                よう表示軸は直近選択軸(shownAxis)を使う。row なら▲▼(上下)、col なら◀▶(左右)。*/}
            {!noSplit && (
              <Animated.View
                style={[styles.nudgeBar, nudgeAnim]}
                pointerEvents={selected ? 'auto' : 'none'}
              >
                <AnimatedPressable style={styles.nudgeBtn} onPress={() => nudge(-1)} pressedScale={0.9}>
                  <Text style={styles.nudgeTxt}>{shownAxis === 'row' ? '▲' : '◀'}</Text>
                </AnimatedPressable>
                <Text style={styles.nudgeLabel}>{shownAxis === 'row' ? t('setup.moveHLine') : t('setup.moveVLine')}</Text>
                <AnimatedPressable style={styles.nudgeBtn} onPress={() => nudge(1)} pressedScale={0.9}>
                  <Text style={styles.nudgeTxt}>{shownAxis === 'row' ? '▼' : '▶'}</Text>
                </AnimatedPressable>
              </Animated.View>
            )}
            </View>
            <ToleranceSlider
              value={splitTolerance}
              onChange={setSplitTolerance}
              onComplete={final => {
                // 書き込むのは splitTolerance だけ。背景除去用の tolerance には触らない。
                void updateSettings({ splitTolerance: final });
                // 確定時にだけ列数を推定し直す。detectColCount は全画素走査なので、
                // ドラッグ中(onChange)の毎フレーム実行はコストが高すぎる。
                // 手動でステッパーを触った後(colsManualRef)は上書きしない。
                if (!colsManualRef.current) recalcCols(rows, final);
              }}
            />
          </>
        )}

        {/* 手動モード: 説明テキスト */}
        {mode === 'manual' && (
          <Card style={styles.card}>
            <Text style={styles.manualDesc}>{t('setup.manualDesc')}</Text>
            {/* 次の画面で使うツールの予告。アイコンは範囲を調整画面と共通
                （TOOL_ICONS）なので、進んだ先で迷わない。 */}
            <View style={styles.toolList}>
              <ToolRow
                icon={TOOL_ICONS.draw}
                title={t('setup.addRect')}
                desc={t('setup.addRectHint')}
              />
              <ToolRow
                icon={TOOL_ICONS.move}
                title={t('editor.modeMove')}
                desc={t('editor.modeMoveHint')}
              />
              <ToolRow
                icon={TOOL_ICONS.eyedropper}
                title={t('editor.modeEyedropper')}
                desc={t('editor.modeEyedropperHint')}
              />
            </View>
          </Card>
        )}

        <AnimatedPressable style={styles.primaryBtn} onPress={() => onConfirm(rows, cols, mode, noSplit, { rowYsImg, colXsImg })} pressedScale={0.97}>
          <Text style={styles.btnTxt}>
            {mode === 'auto'
              ? (noSplit ? t('setup.noSplitButton') : t('setup.splitWithRows'))
              : t('setup.toPolygonEditor')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.secondaryBtn} onPress={onBack} pressedScale={0.97}>
          <Text style={styles.secondaryBtnTxt}>{t('setup.rePickImage')}</Text>
        </AnimatedPressable>

        {/* トースト */}
        {toastMsg && (
          <Animated.View style={[styles.toast, toastAnim]} pointerEvents="none">
            <Text style={styles.toastTxt}>{toastMsg}</Text>
          </Animated.View>
        )}
      </View>

      {/* 元画像ズーム（分割結果と同じヘッダー挙動）*/}
      {originalImageUri ? (
        <ImageZoomModal visible={zoomVisible} uri={originalImageUri} onClose={() => setZoomVisible(false)} />
      ) : null}
    </Screen>
  );
}

/** 「範囲を調整」タブで出すツールの一覧行。次の画面で使う道具の予告。 */
function ToolRow({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <View style={styles.toolRow}>
      <View style={styles.toolIcon}>
        <Icon name={icon} size={18} color={IOS.blue} />
      </View>
      <View style={styles.toolTexts}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.toolDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  label:     '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  fill:      '#E5E5EA',
} as const;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  desc: {
    fontSize: 14,
    color: IOS.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: IOS.fill,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeBtnOn: {
    backgroundColor: IOS.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  modeTxt: {
    fontSize: 14,
    fontWeight: '500',
    color: IOS.secondary,
  },
  modeTxtOn: {
    color: IOS.label,
    fontWeight: '600',
  },
  // ── スポイトトグル（セグメンテッドコントロールの外の単独行）─────────────────
  // トグルと「戻す」を横並びにする。戻すはスポイト使用後だけ現れる。
  eyeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  eyeBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IOS.fill,
  },
  eyeIconBtn: {
    minWidth: 44,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IOS.fill,
  },
  eyeIconBtnOff: {
    opacity: 0.4,
  },
  eyeBtnOn: {
    backgroundColor: IOS.blue,
  },
  eyeTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: IOS.label,
  },
  eyeTxtOn: {
    color: '#FFF',
  },
  // ── 「範囲を調整」タブのツール一覧 ────────────────────────────────────────
  toolList: {
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toolIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTexts: { flex: 1 },
  toolTitle: { fontSize: 14, fontWeight: '600', color: IOS.label },
  toolDesc: { fontSize: 12, color: IOS.secondary, marginTop: 1 },

  manualDesc: {
    fontSize: 14,
    color: IOS.secondary,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  previewBox: {
    width: '100%',
    // height は指定しない。画像のアスペクト比から求めた値をインラインで渡す
    // （縦長シートで左右に余白が出るのを防ぐため）。
    borderRadius: 12,
    overflow: 'hidden',
  },

  // ── 検出数バッジ ──────────────────────────────────────────────────────────
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#EAF2FF',
    borderColor: '#007AFF',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },

  // ── 横線（行境界）──────────────────────────────────────────────────────────
  hLineBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    transformOrigin: 'left', // 左から右へ伸ばすためスケール原点を左端に
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    transformOrigin: 'left',
  },

  // ── 縦線（列境界: 全幅共通・プレビュー全高を貫く）──────────────────────────
  vLineBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    transformOrigin: 'top', // 上から下へ伸ばすためスケール原点を上端に
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    transformOrigin: 'top',
  },

  // ── 選択ハイライトのハロー（太い半透明帯・線の下に敷く）─────────────────────
  hHalo: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.28)',
    transformOrigin: 'left',
  },
  vHalo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.28)',
    transformOrigin: 'top',
  },

  // ── 微調整コントロール（選択中の線を◀▶/▲▼で動かす）──────────────────────
  // cardAnchor: 行数カードを包む relative コンテナ。nudgeBar の絶対配置の基準にする。
  // （幅は列レイアウトで自動 stretch。中の Card は width:100% なので見た目は変わらない）
  cardAnchor: {
    position: 'relative',
  },
  // nudgeBar: カード上端に重なる absolute オーバーレイ。alignSelf:center で水平中央寄せ。
  // top を少し負にしてカードの上辺に跨がせる。absolute なので下の要素を押し下げない。
  nudgeBar: {
    position: 'absolute',
    top: -14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  nudgeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  nudgeTxt: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  nudgeLabel: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 64,
    textAlign: 'center',
  },

  // ── カード内コントロール ───────────────────────────────────────────────────
  card: {
    width: '100%',
  },
  rowInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  rowLabel: {
    fontSize: 16,
    color: IOS.label,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: IOS.separator,
    marginVertical: 4,
  },
  disabled: {
    opacity: 0.35,
  },
  disabledTxt: {
    color: IOS.secondary,
  },

  // ── 分割しないチェックボックス ─────────────────────────────────────────────
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: IOS.separator,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IOS.card,
  },
  checkBoxOn: {
    backgroundColor: IOS.blue,
    borderColor: IOS.blue,
  },
  checkMark: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkLabel: {
    fontSize: 15,
    color: IOS.label,
  },

  // ── トースト ───────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  toastTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },

  // ── ステッパー ─────────────────────────────────────────────────────────────
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: IOS.separator,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IOS.card,
  },
  stepTxt: {
    fontSize: 22,
    color: IOS.blue,
    lineHeight: 26,
  },
  stepVal: {
    fontSize: 17,
    fontWeight: '600',
    color: IOS.label,
    minWidth: 28,
    textAlign: 'center',
  },

  // ── ボタン ────────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: IOS.blue,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  btnTxt: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnTxt: {
    color: IOS.secondary,
    fontSize: 15,
  },
});
