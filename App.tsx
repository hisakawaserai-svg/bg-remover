/**
 * App.tsx
 *
 * 2 つの分割モードを持つ。
 *   モード A「自動分割」: removeBackground → splitRowsThenCols → saveCells
 *   モード B「範囲を調整」: removeBackground → PolygonEditor（多角形描画・書き出し）
 *
 * セッション管理:
 *   各作業は StickerSession として AsyncStorage に保存し、ホームで再開できる。
 *   step: picked → keyed → done の3節目のみ記録（軽量版）。
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Screen from './src/components/ui/Screen';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './src/components/ui/AnimatedPressable';

// ── 自動分割モードで使う既存 imaging API ────────────────────────────────────
import {
  removeBackground,
  splitRowsThenCols,
  splitByBoundaries,
  splitNone,
  detectRowCount,
  detectColCount,
  cropToImage,
  trimToForeground,
  maskOutsidePolygon,
  saveSkImages,
  addMarginToImage,
  persistSourceImage,
  applyEditSteps,
  loadImagePixels,
} from './src/imaging';
import { splitConnected } from './src/imaging/splitConnected';
import type { BBox, RemoveBgResult } from './src/imaging';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import type { Cell } from './src/cellTypes';

// ── 手動モードのコンポーネント ────────────────────────────────────────────────
import PolygonEditor from './src/components/PolygonEditor';
import PreviewScreen from './src/components/PreviewScreen';
import ComplexStickerTutorialScreen from './src/components/ComplexStickerTutorialScreen';
import type { Polygon } from './src/components/PolygonEditor';

// ── サムネイル一時ファイル書き出し ────────────────────────────────────────────
import RNFS from 'react-native-fs';

// -- 画像を PNG に変換するユーティリティ関数をインポート --
import { convertToPng } from './src/imaging/convertToPng';

/**
 * Skia SkImage の PNG バイナリを一時ファイルに書き出し、file:// URI を返す。
 * ファイル名は呼び出しごとに一意にする（Date.now + random）。
 * data: URI をメモリに保持し続けると RN Image が再デコードするため、
 * ファイルパスに切り替えることで白化問題を回避する。
 */
/**
 * サムネイル専用ディレクトリ。
 * DocumentDirectory 直下は Android の MediaScanner に拾われることがあるため、
 * サブディレクトリ + .nomedia ファイルを置いてギャラリーへの混入を防ぐ。
 */
const THUMB_DIR = `${RNFS.DocumentDirectoryPath}/thumbs`;

async function ensureThumbDir(): Promise<void> {
  const exists = await RNFS.exists(THUMB_DIR);
  if (!exists) {
    await RNFS.mkdir(THUMB_DIR);
    // .nomedia: Android の MediaScanner がこのフォルダをスキャンしないようにする
    await RNFS.writeFile(`${THUMB_DIR}/.nomedia`, '', 'utf8');
  }
}

/**
 * SkImage を PNG ファイルとして thumbs/ サブディレクトリに書き出す。
 * CachesDirectory と違い再起動後も残るため、セッション復元に使える。
 * sessionId + cellIdx を渡すと決定論的なファイル名になり、上書き保存が可能。
 */
async function saveThumbToFile(img: SkImage, sessionId?: string, cellIdx?: number): Promise<string> {
  await ensureThumbDir();
  const b64 = img.encodeToBase64();
  const name = (sessionId != null && cellIdx != null)
    ? `session_${sessionId}_cell_${cellIdx}.png`
    : `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
  const path = `${THUMB_DIR}/${name}`;
  await RNFS.writeFile(path, b64, 'base64');
  return `file://${path}`;
}

// ── セッション永続化 ──────────────────────────────────────────────────────────
import {
  listSessions,
  upsertSession,
  deleteSession,
  deleteSessionFiles,
  getSession,
} from './src/session/store';
import type { StickerSession, SessionPolygon, SavedCell, EditStep } from './src/session/types';

// ── 共通 UI プリミティブ ──────────────────────────────────────────────────────
import Card           from './src/components/ui/Card';
import Chip           from './src/components/ui/Chip';
import HeaderActions  from './src/components/ui/HeaderActions';
import AppHeader      from './src/components/ui/AppHeader';
import CheckerboardBg from './src/components/ui/CheckerboardBg';
import { useThumbBg } from './src/hooks/useThumbBg';

// ── 設定画面 ──────────────────────────────────────────────────────────────────
import SettingsScreen from './src/components/SettingsScreen';
import SavedScreen    from './src/components/SavedScreen';
import HowToScreen   from './src/components/HowToScreen';
import OnboardingScreen from './src/components/OnboardingScreen';
import SetupScreen   from './src/components/SetupScreen';
import ResultScreen          from './src/components/ResultScreen';
import SaveCompleteScreen    from './src/components/SaveCompleteScreen';
import PolygonTutorialScreen from './src/components/PolygonTutorialScreen';
import LoadingView from './src/components/ui/LoadingView';
import { describeSaveError } from './src/imaging/saveErrors';
import { t, useT } from './src/i18n';
import { useSettings } from './src/settings/SettingsContext';
import { useAlbumName } from './src/settings/useAlbumName';

// ── 広告 ──────────────────────────────────────────────────────────────────────
// 置くのはホーム・保存完了・保存先の3画面だけ。SetupScreen / PolygonEditor などの
// 編集画面には置かない（キャンバスをタッチ操作するため誤タップの温床になる）。
import AdBanner from './src/ads/AdBanner';

// ── 型 ────────────────────────────────────────────────────────────────────────
type SplitMode = 'auto' | 'manual';
// idle:            初期状態（ホーム画面）
// processing:      背景除去中
// row_confirm:     自動モードで行数を確認・修正する画面（removeBackground 完了後、分割前）
// preview:         自動分割のサムネイル確認画面
// cell_editing:    自動分割の合体ブロックを PolygonEditor で手動分割中
// editing:         手動ポリゴン編集中（PolygonEditor を表示）
// polygon_preview: 手動モードの切り取りプレビュー（PreviewScreen を表示）
// settings:        設定画面
// done:            書き出し完了
type AppState = 'idle' | 'processing' | 'row_confirm' | 'preview' | 'cell_editing' | 'editing' | 'polygon_preview' | 'polygon_tutorial' | 'complex_tutorial_help' | 'polygon_tutorial_help' | 'settings' | 'saved' | 'howto' | 'done';


// DEFAULT_TOLERANCE は設定ロード前の初期値としてのみ使用。
// processImage 内では appSettings.tolerance を参照する。
const DEFAULT_TOLERANCE = 30;
const DEFAULT_ROWS = 4;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── ステップラベル ────────────────────────────────────────────────────────────
// StickerSession.step をユーザー向けテキストに変換する純粋関数
function stepLabel(step: StickerSession['step'], mode?: StickerSession['mode']): string {
  // t() は呼び出し時点の言語で解決される。この関数は描画中に呼ばれ、
  // App 側が useT() を使っているので言語切替時は描き直される。
  if (step === 'done')  return t('session.step.done');
  if (step === 'keyed') {
    if (mode === 'custom') return t('session.step.removedManual');
    if (mode === 'auto')   return t('session.step.removedAuto');
    return t('session.step.removed');
  }
  return t('session.step.picked');
}
function stepTone(step: StickerSession['step']): 'default' | 'accent' {
  return step === 'done' ? 'default' : 'accent';
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // 言語が切り替わったらこの画面ツリー全体を描き直す。
  // 下位の画面もそれぞれ useT() を呼んでいるので、個別にも更新される。
  const { t } = useT();
  // 初回保存でアルバム名を確定させる（以後は言語を変えても固定）。
  const { ensureAlbumName } = useAlbumName();
  const { width: winW, height: winH } = useWindowDimensions();
  const [splitMode, setSplitMode] = useState<SplitMode>('auto');
  const [appState,  setAppState]  = useState<AppState>('idle');
  // 設定画面を開く直前の state を退避し、閉じた時に元の画面へ戻すために使う
  const prevStateRef = useRef<AppState>('idle');
  // 使い方(howto)画面の戻り先。prevStateRef を上書きすると設定→使い方→戻る後に
  // prevStateRef が 'settings' のまま固定され、設定の「完了」が自分自身へ戻って
  // 閉じなくなるため、howto は専用 ref で戻り先を管理する。
  const howtoReturnRef = useRef<AppState>('idle');

  // 自動分割モード用
  const [rows,        setRows]        = useState(DEFAULT_ROWS);
  // confirmRows: detectRowCount で推定した行数を初期値とし、ユーザーが確認・修正する値。
  // row_confirm 画面でのみ使用。分割実行後はリセットしない（再試行時に再利用）。
  const [confirmRows, setConfirmRows] = useState(DEFAULT_ROWS);
  // cols: 確定した列数（再分割や保存で再利用）。confirmCols は detectColCount の
  // 推定値で、SetupScreen の列数ステッパー初期値として渡す（行数と同じ作り）。
  const [cols, setCols] = useState(1);
  const [confirmCols, setConfirmCols] = useState(1);
  // confirmBounds: SetupScreen で編集した分割境界線（画像座標系）。分割後に SetupScreen へ
  // 戻った時の線の初期値に使う（null なら等分割で初期化）。編集内容を画面遷移で失わないため。
  const [confirmBounds, setConfirmBounds] = useState<{ rowYsImg: number[]; colXsImg: number[] } | null>(null);
  // cells: 自動分割結果のセル一覧。auto=BBox保持, poly=マスク済みRGBA保持。
  const [cells,     setCells]     = useState<Cell[]>([]);
  // editingCellIdx: cell_editing 中に手動分割中のセルのインデックス
  const [editingCellIdx, setEditingCellIdx] = useState<number | null>(null);

  // ── 画像編集の操作列 ───────────────────────────────────────────────────────
  // 加工後の rgba は保存しない方針なので「元画像 + 操作列」を正とし、表示のたびに
  // 元画像へ順番に掛け直して現在の見た目を作る。取り消しは列を短くするだけでよく、
  // 巻き戻し用に画像を何枚も抱えずに済む。自動背景除去も列の1件として扱うので、
  // 取り消しを続ければ元画像まで戻せる。
  // upsertSession はレコードを丸ごと置き換えるため、保存箇所すべてでこの値を渡す。
  const [edits, setEdits] = useState<EditStep[]>([]);
  const editsRef = useRef<EditStep[]>([]);
  // やり直し用に取り消した操作を積む。画面内でだけ有効（保存しない）。
  const [redoSteps, setRedoSteps] = useState<EditStep[]>([]);
  const redoStepsRef = useRef<EditStep[]>([]);
  // 元画像（背景除去前）の画素。操作列を掛け直すときの基準。
  const baseRgbaRef = useRef<Uint8Array | null>(null);
  // 画像を作り直したことを子へ伝えるカウンタ（rgba は同一参照のまま中身が変わるため）。
  const [bgVersion, setBgVersion] = useState(0);

  // 手動モード用（PolygonEditor / PreviewScreen に渡す）
  const [bgResult,  setBgResult]  = useState<RemoveBgResult | null>(null);
  const bgResultRef = useRef<RemoveBgResult | null>(null);
  bgResultRef.current = bgResult;
  const [polygons,  setPolygons]  = useState<Polygon[]>([]);

  // ── ポリゴン変換ヘルパー ────────────────────────────────────────────────────
  // セッション保存形式（SessionPolygon[]）と PolygonEditor 内部形式（Polygon[]）を相互変換する。
  // 座標は両形式とも画像ピクセル基準のため変換不要。id と points の形式だけ変換する。
  const toSessionPolygons = (polys: Polygon[]): SessionPolygon[] =>
    polys.map(p => ({ id: String(p.id), points: p.points.map(([x, y]) => ({ x, y })) }));

  const fromSessionPolygons = (polys: SessionPolygon[]): Polygon[] =>
    polys.map(p => ({ id: Number(p.id), points: p.points.map(({ x, y }) => [x, y] as [number, number]) }));
  // 現在処理中の画像 URI（doAutoExport / onSave で done upsert するために保持）
  const [currentImageUri, setCurrentImageUri] = useState('');
  // 保存完了画面に渡す保存枚数
  const [savedCount, setSavedCount] = useState(0);

  // ── アプリ設定 ─────────────────────────────────────────────────────────────
  // SettingsContext から取得する。AsyncStorage のロード・保存は Context が担当。
  // App.tsx 側での useState / loadSettings / saveSettings は不要になった。
  const { settings: appSettings, loaded: settingsLoaded, updateSettings } = useSettings();
  const thumbBg = useThumbBg();

  // ── セッション管理 ─────────────────────────────────────────────────────────
  // sessions: ホーム一覧に表示するセッション配列（updatedAt 降順）
  const [sessions,          setSessions]          = useState<StickerSession[]>([]);
  // currentSessionId: 現在作業中のセッション id（画像選択〜完了まで持ち回る）
  const [currentSessionId,  setCurrentSessionId]  = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  currentSessionIdRef.current = currentSessionId;

  /**
   * 操作列を差し替えて画像を作り直す。
   * 元画像へ順番に掛け直すだけなので、追加も取り消しも同じ経路で扱える。
   * bgResult.rgba は書き出し側と共有している配列なので、参照は替えず中身を書き戻す。
   *
   * 【前提】bgResult.rgba は常に「baseRgba に editsRef.current を順に掛けた状態」。
   * 画像を読み込む経路でも applyEditSteps の直後に editsRef を更新しており、
   * この不変条件は保たれている。
   *
   * 【最適化】next が現在の操作列の「続き」なら、増えた分だけ掛ける。
   * 毎回 base に戻して全部掛け直すと、操作列の1手目が autoBg（背景除去そのもの）
   * なので、スポイトを1回押すたびに背景除去からやり直すことになり、
   * 押すほど遅くなっていた。追加は末尾に積むだけなので差分で正しく同じ結果になる。
   */
  const applyEdits = useCallback((next: EditStep[], nextRedo: EditStep[]) => {
    const base = baseRgbaRef.current;
    const bg = bgResultRef.current;
    if (base && bg) {
      const cur = editsRef.current;
      // 追加は [...cur, step] で作るので、先頭は同じ参照のまま並ぶ。
      // 参照比較で「続きかどうか」を安く判定できる。
      const isAppend = next.length >= cur.length && cur.every((s, i) => s === next[i]);

      if (isAppend) {
        // 増えた分だけ掛ける（0件なら何もしない）。
        if (next.length > cur.length) {
          applyEditSteps(bg.rgba, bg.width, bg.height, next.slice(cur.length));
        }
      } else {
        // 取り消し・リセットなど。操作は巻き戻せないので元画像から作り直す。
        bg.rgba.set(base);
        applyEditSteps(bg.rgba, bg.width, bg.height, next);
      }
      setBgVersion(v => v + 1);
    }
    editsRef.current = next;
    setEdits(next);
    redoStepsRef.current = nextRedo;
    setRedoSteps(nextRedo);

    // スポイトだけ操作して離脱する経路があるため、ここで保存する。ポリゴン操作など
    // 他の保存契機を待つと、画像編集のみの変更が保存されないまま終わってしまう。
    // 既存レコードを読んで edits だけ差し替える（upsertSession はレコードを丸ごと
    // 置き換えるので、そのまま組み立て直すとポリゴンを消しかねない）。
    const id = currentSessionIdRef.current;
    if (!id) return;
    void (async () => {
      const existing = await getSession(id);
      if (!existing) return;
      await upsertSession({ ...existing, edits: next, updatedAt: Date.now() });
    })();
  }, []);

  /** 操作を1つ追加する（スポイトなど）。追加したらやり直し履歴は捨てる。 */
  const pushEdit = useCallback((step: EditStep) => {
    applyEdits([...editsRef.current, step], []);
  }, [applyEdits]);

  const undoEdit = useCallback(() => {
    const cur = editsRef.current;
    if (cur.length === 0) return;
    applyEdits(cur.slice(0, -1), [cur[cur.length - 1], ...redoStepsRef.current]);
  }, [applyEdits]);

  const redoEdit = useCallback(() => {
    const [head, ...rest] = redoStepsRef.current;
    if (!head) return;
    applyEdits([...editsRef.current, head], rest);
  }, [applyEdits]);

  /** 元画像の状態（自動背景除去も含めて全部）まで戻す。 */
  const resetEdits = useCallback(() => {
    applyEdits([], []);
  }, [applyEdits]);


  // AsyncStorage からセッション一覧と設定を再取得（マウント時に1回）
  const reloadSessions = useCallback(async () => {
    const list = await listSessions(); // updatedAt 降順で返る
    setSessions(list);
  }, []);

  useEffect(() => {
    void reloadSessions();
    // 設定のロードは SettingsContext（index.js）側で行うため、ここでは不要。
  }, [reloadSessions]);

  // ── 権限 ───────────────────────────────────────────────────────────────────

  const requestStorage = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    if ((Platform.Version as number) >= 33) return true;
    const r = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      { title: t('permission.galleryTitle'), message: t('permission.galleryMessage'),
        buttonPositive: t('common.allow'), buttonNegative: t('common.cancel') },
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  };

  // doAutoExport の依存に入れるため useCallback で参照を安定させる。
  // 素の関数のままだと毎レンダリングで別物になり、doAutoExport も毎回作り直しになる。
  const requestSave = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const perm = (Platform.Version as number) >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    const r = await PermissionsAndroid.request(perm, {
      title: t('permission.saveTitle'), message: t('permission.saveMessage'),
      buttonPositive: t('common.allow'), buttonNegative: t('common.cancel'),
    });
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }, [t]);

  // ── 画像選択 ──────────────────────────────────────────────────────────────

  const pickImage = async () => {
    if (!await requestStorage()) {
      Alert.alert(t('permission.errorTitle'), t('permission.galleryDenied'));
      return;
    }
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 1, selectionLimit: 1 });
    if (result.didCancel || !result.assets?.[0]?.uri) return;

    const pickedUri = result.assets[0].uri;

    // PNGへ統一
    const pngUri = await convertToPng(pickedUri);

    // 画像選択直後にセッションを作成（step='picked'）
    // ここで保存しておくことで、アプリを閉じても「選んだ画像」がホーム一覧に残る
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setCurrentSessionId(id);

    // ピッカーの一時ファイル(cache)は OS に消され得るため、永続ディレクトリへコピーして
    // その URI を保存・処理に使う。これをしないと再開時に元画像が消えて無限ローディングになる。
    const uri = await persistSourceImage(pngUri, id);
    await upsertSession({ id, imageUri: uri, step: 'picked', updatedAt: Date.now() });
    void reloadSessions(); // UI を非同期で更新（processImage と並行してよい）

    setSplitMode('auto'); // 新規画像は常に自動モードからスタート
    editsRef.current = []; redoStepsRef.current = []; // 前の画像の編集を持ち越さない
    await processImage(uri);
  };

  // ── 処理（モード共通: removeBackground、その後モード別分岐）──────────────
  // overrideMode: resumeSession から呼ぶ際に保存済みモードを注入する
  // （setState は非同期のため、splitMode state は即座に反映されない）

  const processImage = async (uri: string, overrideMode?: SplitMode, resumePolygons?: Polygon[], resumeEdits?: EditStep[]) => {
    const effectiveMode = overrideMode ?? splitMode; // ← 追加: overrideMode 優先
    setAppState('processing');
    setBgResult(null);
    setCells([]);
    setEditingCellIdx(null);
    setPolygons([]); // 前画像のポリゴンを消す（手動セッション再開時は後段の resumePolygons で復元される）
    setCurrentImageUri(uri); // done upsert 時に参照する

    try {
      // removeBackground は両モード共通。
      // tolerance は設定画面で変更可能: appSettings.tolerance を使う
      // 元画像を読み込み、その画素を基準として保持してから操作列を掛ける。
      // 保存済みの操作列があればそれを、無ければ自動背景除去1件から始める。
      const result = await loadImagePixels(uri);
      baseRgbaRef.current = result.rgba.slice();
      const steps: EditStep[] = resumeEdits?.length
        ? resumeEdits
        : [{ kind: 'autoBg', tolerance: appSettings.tolerance, feather: appSettings.featherEdges }];
      applyEditSteps(result.rgba, result.width, result.height, steps);
      editsRef.current = steps;
      setEdits(steps);
      redoStepsRef.current = [];
      setRedoSteps([]);

      setBgResult(result);
      if (resumePolygons != null) {
        // 手動セッション再開: 保存済みポリゴンを復元し、編集画面へ直行する。
        // 戻る時は SetupScreen(row_confirm)経由になる(onBack参照)。
        setPolygons(resumePolygons);
        const dRows = detectRowCount(result.rgba, result.width, result.height);
        setConfirmRows(dRows);
        // 列数の初期値も推定値にセット（行数と同じく、ユーザーが確認・修正する）
        setConfirmCols(detectColCount(result.rgba, result.width, result.height, dRows));
        goToEditor('editing');
      } else {
        // 新規選択 / 自動再開: SetupScreen を経由してモードと行数を確認する。
        const dRows = detectRowCount(result.rgba, result.width, result.height);
        setConfirmRows(dRows);
        // 列数の初期値も推定値にセット（行数と同じく、ユーザーが確認・修正する）
        setConfirmCols(detectColCount(result.rgba, result.width, result.height, dRows));
        setAppState('row_confirm');
      }
    } catch (e: unknown) {
      Alert.alert(t('errors.processTitle'), e instanceof Error ? e.message : t('common.unknownError'));
      setAppState('idle');
    }
  };

  // ── 行数確認後の分割実行 ───────────────────────────────────────────────────
  // row_confirm 画面で「この行数で分割」を押した時に呼ぶ。
  // 行・列ともユーザーが指定（n 行 × c 列の等分割）する。

  const doSplit = useCallback(async (
    n: number,
    noSplit = false,
    c = 1,
    // SetupScreen で編集した境界線（画像座標系）。渡された場合はこの線でそのまま切る。
    // 未編集でも等分値がそのまま来るため、従来の等分割割りと結果は一致する（回帰なし）。
    bounds?: { rowYsImg: number[]; colXsImg: number[] },
  ) => {
    if (!bgResult) return;
    // noSplit: projection split をスキップし画像全体を1カットにする（くり抜きは共通パス）
    // c(列数)は段の横幅を c 等分する（行数 n と同じ「等分」の考え方）。
    const bboxList = noSplit
      ? splitNone(bgResult.rgba, bgResult.width, bgResult.height)
      : bounds
        ? splitByBoundaries(bgResult.rgba, bgResult.width, bgResult.height, bounds.rowYsImg, bounds.colXsImg)
        : splitRowsThenCols(bgResult.rgba, bgResult.width, bgResult.height, n, c);
    if (bboxList.length === 0) {
      Alert.alert(t('errors.resultTitle'), t('errors.noForeground'));
      return;
    }
    const newCells: Cell[] = await Promise.all(bboxList.map(async (bbox, idx) => {
      const raw = cropToImage(bgResult.rgba, bgResult.width, bbox);
      const img = addMarginToImage(raw);

      // 複数入り検出: セルのクロップ領域で splitConnected を実行し2体以上あるか確認
      const cellW = bbox.maxX - bbox.minX + 1;
      const cellH = bbox.maxY - bbox.minY + 1;
      const cellRgba = new Uint8Array(cellW * cellH * 4);
      for (let row = 0; row < cellH; row++) {
        const srcOff = ((bbox.minY + row) * bgResult.width + bbox.minX) * 4;
        cellRgba.set(bgResult.rgba.subarray(srcOff, srcOff + cellW * 4), row * cellW * 4);
      }
      const bodies = splitConnected(cellRgba, cellW, cellH);
      // 小さな装飾(星・ハート・文字など)を除外してから物体数を数える。
      // 全前景ピクセル数の BODY_MIN_RATIO 未満の成分は「装飾」とみなしカウントしない。
      const BODY_MIN_RATIO = 0.08;
      const totalArea = bodies.reduce((s, b) => s + b.area, 0);
      const mainBodies = bodies.filter(b => b.area >= totalArea * BODY_MIN_RATIO);
      const multipleObjects = mainBodies.length > 1;

      raw.dispose();
      // ファイル名は毎回ユニークにする。決定論的な同名上書きだと URI が変わらず、
      // RN Image のキャッシュが古いサムネを表示し続ける（再分割が反映されないバグ）。
      const thumbUri = await saveThumbToFile(img);
      img.dispose();
      return { kind: 'auto' as const, bbox, thumbUri, multipleObjects };
    }));
    setRows(n);
    setCols(c); // 再分割時に同じ列数指定を引き継ぐため保持
    // SetupScreen へ戻った時の初期値を実際に切った内容へ揃える。
    // bounds があればその線を、なければ等分割(=confirmBounds:null)を初期値にする。
    setConfirmRows(n);
    setConfirmCols(c);
    setConfirmBounds(noSplit ? null : (bounds ?? null));
    setCells(prev => {
      // 再分割で置き換わる旧セルのサムネを削除（ユニーク名化により上書きされないため、孤児化防止）
      for (const old of prev) {
        const filePath = old.thumbUri.startsWith('file://') ? old.thumbUri.slice(7) : old.thumbUri;
        RNFS.unlink(filePath).catch(() => {}); // 既に無い場合等は無視
      }
      return newCells;
    });
    setAppState('preview');

    // 分割完了後にセッションへカット一覧を保存（復元用）
    if (currentSessionId) {
      const savedCells: SavedCell[] = newCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
        multipleObjects: cell.kind === 'auto' ? cell.multipleObjects : undefined,
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows: n, cols: c },
        // bounds も保存し、復元後に SetupScreen へ戻っても編集した線を再現できるようにする。
        autoData: { rows: n, tolerance: appSettings.tolerance, cells: savedCells, bounds: noSplit ? undefined : bounds },
        thumbUri: newCells[0]?.thumbUri,
        updatedAt: Date.now(),
        edits: editsRef.current,
      });
      void reloadSessions();
    }
  }, [bgResult, currentSessionId, currentImageUri, appSettings.tolerance, t]);

  // ── カット合体: 選択した auto セル群を 1 枚に結合 ──────────────────────────
  // 選択セルの bbox を包含する最小矩形を元画像から切り出して新しいセルを作る。
  // poly セルは bbox を持たないため合体不可（ResultScreen 側でガード済み）。
  const handleMerge = useCallback(async (indices: number[]) => {
    if (!bgResult || indices.length < 2) return;

    const selectedCells = indices.map(i => cells[i]);
    if (selectedCells.some(c => c?.kind !== 'auto')) return;

    type AutoCell = Cell & { kind: 'auto' };
    const autoCells = selectedCells as AutoCell[];

    // 選択セルを内包する最小矩形を計算
    const minX = Math.min(...autoCells.map(c => c.bbox.minX));
    const minY = Math.min(...autoCells.map(c => c.bbox.minY));
    const maxX = Math.max(...autoCells.map(c => c.bbox.maxX));
    const maxY = Math.max(...autoCells.map(c => c.bbox.maxY));
    const unionBbox: BBox = { minX, minY, maxX, maxY, area: (maxX - minX + 1) * (maxY - minY + 1) };

    // 合体画像を生成
    const raw = cropToImage(bgResult.rgba, bgResult.width, unionBbox);
    const img = addMarginToImage(raw);
    raw.dispose();
    const thumbUri = await saveThumbToFile(img);
    img.dispose();

    const mergedCell: Cell = {
      kind: 'auto',
      bbox: unionBbox,
      thumbUri,
    };

    // 合体元セルのサムネは不要になるため削除（孤児化防止）
    for (const c of autoCells) {
      const filePath = c.thumbUri.startsWith('file://') ? c.thumbUri.slice(7) : c.thumbUri;
      try {
        if (await RNFS.exists(filePath)) {
          await RNFS.unlink(filePath);
        }
      } catch (e) {
        console.warn('[App] old thumb cleanup failed for', filePath, e);
      }
    }

    // 選択セルを除いた配列を作り、最初の選択位置(remaining 内)に merged を挿入
    const idxSet = new Set(indices);
    const firstIdx = Math.min(...indices);
    const remaining = cells.filter((_, i) => !idxSet.has(i));
    const insertAt = cells.slice(0, firstIdx).filter((_, i) => !idxSet.has(i)).length;

    const nextCells = [...remaining.slice(0, insertAt), mergedCell, ...remaining.slice(insertAt)];
    setCells(nextCells);

    // 合体後のセル一覧をセッションに保存
    if (currentSessionId) {
      const savedCells: SavedCell[] = nextCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
        multipleObjects: cell.kind === 'auto' ? cell.multipleObjects : undefined,
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows },
        autoData: { rows, tolerance: appSettings.tolerance, cells: savedCells },
        updatedAt: Date.now(),
        edits: editsRef.current,
      });
      void reloadSessions();
    }
  }, [cells, bgResult, currentSessionId, currentImageUri, appSettings.tolerance, rows]);

  // ── 合体ブロックのポリゴン分割確定 ──────────────────────────────────────────
  // PolygonEditor からポリゴンを受け取り、cells[editingCellIdx] を差し替える。
  // ポリゴン座標はセル切り出し済みのサブ画像基準（0 原点）なので座標変換不要。

  const handleCellEditConfirm = useCallback(async (polygons: Polygon[]) => {
    if (editingCellIdx === null || !bgResult) return;
    const editedCell = cells[editingCellIdx];
    if (editedCell?.kind !== 'auto') return;

    const { bbox } = editedCell;
    const subW = bbox.maxX - bbox.minX + 1;
    const subH = bbox.maxY - bbox.minY + 1;

    // 元画像からセル領域の RGBA を切り出す
    const subRgba = new Uint8Array(subW * subH * 4);
    for (let y = 0; y < subH; y++) {
      const srcOff = ((bbox.minY + y) * bgResult.width + bbox.minX) * 4;
      subRgba.set(bgResult.rgba.subarray(srcOff, srcOff + subW * 4), y * subW * 4);
    }

    // 3頂点以上のポリゴンだけを対象にマスク処理
    const validPolys = polygons.filter(p => p.points.length >= 3);
    const cellOrNulls = await Promise.all(validPolys.map(async p => {
      const masked = maskOutsidePolygon(subRgba, subW, subH, p.points);
      const tight = trimToForeground(masked, subW, 0, 0, subW, subH);
      if (!tight) return null;

      const cw = tight.maxX - tight.minX + 1;
      const ch = tight.maxY - tight.minY + 1;
      const cropped = new Uint8Array(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        const srcOff = ((tight.minY + y) * subW + tight.minX) * 4;
        cropped.set(masked.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
      }

      const data = Skia.Data.fromBytes(cropped);
      const raw = Skia.Image.MakeImage(
        { width: cw, height: ch, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
        data, cw * 4,
      );
      if (!raw) return null;
      const img = addMarginToImage(raw);
      raw.dispose();
      const thumbUri = await saveThumbToFile(img);
      img.dispose();
      return { kind: 'poly' as const, rgba: cropped, w: cw, h: ch, thumbUri };
    }));
    const newCells = cellOrNulls.filter(Boolean) as Array<{ kind: 'poly'; rgba: Uint8Array; w: number; h: number; thumbUri: string }>;

    // ポリゴンがなければ元のセルを維持してプレビューに戻る
    const replacement = newCells.length > 0 ? newCells : [editedCell];
    if (newCells.length > 0) {
      // 編集元セルのサムネは新セルに置き換わるため削除（孤児化防止）
      const filePath = editedCell.thumbUri.startsWith('file://') ? editedCell.thumbUri.slice(7) : editedCell.thumbUri;
      try {
        if (await RNFS.exists(filePath)) {
          await RNFS.unlink(filePath);
        }
      } catch (e) {
        console.warn('[App] old thumb cleanup failed for', filePath, e);
      }
    }
    const nextCells = [
      ...cells.slice(0, editingCellIdx),
      ...replacement,
      ...cells.slice(editingCellIdx + 1),
    ];
    setCells(nextCells);
    setEditingCellIdx(null);
    setAppState('preview');

    // 編集確定後のセル一覧をセッションに保存
    if (currentSessionId) {
      const savedCells: SavedCell[] = nextCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
        multipleObjects: cell.kind === 'auto' ? cell.multipleObjects : undefined,
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows },
        autoData: { rows, tolerance: appSettings.tolerance, cells: savedCells },
        updatedAt: Date.now(),
        edits: editsRef.current,
      });
      void reloadSessions();
    }
  }, [cells, editingCellIdx, bgResult, currentSessionId, currentImageUri, appSettings.tolerance, rows]);

  // ── 自動分割の書き出し ─────────────────────────────────────────────────────

  const doAutoExport = useCallback(async () => {
    if (cells.length === 0) return;
    if (!await requestSave()) {
      Alert.alert(t('permission.errorTitle'), t('permission.saveDenied'));
      return;
    }
    setAppState('processing');
    try {
      // auto/poly 両種別を SkImage に変換してから一括保存。
      // bgResult が null（復元セッション）の場合: auto セルは thumbUri から、
      // poly セルも thumbUri から読み込む（thumb は最終品質の PNG）。
      const skImages: SkImage[] = await Promise.all(cells.map(async cell => {
        if (cell.kind === 'auto') {
          if (bgResult) {
            // fresh path: マージン付与（サムネと同じ処理）
            const raw = cropToImage(bgResult.rgba, bgResult.width, cell.bbox);
            const img = addMarginToImage(raw);
            raw.dispose();
            return img;
          }
          // 復元セッション: thumbUri はサムネ生成時にマージン付与済みのためそのまま使う
          const data = await Skia.Data.fromURI(cell.thumbUri);
          return Skia.Image.MakeImageFromEncoded(data)!;
        }
        // poly セル
        if (cell.rgba && cell.rgba.length > 0 && cell.w && cell.h) {
          // in-memory: RGBA から直接生成し、マージン付与（サムネと同じ処理）
          const data = Skia.Data.fromBytes(cell.rgba);
          const raw = Skia.Image.MakeImage(
            { width: cell.w, height: cell.h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
            data, cell.w * 4,
          )!;
          const img = addMarginToImage(raw);
          raw.dispose();
          return img;
        }
        // 復元セッション or rgba なし: thumbUri はマージン付与済みのためそのまま使う
        const data = await Skia.Data.fromURI(cell.thumbUri);
        return Skia.Image.MakeImageFromEncoded(data)!;
      }));

      const { count, album } = await saveSkImages(skImages, await ensureAlbumName());
      skImages.forEach(img => img.dispose());

      // 書き出し完了 → step を 'done' に更新
      const sessionToFinish = currentSessionId
        ? await getSession(currentSessionId)
        : null;
      if (currentSessionId) {
        await upsertSession({
          id: currentSessionId,
          imageUri: currentImageUri,
          step: 'done',
          mode: 'auto',
          keyConfig: { tolerance: appSettings.tolerance, rows },
          autoData: sessionToFinish?.autoData,
          thumbUri: sessionToFinish?.thumbUri,
          updatedAt: Date.now(),
          edits: editsRef.current,
        });
        void reloadSessions();
      }

      // autoDeleteOnExport ON: エクスポート成功後にセッションと画像ファイルを削除
      if (appSettings.autoDeleteOnExport && currentSessionId && sessionToFinish) {
        await deleteSessionFiles(sessionToFinish);
        await deleteSession(currentSessionId);
        setCurrentSessionId(null);
        void reloadSessions();
      }

      setSavedCount(count);
      setAppState('done');
    } catch (e: unknown) {
      // 写真の権限が原因のことが多いので、日本語の対処手順に変換して出す。
      Alert.alert(t('errors.exportTitle'), describeSaveError(e));
      setAppState('preview');
    }
  }, [bgResult, cells, currentSessionId, currentImageUri, rows, reloadSessions, requestSave, appSettings.tolerance, appSettings.autoDeleteOnExport, ensureAlbumName, t]);

  // ── リセット ──────────────────────────────────────────────────────────────

  const reset = () => {
    setBgResult(null);
    setCells([]);
    setEditingCellIdx(null);
    setPolygons([]);
    setCurrentSessionId(null);
    setCurrentImageUri('');
    setAppState('idle');
    void reloadSessions(); // ホームに戻ったときセッション一覧を最新化
  };

  // ── セッション操作 ─────────────────────────────────────────────────────────

  // 削除確認 → deleteSession → 一覧再読み込み
  const handleDeleteSession = (id: string) => {
    Alert.alert(t('session.deleteTitle'), t('session.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          await deleteSession(id);
          await reloadSessions(); // 削除後に一覧を更新
        },
      },
    ]);
  };

  /**
   * 作業データの一括削除（設定画面から呼ばれる）。確認ダイアログは呼び出し側で出す。
   *
   * 元画像・サムネのファイルも消すので、編集中のセッションが対象に入っていると
   * そのまま作業を続けられない（「元画像が見つかりません」になる）。
   * なので削除後はホームまで戻して状態を作り直す。
   * 「スタンプ抜き」アルバムに保存済みの画像は写真アプリ側なので影響しない。
   */
  const handleDeleteAllSessions = async () => {
    try {
      const all = await listSessions();

      // 消すものが無い時に「0件削除しました」と出すのは不親切なので分ける。
      if (all.length === 0) {
        Alert.alert(t('deleteAll.title'), t('deleteAll.nothing'));
        return;
      }

      // 「一覧から消せた件数」を成功数として数える（ユーザーに見える結果と一致するため）。
      let deleted = 0;
      for (const s of all) {
        // 1件失敗しても残りの削除は続ける（途中で止めると中途半端に残る）。
        await deleteSessionFiles(s).catch(() => {});
        try {
          await deleteSession(s.id);
          deleted++;
        } catch { /* この1件は残る。件数に数えない。 */ }
      }
      await reloadSessions();
      reset(); // 編集中の状態も破棄してホームへ

      const failed = all.length - deleted;
      Alert.alert(
        t('deleteAll.doneTitle'),
        failed === 0
          ? t('deleteAll.doneCount', { count: deleted })
          : t('deleteAll.donePartial', { count: deleted, failed }),
      );
    } catch (e: unknown) {
      Alert.alert(t('deleteAll.errorTitle'), e instanceof Error ? e.message : t('common.unknownError'));
    }
  };

  // セッションの設定を復元して再処理開始
  const resumeSession = async (session: StickerSession) => {
    setCurrentSessionId(session.id);
    const latest = await getSession(session.id) ?? session;
    const mode: SplitMode = latest.mode === 'custom' ? 'manual' : 'auto';
    setSplitMode(mode);
    if (latest.keyConfig?.rows) setRows(latest.keyConfig.rows);
    if (latest.keyConfig?.cols) setCols(latest.keyConfig.cols); // 確定した列数も復元
    // SetupScreen へ戻った時の初期値も復元する（行数・列数・編集した境界線）。
    if (latest.keyConfig?.rows) setConfirmRows(latest.keyConfig.rows);
    if (latest.keyConfig?.cols) setConfirmCols(latest.keyConfig.cols);
    setConfirmBounds(latest.autoData?.bounds ?? null);

    // ── 自動モードで autoData（カット一覧）が保存済みの場合 ──────────────────
    // doSplit を再実行せず、保存済みセルを復元して ResultScreen を直接開く。
    // bgResult は編集・再分割に備えて removeBackground を再実行して取得する。
    if (mode === 'auto' && latest.autoData?.cells?.length) {
      setAppState('processing');
      setBgResult(null);
      setCells([]);
      setCurrentImageUri(latest.imageUri);
      try {
        const result = await removeBackground(
          latest.imageUri,
          latest.autoData.tolerance ?? appSettings.tolerance,
          appSettings.featherEdges,
        );
        setBgResult(result);

        // ファイルが存在するか確認し、欠損セルには 'MISSING' フラグを立てる
        const restoredCells: Cell[] = await Promise.all(
          latest.autoData.cells.map(async (savedCell) => {
            const filePath = savedCell.thumbPath.startsWith('file://')
              ? savedCell.thumbPath.slice(7)
              : savedCell.thumbPath;
            const exists = await RNFS.exists(filePath);
            const thumbUri = exists ? savedCell.thumbPath : 'MISSING';

            if (savedCell.kind === 'auto' && savedCell.bbox) {
              return { kind: 'auto' as const, bbox: savedCell.bbox, thumbUri, multipleObjects: savedCell.multipleObjects };
            }
            // poly セル: rgba なしで復元（export 時は thumbUri から再読み込み）
            return { kind: 'poly' as const, thumbUri };
          }),
        );

        setCells(restoredCells);
        setAppState('preview');
      } catch (e: unknown) {
        Alert.alert(t('errors.restoreTitle'), e instanceof Error ? e.message : t('common.unknownError'));
        setAppState('idle');
      }
      return;
    }

    // ── 手動モード再開: SetupScreen をスキップして編集画面へ直行 ───────────────
    if (mode === 'manual') {
      setAppState('processing');
      setBgResult(null);
      setCurrentImageUri(latest.imageUri);
      try {
        const result = await loadImagePixels(latest.imageUri);
        baseRgbaRef.current = result.rgba.slice();
        const steps: EditStep[] = latest.edits?.length
          ? latest.edits
          : [{ kind: 'autoBg', tolerance: appSettings.tolerance, feather: appSettings.featherEdges }];
        applyEditSteps(result.rgba, result.width, result.height, steps);
        editsRef.current = steps;
        setEdits(steps);
        redoStepsRef.current = [];
        setRedoSteps([]);
        setBgResult(result);
        // keyConfig に保存済みの行数/列数があれば復元済みの値を優先し、
        // 自動検出で上書きしない。保存値が無い場合のみ自動検出する。
        if (latest.keyConfig?.rows == null || latest.keyConfig?.cols == null) {
          const dRows = detectRowCount(result.rgba, result.width, result.height);
          setConfirmRows(dRows);
          setConfirmCols(detectColCount(result.rgba, result.width, result.height, dRows));
        }
        setPolygons(latest.polygons?.length ? fromSessionPolygons(latest.polygons) : []);
        goToEditor('editing');
      } catch (e: unknown) {
        Alert.alert(t('errors.restoreTitle'), e instanceof Error ? e.message : t('common.unknownError'));
        setAppState('idle');
      }
      return;
    }

    // ── 自動モード・autoData なし: processImage 経由で SetupScreen を表示 ──
    await processImage(latest.imageUri, mode, undefined, latest.edits);
  };

  // ── 派生値: 進捗集計 ─────────────────────────────────────────────────────
  // ホームの進捗カードに使う。step 別カウント。
  // 'done' 以外はすべて「作業中」とみなす（picked も keyed も未完了扱い）
  const inProgressCount = sessions.filter(s => s.step !== 'done').length;
  const doneCount       = sessions.filter(s => s.step === 'done').length;

  // 3段階ゲージ用: 作業中セッションの中で最も新しいものの step を参照する。
  // sessions は updatedAt 降順なので find で先頭一致すれば最新になる。
  // step → 塗り本数: picked=1, keyed=2, done=3（全バー点灯は「作業中 done」では起こらないが念のため対応）
  const latestInProgress = sessions.find(s => s.step !== 'done') ?? null;
  const gaugeLevel: 0 | 1 | 2 | 3 =
    latestInProgress == null     ? 0
    : latestInProgress.step === 'picked' ? 1
    : latestInProgress.step === 'keyed'  ? 2
    : 3; // 'done' セッションが作業中として残ることはほぼ無いが安全側で 3

  // ── レンダー ──────────────────────────────────────────────────────────────

  const isBusy = appState === 'processing';

  // ── ポリゴン編集への遷移: 先にローディングを出してからマウントする ──────────
  //
  // PolygonEditor はマウント時に SkImage の生成と splitConnected(全画素の連結成分
  // 走査)を同期で回すため、画像が大きいと JS スレッドが数百ms〜数秒止まる。
  // setAppState('editing') を直に呼ぶと、その重い処理が終わるまで前の画面が
  // 表示されたまま固まって見える（タップが効いていないように見える）。
  //
  // そこで「ローディング画面を描く」→「1〜2フレーム待つ」→「エディタをマウント」
  // の順にする。待たずにマウントすると、ローディングの描画がコミットされる前に
  // 重い処理が始まってしまい、結局ローディングが見えないまま固まる。
  const [pendingEditor, setPendingEditor] =
    useState<{ target: 'editing' | 'cell_editing'; cellIdx?: number } | null>(null);

  /** ポリゴン編集へ移る唯一の入口。直接 setAppState('editing') は使わない。 */
  const goToEditor = useCallback((target: 'editing' | 'cell_editing', cellIdx?: number) => {
    setPendingEditor({ target, cellIdx });
  }, []);

  /**
   * 設定・保存先・使い方など「かぶせた画面」から元の画面へ戻る。
   * 戻り先がポリゴン編集だと PolygonEditor が作り直されて同じように固まるので、
   * その場合だけ goToEditor を通してローディングを挟む。
   * (cell_editing の場合 editingCellIdx は state に残っているので渡し直さなくてよい)
   */
  const backToPrev = useCallback((prev: AppState) => {
    if (prev === 'editing' || prev === 'cell_editing') goToEditor(prev);
    else setAppState(prev);
  }, [goToEditor]);

  useEffect(() => {
    if (!pendingEditor) return;
    let cancelled = false;
    // 2フレーム待つ: 1フレームだと端末によってはローディングが出る前に
    // 重い処理へ入ってしまうため、確実に描画をコミットさせる。
    const outer = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (pendingEditor.cellIdx != null) setEditingCellIdx(pendingEditor.cellIdx);
        setAppState(pendingEditor.target);
        setPendingEditor(null);
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(outer); };
  }, [pendingEditor]);

  // 現在の state を退避してから設定画面へ遷移するヘルパー。
  // 設定を閉じた時に prevStateRef.current へ戻すことで、どの画面からでも元に戻れる。
  const goToSettings = useCallback(() => {
    prevStateRef.current = appState;
    setAppState('settings');
  }, [appState]);

  // 保存先画面も同様に prevStateRef を使い、どの画面からでも元に戻れるようにする。
  const goToSaved = useCallback(() => {
    prevStateRef.current = appState;
    setAppState('saved');
  }, [appState]);

  // ── ポリゴン編集の準備中 ────────────────────────────────────────────────
  // 他のどの画面より先に判定する。ここで返さないと前の画面が描かれ続けて、
  // ローディングを挟んだ意味がなくなる。
  if (pendingEditor) {
    return (
      <>
        <StatusBar hidden />
        <LoadingView message={t('loading.editorTitle')} sub={t('loading.editorSub')} />
      </>
    );
  }

  // ── 設定画面: 全画面で SettingsScreen を表示 ────────────────────────────
  if (appState === 'settings') {
    return (
      <SettingsScreen
        onClose={() => backToPrev(prevStateRef.current)}
        onDeleteAllData={handleDeleteAllSessions}
        onHowTo={() => {
          // 設定→使い方→戻るで設定に戻れるよう、howto 専用 ref に戻り先を保存。
          // prevStateRef は設定自身の戻り先なので上書きしない。
          howtoReturnRef.current = 'settings';
          setAppState('howto');
        }}
      />
    );
  }

  // ── 保存先画面: アルバムのグリッド表示 ──────────────────────────────────
  if (appState === 'saved') {
    return (
      <SavedScreen
        onClose={() => backToPrev(prevStateRef.current)}
      />
    );
  }

  if (appState === 'polygon_tutorial') {
    return (
      <PolygonTutorialScreen
        onStart={() => goToEditor('editing')}
        onBack={() => setAppState('row_confirm')}
      />
    );
  }

  if (appState === 'howto') {
    return (
      <HowToScreen
        onClose={() => backToPrev(howtoReturnRef.current)}
        onPolygonTutorial={() => setAppState('polygon_tutorial_help')}
        onComplexTutorial={() => setAppState('complex_tutorial_help')}
      />
    );
  }

  // 初回起動ゲート: 設定ロード完了後、未オンボなら自動でオンボーディングを表示。
  // settingsLoaded を待つのは、ロード中は appSettings が DEFAULTS(false) のため
  // 既存ユーザーにも一瞬オンボが出てしまうのを防ぐため。
  // skipPolygonTutorial の分岐（[App.tsx]）と同じ書き味で、永続フラグで一度きり表示する。
  if (appState === 'idle' && settingsLoaded && !appSettings.hasSeenOnboarding) {
    return (
      <OnboardingScreen
        // 「はじめる」(最終ステップ)タップで初回フラグを永続化 → 以後は出ない。
        // 書き込みは onComplete の1回だけ(スキップ/離脱では書かない)。
        // フラグ=true で本ゲート条件が false になり、通常ホーム(idle)へ自動遷移する。
        onComplete={() => void updateSettings({ hasSeenOnboarding: true })}
      />
    );
  }

  if (appState === 'polygon_tutorial_help') {
    return (
      <PolygonTutorialScreen
        mode="help"
        // polygon_tutorial_help は 使い方(howto) の子画面。ここから howto へ戻るだけで、
        // howto 自身の戻り先(howtoReturnRef=設定 など)は書き換えない。
        // 書き換えると howto の「戻る」が tutorial へループしてしまう。
        onStart={() => setAppState('howto')}
        onBack={() => setAppState('howto')}
      />
    );
  }

  if (appState === 'complex_tutorial_help') {
    return (
      <ComplexStickerTutorialScreen
        onClose={() => setAppState('howto')}
      />
    );
  }

  // ── 行数確認画面（自動モード: removeBackground 完了後・分割前）──────────
  if (appState === 'row_confirm' && bgResult) {
    return (
      <SetupScreen
        bgResult={bgResult}
        initialRows={confirmRows}
        initialCols={confirmCols}
        initialBounds={confirmBounds}
        initialMode={splitMode}
        onEyedrop={(x, y, tolerance, feather) => pushEdit({ kind: 'eyedrop', x, y, tolerance, feather })}
        onUndoEdit={undoEdit}
        onRedoEdit={redoEdit}
        onResetEdits={resetEdits}
        canUndoEdit={edits.length > 0}
        canRedoEdit={redoSteps.length > 0}
        bgVersion={bgVersion}
        onConfirm={(rows, cols, mode, noSplit, bounds) => {
          setSplitMode(mode);
          if (mode === 'auto') {
            doSplit(rows, noSplit, cols, bounds);
          } else {
            if (appSettings.skipPolygonTutorial) goToEditor('editing');
            else setAppState('polygon_tutorial');
          }
        }}
        // ホームへ戻る際は reset() を使う。setAppState('idle') 直行だと
        // sessions 一覧が再読込されず、手動編集で mode:'custom' に変えても
        // カードのラベルが「透過済み（自動）」のまま残る（在庫の stale 表示）。
        onBack={reset}
        onSettings={goToSettings}
        onHome={reset}
        originalImageUri={currentImageUri}
      />
    );
  }

  // ── 自動分割結果確認画面 ────────────────────────────────────────────────────
  if (appState === 'preview' && splitMode === 'auto') {
    return (
      <ResultScreen
        cells={cells}
        originalImageUri={currentImageUri}
        srcWidth={bgResult?.width ?? null}
        srcHeight={bgResult?.height ?? null}
        // 復元セッション（bgResult=null）の場合は row_confirm に戻れない → ホームへ
        onBack={() => bgResult ? setAppState('row_confirm') : reset()}
        onHome={reset}
        onSettings={() => goToSettings()}
        onSave={doAutoExport}
        // リセット: 確定時の行数・列数・境界線で分割し直し、合体やカット編集を破棄して初期状態へ戻す
        onReSplit={() => doSplit(rows, false, cols, confirmBounds ?? undefined)}
        // どちらも PolygonEditor へ入るので goToEditor 経由（ローディングを挟む）
        onManualSplit={() => goToEditor('editing')}
        onEditCell={(i) => {
          // poly セル（セッション復元 or 編集済み）はセル編集不可
          if (cells[i]?.kind !== 'auto') return;
          goToEditor('cell_editing', i);
        }}
        onMerge={handleMerge}
      />
    );
  }

  // ── 合体ブロック手動分割: セル切り出し画像を PolygonEditor に渡して編集 ──
  if (appState === 'cell_editing' && bgResult && editingCellIdx !== null) {
    const editedCell = cells[editingCellIdx];
    if (editedCell?.kind === 'auto') {
      const { bbox } = editedCell;
      const subW = bbox.maxX - bbox.minX + 1;
      const subH = bbox.maxY - bbox.minY + 1;
      const subRgba = new Uint8Array(subW * subH * 4);
      for (let y = 0; y < subH; y++) {
        const srcOff = ((bbox.minY + y) * bgResult.width + bbox.minX) * 4;
        subRgba.set(bgResult.rgba.subarray(srcOff, srcOff + subW * 4), y * subW * 4);
      }
      const subBgResult: RemoveBgResult = { rgba: subRgba, width: subW, height: subH };
      return (
        <>
          <StatusBar hidden />
          <PolygonEditor
            bgResult={subBgResult}
            displayW={winW}
            displayH={winH}
            onPreview={handleCellEditConfirm}
            onBack={() => {
              setEditingCellIdx(null);
              setAppState('preview');
            }}
            onSettings={() => goToSettings()}
          />
        </>
      );
    }
  }

  // ── 手動編集中: PolygonEditor を全画面表示 ──────────────────────────────
  if (appState === 'editing' && bgResult) {
    return (
      // SafeArea は PolygonEditor 内の Screen が担当するため不要。
      <>
        <StatusBar hidden />
        <PolygonEditor
          bgResult={bgResult}
          displayW={winW}
          displayH={winH}
          onHome={reset}
          originalImageUri={currentImageUri}
          // セッション復元時: polygons が空でなければ initialPolygons として渡す。
          // 座標は画像ピクセル基準なのでそのまま渡せる（変換不要）。
          initialPolygons={polygons.length > 0 ? polygons : undefined}
          onEyedrop={(x, y, tolerance, feather) => pushEdit({ kind: 'eyedrop', x, y, tolerance, feather })}
          onUndoEdit={undoEdit}
          onRedoEdit={redoEdit}
          onResetEdits={resetEdits}
          canUndoEdit={edits.length > 0}
          canRedoEdit={redoSteps.length > 0}
          bgVersion={bgVersion}
          // 確定操作ごとにポリゴンをセッションに保存。
          // プレビュー押下を待たず、頂点追加・削除・ドラッグ終了の都度 upsert する。
          // 毎フレームではなく「操作確定時のみ」発火するため頻度は低い（PolygonEditor 側で制御）。
          // step は 'keyed' 固定: 編集中は常に再開可能状態として保存する。
          onPolygonsChange={polys => {
            if (!currentSessionId) return;
            void upsertSession({
              id:        currentSessionId,
              imageUri:  currentImageUri,
              step:      'keyed',
              mode:      'custom',
              keyConfig: { tolerance: appSettings.tolerance },
              polygons:  toSessionPolygons(polys),
              updatedAt: Date.now(),
              edits: editsRef.current,
            });
          }}
          onPreview={polys => {
            setPolygons(polys);
            // プレビュー遷移のタイミングでポリゴンを session に保存する。
            // 書き出し前に中断しても「どこまで確定したか」を復元できる。
            if (currentSessionId) {
              void upsertSession({
                id:         currentSessionId,
                imageUri:   currentImageUri,
                step:       'keyed',
                mode:       'custom',
                keyConfig:  { tolerance: appSettings.tolerance },
                polygons:   toSessionPolygons(polys),
                updatedAt:  Date.now(),
                edits:      editsRef.current,
              });
            }
            setAppState('polygon_preview');
          }}
          onBack={currentPolys => {
            // 離脱時に最終状態を確定保存する。
            // onPolygonsChange の自動保存は操作ごとに void で投げっぱなしのため、
            // 最後の操作後すぐ戻ると未保存のまま抜ける可能性がある。
            // ここで現在の polygons を upsertSession することでその隙間を塞ぐ。
            // 既存の自動保存と重複しても upsert は冪等なので安全。
            if (currentSessionId) {
              void upsertSession({
                id:        currentSessionId,
                imageUri:  currentImageUri,
                step:      'keyed',
                mode:      'custom',
                keyConfig: { tolerance: appSettings.tolerance },
                polygons:  toSessionPolygons(currentPolys),
                updatedAt: Date.now(),
                edits: editsRef.current,
              });
            }
            // bgResult が残っていれば SetupScreen に戻る。なければホームへ。
            setAppState(bgResult ? 'row_confirm' : 'idle');
          }}
          onSettings={() => goToSettings()}
        />
      </>
    );
  }

  // ── 切り取りプレビュー: PreviewScreen を全画面表示 ──────────────────────
  if (appState === 'polygon_preview' && bgResult) {
    return (
      // SafeArea は PreviewScreen 内の Screen が担当するため不要。
      <>
        <StatusBar hidden />
        <PreviewScreen
          bgResult={bgResult}
          polygons={polygons}
          onBack={() => goToEditor('editing')}
          onRequestSave={requestSave}
          onSave={async (count: number) => {
            // 手動書き出し完了 → step を 'done' に更新。
            // polygons を明示的に保持することで、書き出し後も「1個だけ修正して再書き出し」
            // できるよう頂点を残す。done セッションを再開しても復元できる。
            if (currentSessionId) {
              await upsertSession({
                id: currentSessionId,
                imageUri: currentImageUri,
                step: 'done',
                mode: 'custom',
                keyConfig: { tolerance: DEFAULT_TOLERANCE },
                polygons: toSessionPolygons(polygons),
                updatedAt: Date.now(),
                edits: editsRef.current,
              });
              // autoDeleteOnExport ON: 自動モード(doAutoExport)と同様、手動書き出しも
              // 完了後にセッション（画像ファイル含む）を削除する。これを入れないと
              // 設定 ON でも custom セッションだけホームに残り続ける不整合になる。
              if (appSettings.autoDeleteOnExport) {
                await deleteSession(currentSessionId);
                setCurrentSessionId(null);
              }
              void reloadSessions();
            }
            setSavedCount(count);
            setAppState('done');
          }}
        />
      </>
    );
  }

  // ── 保存完了画面 ─────────────────────────────────────────────────────────────
  if (appState === 'done') {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor={IOS.bg} />
        <SaveCompleteScreen
          savedCount={savedCount}
          onNewImage={pickImage}
          onSaved={goToSaved}
          onHome={reset}
          onSettings={goToSettings}
        />
      </>
    );
  }

  const homeHeader = (
    <AppHeader
      title={t('app.name')}
      right={
        <View style={styles.navActions}>
          <AnimatedPressable
            onPress={goToSaved}
            style={styles.navBtn}
          >
            <Icon name="photo-album" size={24} color={IOS.blue} />
          </AnimatedPressable>
          <HeaderActions
            showSettings
            onSettings={() => goToSettings()}
          />
        </View>
      }
    />
  );

  return (
    // Screen が SafeArea・ScrollView を一括担当する。
    // 各画面固有の SafeAreaView / paddingTop は Screen 側で吸収済み。
    <Screen
      style={styles.container}
      header={appState === 'idle' ? homeHeader : undefined}
      footer={
        <>
          {appState === 'idle' && (
            // 主ボタンを上、広告を最下部に置く。逆にすると広告が本来の
            // アンカー位置（画面最下部）から外れ、CTA も遠くなる。
            <AnimatedPressable
              style={styles.startBtn}
              onPress={pickImage}
              disabled={isBusy}
              pressedScale={0.97}
            >
              <Icon name="add-photo-alternate" size={22} color="#FFF" />
              <Text style={styles.startBtnTxt}>
                {sessions.length === 0 ? t('home.pickImage') : t('home.newImage')}
              </Text>
            </AnimatedPressable>
          )}

          {/* 高さを外から固定しないこと。ホームだけ小さくなり他画面と不揃いになる。
              区切り線は AdBanner 自身が持っているので Divider も重ねない。 */}
          <AdBanner />
        </>
      }
    >

        {/* ════════════════════════════════════════════════
            HOME 画面（idle 時のみ）
        ════════════════════════════════════════════════ */}
        {appState === 'idle' && (
          <>
            {/* ── 進捗サマリーカード: セッションがあるときだけ表示 ── */}
            {sessions.length > 0 && (
              <Card style={styles.progressCard}>
                {/* カードタイトル */}
                <Text style={styles.progressTitle}>{t('home.progressTitle')}</Text>

                {/* 大きい数値行: 左=作業中、右=完了 */}
                <View style={styles.progressStats}>
                  {/* 作業中 */}
                  <View style={styles.progressStat}>
                    <Text style={styles.progressStatNum}>{inProgressCount}</Text>
                    <Text style={styles.progressStatLabel}>{t('home.inProgress')}</Text>
                  </View>
                  {/* 縦の区切り線 */}
                  <View style={styles.progressDivider} />
                  {/* 完了 */}
                  <View style={styles.progressStat}>
                    <Text style={[styles.progressStatNum, styles.progressStatNumDone]}>
                      {doneCount}
                    </Text>
                    <Text style={styles.progressStatLabel}>{t('common.done')}</Text>
                  </View>
                </View>

                {/* ── 最新の作業 ─────────────────────────────────────────
                    下のゲージは「全件の集計」ではなく最新の未完了セッション1件の
                    進み具合を示す。上の「作業中 N / 完了 M」と母数が違って
                    紛らわしいので、どの作業のことなのか見出しとサムネで示す。*/}
                {latestInProgress && (
                  <View style={styles.latestRow}>
                    <View style={styles.latestThumb}>
                      <CheckerboardBg mode={thumbBg} tile={8} width={40} height={40} />
                      <Image
                        source={{ uri: latestInProgress.thumbUri ?? latestInProgress.imageUri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.latestTexts}>
                      <Text style={styles.latestCaption}>{t('home.latestWork')}</Text>
                      <Text style={styles.latestStep} numberOfLines={1}>
                        {stepLabel(latestInProgress.step, latestInProgress.mode)}
                      </Text>
                    </View>
                  </View>
                )}

                {/* 3段階ゲージ: 常に3本表示。塗りは gaugeLevel (0=全空) で決まる。
                    見ているのは上の「最新の作業」1件ぶん。 */}
                <View style={styles.gaugeRow}>
                  <View style={[styles.gaugeBar, gaugeLevel >= 1 && styles.gaugeBarFilled]} />
                  <View style={[styles.gaugeBar, gaugeLevel >= 2 && styles.gaugeBarFilled]} />
                  <View style={[styles.gaugeBar, gaugeLevel >= 3 && styles.gaugeBarFilled]} />
                </View>
                <View style={styles.gaugeLabelRow}>
                  <Text style={styles.gaugeLabel}>{t('home.gauge.select')}</Text>
                  <Text style={styles.gaugeLabel}>{t('home.gauge.transparent')}</Text>
                  <Text style={styles.gaugeLabel}>{t('home.gauge.export')}</Text>
                </View>
              </Card>
            )}

            {/* ── 空状態: 機能説明＋CTA ── */}
            {sessions.length === 0 && (
              <View style={styles.emptyContent}>
                {/* アイコン円背景 */}
                <View style={styles.emptyIconWrap}>
                  <Icon name="auto-fix-high" size={44} color={IOS.blue} />
                </View>
                <Text style={styles.emptyContentTitle}>
                  {t('home.tagline')}
                </Text>
                <Text style={styles.emptyContentDesc}>
                  {t('home.emptyDesc')}
                </Text>
                <View style={styles.emptyHints}>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle" size={16} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>{t('home.features.formats')}</Text>
                  </View>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle" size={16} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>{t('home.features.autoRemove')}</Text>
                  </View>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle" size={16} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>{t('home.features.savePng')}</Text>
                  </View>
                </View>
              </View>
            )}

            {sessions.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{t('home.recentWork')}</Text>
                {sessions.map((session, idx) => {
                  const d = new Date(session.updatedAt);
                  const dateStr = `${d.getMonth() + 1}/${d.getDate()} `
                    + `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

                  // カット枚数ラベル
                  // autoData.cells (自動分割) → polygons (手動/custom) の順でカット数を拾う。
                  // どちらも無ければ未処理(cellCount=null)として扱う。
                  const cellCount = session.autoData?.cells.length ?? session.polygons?.length;
                  const sheetLabel = cellCount != null
                    ? t('home.sheetOf', { count: cellCount })
                    : t('home.unprocessedSheet');

                  // step → 1/2/3 本バー
                  const barLevel =
                    session.step === 'picked' ? 1
                    : session.step === 'keyed' ? 2
                    : 3;

                  const isFirst = idx === 0;

                  return (
                    <AnimatedPressable
                      key={session.id}
                      style={[styles.sessionCard, isFirst && styles.sessionCardFirst]}
                      onPress={() => void resumeSession(session)}
                      pressedScale={0.97}
                    >
                      {/* サムネ */}
                      <View style={styles.sessionCardThumb}>
                        <CheckerboardBg mode={thumbBg} tile={10} width={60} height={60} />
                        <Image
                          source={{ uri: session.thumbUri ?? session.imageUri }}
                          style={StyleSheet.absoluteFill}
                          resizeMode="contain"
                        />
                      </View>

                      {/* 情報エリア */}
                      <View style={styles.sessionCardInfo}>
                        {/* 上段: ラベル + チップ */}
                        <View style={styles.sessionCardTop}>
                          {/* 英語はタイトルが長い（例: Unprocessed sheet）。1行固定だと
                              アクティブ枠のぶん幅が狭い先頭行で必ず省略されるので、
                              2行まで許容する。行の高さはサムネ(60px)で決まっており
                              2行でも収まるためレイアウトは崩れない。 */}
                          <Text style={styles.sessionCardLabel} numberOfLines={2}>{sheetLabel}</Text>
                          <Chip label={stepLabel(session.step, session.mode)} tone={stepTone(session.step)} />
                        </View>

                        {/* 下段: 進捗バー + 日時 */}
                        <View style={styles.sessionCardBottom}>
                          <View style={styles.sessionCardGaugeRow}>
                            <View style={[styles.sessionCardBar, barLevel >= 1 && styles.sessionCardBarFilled]} />
                            <View style={[styles.sessionCardBar, barLevel >= 2 && styles.sessionCardBarFilled]} />
                            <View style={[styles.sessionCardBar, barLevel >= 3 && styles.sessionCardBarFilled]} />
                          </View>
                          <Text style={styles.sessionCardDate}>{dateStr}</Text>
                        </View>
                      </View>

                      {/* 削除ボタン */}
                      <AnimatedPressable
                        style={styles.sessionDeleteBtn}
                        onPress={() => handleDeleteSession(session.id)}
                      >
                        <Icon name="delete-outline" size={20} color={IOS.secondary} />
                      </AnimatedPressable>
                    </AnimatedPressable>
                  );
                })}
              </>
            )}

          </>
        )}

        {/* ── ローディングスピナー ── */}
        {isBusy && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={IOS.blue} />
            <Text style={styles.loadingTxt}>{t('home.processing')}</Text>
          </View>
        )}

    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  green:     '#34C759',
  red:       '#FF3B30',
  label:     '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  fill:      '#E5E5EA',
} as const;

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: IOS.bg,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },

  navActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn:     { padding: 6 },

  // ── HOME: 進捗カード ─────────────────────────────────────────────────────────
  progressCard: {
    width: '100%',
    marginBottom: 16, // カード間を均一に（spacing.md=12〜16 相当）
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: IOS.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  // 大きい数値行: 左右に「作業中 N」「完了 N」を並べる
  progressStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  progressStatNum: {
    fontSize: 32,          // 数値を大きく見せて「密度」と達成感を演出
    fontWeight: '700',
    color: IOS.blue,
    lineHeight: 36,
  },
  progressStatNumDone: {
    color: IOS.label,      // 完了はグレー系（accentより落ち着いた色で差別化）
  },
  progressStatLabel: {
    fontSize: 12,
    color: IOS.secondary,
    fontWeight: '400',
  },
  progressDivider: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    backgroundColor: IOS.separator,
    marginHorizontal: 8,
  },

  // 3段階ゲージ: 最新の作業中セッションの step を3本バーで可視化
  // バー間に2pxの隙間を gap で入れ、角丸で柔らかく見せる
  // ── 最新の作業（ゲージの対象を示す行）──────────────────────────────────────
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  latestThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: IOS.card,
  },
  latestTexts: { flex: 1 },
  latestCaption: {
    fontSize: 11,
    color: IOS.secondary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  latestStep: {
    fontSize: 14,
    color: IOS.label,
    fontWeight: '600',
    marginTop: 1,
  },

  gaugeRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  gaugeBar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: IOS.fill, // 未到達: ライトグレー
  },
  gaugeBarFilled: {
    backgroundColor: IOS.blue, // 到達済み: #007AFF
  },

  // ゲージ下のフェーズラベル行
  gaugeLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gaugeLabel: {
    flex: 1,
    fontSize: 10,
    color: IOS.secondary,
    textAlign: 'center',
  },
  progressEmptyHint: {
    marginTop: 12,
    fontSize: 13,
    color: IOS.secondary,
    textAlign: 'center',
  },

  // ── HOME: セクションラベル ─────────────────────────────────────────────────────
  // カード間・セクション間の統一余白は marginBottom で sectionLabel 自身が担う。
  // 直値 16px ≒ spacing.lg（theme.ts の spacing トークンと同値）
  sectionLabel: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    color: IOS.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,    // 前のカードとの間隔（最初のラベルには不要だが許容範囲）
    marginBottom: 8,
    paddingLeft: 4,
  },

  // ── HOME: セッションカード ─────────────────────────────────────────────────
  sessionCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: IOS.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  // 最新セッション: 左端に青のアクセントボーダー
  sessionCardFirst: {
    borderLeftWidth: 3,
    borderLeftColor: IOS.blue,
    paddingLeft: 10, // ボーダー分を補正
  },
  sessionCardThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sessionCardInfo: {
    flex: 1,
    gap: 6,
  },
  sessionCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionCardLabel: {
    // flexGrow/flexBasis を分けて指定する。flex:1 だと flexBasis:0 になり、
    // 内容の長さに関係なくチップと機械的に領域を分け合うため、英語では
    // タイトルが「Unprocessed sh…」のように早々に省略されていた。
    // flexBasis:'auto' にすると文字数に応じた幅を先に確保できる。
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    fontSize: 14,
    fontWeight: '600',
    color: IOS.label,
  },
  sessionCardBottom: {
    gap: 4,
  },
  sessionCardGaugeRow: {
    flexDirection: 'row',
    gap: 3,
  },
  sessionCardBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: IOS.fill,
  },
  sessionCardBarFilled: {
    backgroundColor: IOS.blue,
  },
  sessionCardDate: {
    fontSize: 11,
    color: IOS.secondary,
  },
  sessionDeleteBtn: {
    padding: 4,
  },

  // ── HOME: セッションなし 空状態コンテンツ ────────────────────────────────
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#EAF2FF', // blue 薄め
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyContentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: IOS.label,
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  emptyContentDesc: {
    fontSize: 14,
    color: IOS.secondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyHints: {
    marginTop: 8,
    gap: 6,
    alignSelf: 'stretch',
    paddingHorizontal: 16,
  },
  emptyHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyHintTxt: {
    fontSize: 13,
    color: IOS.secondary,
  },

  // ── HOME: メインボタン（footer に固定） ────────────────────────────────
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: IOS.blue,
    paddingVertical: 16,
    borderRadius: 14,
  },
  startBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },

  // ── モード選択（done 画面） ──────────────────────────────────────────────────
  modeRow: {
    flexDirection: 'row', marginBottom: 24,
    backgroundColor: IOS.fill,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 0.5, borderColor: IOS.separator,
    padding: 2, gap: 2, width: '100%',
  },
  modeBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 10, backgroundColor: 'transparent',
  },
  modeBtnOn: { backgroundColor: IOS.card },
  modeTxt:   { fontSize: 14, fontWeight: '400', color: IOS.secondary },
  modeTxtOn: { fontWeight: '600', color: IOS.label },

  // ── 行数ステッパー ──────────────────────────────────────────────────────────
  rowInput: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 16 },
  rowLabel: { fontSize: 15, fontWeight: '400', color: IOS.label },
  stepper:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 36, height: 36, borderRadius: 12,
    borderWidth: 0.5, borderColor: IOS.separator,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: IOS.card,
  },
  stepTxt: { fontSize: 22, color: IOS.blue, lineHeight: 26 },
  stepVal: { fontSize: 17, fontWeight: '600', color: IOS.label, minWidth: 28, textAlign: 'center' },

  // ── ボタン共通 ──────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: IOS.blue,
    paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 12, width: '100%', alignItems: 'center', marginBottom: 20,
  },
  greenBtn: {
    backgroundColor: IOS.blue,
    paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 12, width: '100%', alignItems: 'center', marginTop: 16,
  },
  btnTxt: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  ghostBtn: {
    marginTop: 12, paddingVertical: 11, paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 0.5, borderColor: IOS.separator,
    backgroundColor: IOS.card,
  },
  ghostBtnTxt: { color: IOS.blue, fontSize: 15, fontWeight: '400' },

  // ── 行数確認画面 ───────────────────────────────────────────────────────────
  rowConfirmWrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  rowConfirmTitle: { fontSize: 20, fontWeight: '700', color: IOS.label, textAlign: 'center' },
  rowConfirmDesc: { fontSize: 14, color: IOS.secondary, textAlign: 'center', lineHeight: 20 },
  rowConfirmCard: { width: '100%' },
  secondaryBtn: {
    marginTop: 4, paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnTxt: { color: IOS.secondary, fontSize: 15 },

  // ── ローディング ────────────────────────────────────────────────────────────
  loading:    { alignItems: 'center', paddingVertical: 40, gap: 14 },
  loadingTxt: { fontSize: 15, fontWeight: '400', color: IOS.secondary },

  // ── 自動分割プレビュー ──────────────────────────────────────────────────────
  section:      { width: '100%', alignItems: 'center', marginBottom: 16 },
  previewLabel: { fontSize: 15, fontWeight: '600', color: IOS.label, marginBottom: 16 },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  thumbWrap: {
    width: 80, height: 80,
    backgroundColor: IOS.fill,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 0.5, borderColor: IOS.separator,
  },
  thumb: { width: 80, height: 80 },
  // auto セルの右下に表示するハサミアイコンバッジ（タップで手動分割できる目印）
  cellEditBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 完了バッジ ──────────────────────────────────────────────────────────────
  savedBadge: {
    backgroundColor: IOS.card,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
    marginTop: 16, width: '100%',
    borderWidth: 0.5, borderColor: IOS.separator,
  },
  savedTxt: { color: IOS.green, fontSize: 14, fontWeight: '600', textAlign: 'center' },

  // ── プレビュー画面: 許容値プリセット + 再分割行 ──────────────────────────────
  reSplitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  reSplitLabel: {
    fontSize: 14,
    color: IOS.secondary,
  },
  presetGroup: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: IOS.fill,
  },
  presetChipOn: {
    backgroundColor: IOS.blue,
  },
  presetChipTxt: {
    fontSize: 13,
    fontWeight: '500',
    color: IOS.secondary,
  },
  presetChipTxtOn: {
    color: '#FFF',
  },
  reSplitBtn: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: IOS.separator,
    backgroundColor: IOS.card,
  },
  reSplitBtnTxt: {
    fontSize: 13,
    fontWeight: '500',
    color: IOS.blue,
  },

  // （旧）未使用だが削除すると diff が増えるため残す
  title: { fontSize: 28, fontWeight: '600', color: IOS.label, marginBottom: 24 },
});
