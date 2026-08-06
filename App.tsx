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
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  // 画面状態の AppState 型と名前がぶつかるので別名で入れる。
  AppState as RNAppState,
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
import { consumeSharedImage, onShareSheetClosed, onAndroidSharedImageReceived } from './src/share/sharedInput';
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
  rebuildCellFromOriginal,
  isBBoxInside,
  cropFromOriginal,
  analyzeExistingTransparency,
  INIT_PAD_RATIO,
  INIT_PAD_MIN_RATIO,
  INIT_PAD_MIN_PX,
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
  patchSession,
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
import SplashAnimationView from './src/components/SplashAnimationView';
import type { SplashAnimationType } from './src/components/splash/types';
import { applyAppIcon, resolveAppIcon } from './src/appIcon';
// 広告の同意フロー(UMP+ATT)。オンボーディング完了後に一度だけ呼ぶ（下の effect 参照）。
import { gatherAdsConsentAndInit } from './src/ads/consent';
import SetupScreen   from './src/components/SetupScreen';
import ResultScreen          from './src/components/ResultScreen';
import SaveCompleteScreen    from './src/components/SaveCompleteScreen';
import PolygonTutorialScreen from './src/components/PolygonTutorialScreen';
import LoadingView from './src/components/ui/LoadingView';
import { describeSaveError } from './src/imaging/saveErrors';
import { t, useT } from './src/i18n';
import { useSettings } from './src/settings/SettingsContext';
import { isSplashEnabled } from './src/settings/store';
import { useAlbumName } from './src/settings/useAlbumName';

// ── 利用統計（端末内のみ・外部送信なし）───────────────────────────────────────
import { useStats } from './src/stats/StatsContext';

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
// 起動スプラッシュの演出パターン。undefined = 時間帯から自動選択。
// 'fly' | 'sleep' | 'drop' | 'cross' | 'peel' を入れると1種類に固定して確認できる。
// 4種を順に見比べたい時は SplashAnimationView の DEBUG_LOOP_PATTERNS を使う。
const SPLASH_ANIMATION: SplashAnimationType | undefined = undefined;

const DEFAULT_TOLERANCE = 30;
const DEFAULT_ROWS = 4;

/**
 * 読み込んだ画像の透明画素率がこれ以上なら「既に透過されている可能性がある」
 * と警告する（そのまま続行 or キャンセルの確認）。
 */
const PARTIAL_TRANSPARENCY_RATIO = 0.05;
/**
 * これ以上（または四隅が全部透明）なら「かなりの確率で既に背景除去済み」と
 * みなし、そのまま編集モードへ進む選択肢を出す（自動除去をスキップできる）。
 */
const HIGH_TRANSPARENCY_RATIO = 0.40;

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

/**
 * AppScreens — 画面ツリー本体。
 *
 * 起動スプラッシュはこの下(＝上のレイヤー)に重ねるため、下の App が包む。
 * この中では従来どおり早期 return で画面を出し分けてよい。
 */
function AppScreens() {
  // 言語が切り替わったらこの画面ツリー全体を描き直す。
  // 下位の画面もそれぞれ useT() を呼んでいるので、個別にも更新される。
  const { t } = useT();
  // 初回保存でアルバム名を確定させる（以後は言語を変えても固定）。
  const { ensureAlbumName } = useAlbumName();
  const { width: winW, height: winH } = useWindowDimensions();
  const [splitMode, setSplitMode] = useState<SplitMode>('auto');
  const [appState,  setAppState]  = useState<AppState>('idle');
  const appStateRef = useRef<AppState>('idle');
  appStateRef.current = appState;
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

  /**
   * セル編集中の「透過強度」。null = 未調整で、従来どおり bgResult（シート全体を
   * 一括で透過した結果）から切り出す。値が入っている間は、そのセルだけ
   * 元画像 baseRgbaRef から作り直す。
   *
   * 透過済みの bgResult から作り直してはいけない（消えた画素は戻らないので
   * 「透過しすぎ」を弱める方向に直せない）。必ず元画像から作る。
   */
  const [cellTolerance, setCellTolerance] = useState<number | null>(null);
  // 画像を作り直したことを子へ伝えるカウンタ（rgba は同一参照のまま中身が変わるため）。
  const [bgVersion, setBgVersion] = useState(0);

  // 手動モード用（PolygonEditor / PreviewScreen に渡す）
  const [bgResult,  setBgResult]  = useState<RemoveBgResult | null>(null);
  const bgResultRef = useRef<RemoveBgResult | null>(null);
  bgResultRef.current = bgResult;
  /**
   * セル個別編集(cell_editing)の間、bg.rgba（シート全体サイズ）の作り直しを
   * サボっているかどうか。cell_editing 中の画面表示は buildCellRgba が
   * base+editsRef からセル範囲だけ直接作るので bg.rgba を見ておらず、undo/redo
   * のたびに元画像全体×自動背景除去からやり直す重い処理を挟む必要がない。
   * セルを抜ける時（flushBgRgba）に1回だけまとめて計算し直す。
   */
  const bgRgbaDirtyRef = useRef(false);
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
  // 保存完了画面に見せるカットのローカル PNG。CameraRoll の ph:// は
  // 透過が白で潰れることがあるため、表示と共有にはこちらを使う。
  const [savedLocalUris, setSavedLocalUris] = useState<string[]>([]);

  // ── アプリ設定 ─────────────────────────────────────────────────────────────
  // SettingsContext から取得する。AsyncStorage のロード・保存は Context が担当。
  // App.tsx 側での useState / loadSettings / saveSettings は不要になった。
  const { settings: appSettings, loaded: settingsLoaded, updateSettings } = useSettings();
  const thumbBg = useThumbBg();

  // ── 利用統計（端末内のみ）───────────────────────────────────────────────────
  const { recordImageEdited, recordTransparencyOp, recordStampsCreated, recordExportCompleted } = useStats();

  // ── アプリアイコン ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settingsLoaded) return;
    void applyAppIcon(resolveAppIcon(appSettings.appIcon));
  }, [settingsLoaded, appSettings.appIcon]);

  // ── 広告の同意フロー（UMP + ATT）──────────────────────────────────────────
  // 「設定ロード済み かつ オンボーディング完了済み」になった最初のタイミングで
  // 一度だけ呼ぶ。初回起動ではオンボーディングの「はじめる」で
  // hasSeenOnboarding が立った直後、2回目以降は起動して設定がロードされた
  // 直後に発火する。起動直後(index.js)ではなくここまで遅らせるのは、
  // アプリの目的を理解する前に ATT ダイアログを出すと拒否率が上がるため。
  // 多重発火は gatherAdsConsentAndInit 側の冪等ガードが吸収する。
  useEffect(() => {
    if (settingsLoaded && appSettings.hasSeenOnboarding) {
      gatherAdsConsentAndInit();
    }
  }, [settingsLoaded, appSettings.hasSeenOnboarding]);

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
    if (!base || !bg) {
      // ここを通ると編集が一切反映されない（操作列だけ伸びる）。
      // 静かに無視すると原因が分からないので必ず残す。
      console.warn('[App] 元画像が無いため編集を適用できません', { hasBase: !!base, hasBg: !!bg });
    }
    if (base && bg) {
      // セル個別編集(cell_editing)の間は、この画面が見ているのはセル範囲だけ
      // (buildCellRgba が base+editsRef から直接作る)なので、シート全体サイズの
      // bg.rgba をここで作り直す必要が無い。背景除去からの全段掛け直しは重く、
      // undo のたびに走ると体感できるほど待たされるため、セルを抜けて全体表示に
      // 戻る時（flushBgRgba）まで先延ばしにする。
      if (appStateRef.current === 'cell_editing') {
        bgRgbaDirtyRef.current = true;
      } else {
        const cur = editsRef.current;
        // 追加は [...cur, step] で作るので、先頭は同じ参照のまま並ぶ。
        // 参照比較で「続きかどうか」を安く判定できる。
        const isAppend = next.length >= cur.length && cur.every((s, i) => s === next[i]);

        if (isAppend) {
          // 増えた分だけ掛ける（0件なら何もしない）。
          if (next.length > cur.length) {
            applyEditSteps(bg.rgba, bg.width, bg.height, next.slice(cur.length), base);
          }
        } else {
          // 取り消し・リセットなど。操作は巻き戻せないので元画像から作り直す。
          bg.rgba.set(base);
          applyEditSteps(bg.rgba, bg.width, bg.height, next, base);
        }
      }
      setBgVersion(v => v + 1);
    }
    editsRef.current = next;
    setEdits(next);
    redoStepsRef.current = nextRedo;
    setRedoSteps(nextRedo);

    // スポイトだけ操作して離脱する経路があるため、ここで保存する。ポリゴン操作など
    // 他の保存契機を待つと、画像編集のみの変更が保存されないまま終わってしまう。
    // patchSession は既存レコードへのマージをキュー内でアトミックに行うので、
    // ポリゴン保存など他の書き込みと競合して片方が消えることがない
    // （以前は getSession→upsertSession を自前で2回に分けており、間に他の
    // 書き込みが挟まるとロスト・アップデートでポリゴンが消える不具合になっていた）。
    const id = currentSessionIdRef.current;
    if (!id) return;
    void patchSession(id, { edits: next, updatedAt: Date.now() });
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

  /**
   * 手を加える前 ＝「自動背景除去だけ済んだ状態」へ戻す。
   *
   * 操作列の先頭は必ず autoBg（背景除去そのもの）なので、それだけ残して
   * 以降のスポイトを捨てる。全部消すと背景が戻ってしまい、リセットのたびに
   * 背景除去をやり直す羽目になっていた。
   * 背景除去そのものを取り消したい場合は undo で先頭まで戻せる。
   */
  const resetEdits = useCallback(() => {
    const first = editsRef.current[0];
    applyEdits(first?.kind === 'autoBg' ? [first] : [], []);
  }, [applyEdits]);

  /**
   * cell_editing 中にサボっていた bg.rgba（シート全体サイズ）の作り直しを
   * まとめて片付ける。セルを抜けて全体表示(ResultScreen・書き出し等)へ
   * 戻る直前に必ず呼ぶこと。dirty でなければ何もしない（毎回呼んでも安全）。
   */
  const flushBgRgba = useCallback(() => {
    if (!bgRgbaDirtyRef.current) return;
    const base = baseRgbaRef.current;
    const bg = bgResultRef.current;
    if (base && bg) {
      bg.rgba.set(base);
      applyEditSteps(bg.rgba, bg.width, bg.height, editsRef.current, base);
    }
    bgRgbaDirtyRef.current = false;
  }, []);


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

    await startWithImage(result.assets[0].uri);
  };

  /**
   * 選んだ／共有された画像1枚から処理を開始する。
   * ピッカー経由でも共有シート経由でも、ここから先は完全に同じ扱いにする。
   */
  const startWithImage = async (pickedUri: string) => {
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
    // 画像読み込み成功 → 統計「編集した画像」を加算（新規に選んだ画像のみ。セッション再開はカウントしない）
    recordImageEdited();

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
    setCellTolerance(null);
    setPolygons([]); // 前画像のポリゴンを消す（手動セッション再開時は後段の resumePolygons で復元される）
    setCurrentImageUri(uri); // done upsert 時に参照する

    try {
      // removeBackground は両モード共通。
      // tolerance は設定画面で変更可能: appSettings.tolerance を使う
      // 元画像を読み込み、その画素を基準として保持してから操作列を掛ける。
      // 保存済みの操作列があればそれを、無ければ自動背景除去1件から始める。
      const result = await loadImagePixels(uri);
      baseRgbaRef.current = result.rgba.slice();

      let steps: EditStep[];
      if (resumeEdits?.length) {
        // セッション再開: 保存済みの操作列をそのまま使う。透過チェックは
        // 新規に画像を選んだ時だけの話なので、再開時はスキップする。
        steps = resumeEdits;
      } else {
        const defaultStep: EditStep = {
          kind: 'autoBg',
          tolerance: appSettings.tolerance,
          feather: appSettings.featherEdges,
          fillHoles: appSettings.fillTextHoles,
        };
        // 「既に透過済みの画像」チェック。ChatGPT等で書き出された画像は
        // 見た目は普通でも実は背景が抜けていることがあり、気づかずもう一度
        // 背景除去を掛けると（既に透明な縁をさらに侵食して）画質が落ちる。
        const stats = analyzeExistingTransparency(result.rgba, result.width, result.height);
        // 四隅が全部透明なら、割合が低くても「既に抜かれている」可能性が高い
        // （背景除去は画像の端から広がるため）。
        const likelyPreCutout = stats.cornersTransparent || stats.ratio >= HIGH_TRANSPARENCY_RATIO;

        if (likelyPreCutout) {
          // かなり高い確率で既に透過済み: そのまま編集モードへ進む選択肢を出す
          // （＝自動除去をスキップし、読み込んだ画像自身の alpha をそのまま使う）。
          const editAsIs = await new Promise<boolean>(resolve => {
            Alert.alert(
              t('transparency.preCutoutTitle'),
              t('transparency.preCutoutMessage'),
              [
                { text: t('transparency.redoRemoval'), onPress: () => resolve(false) },
                { text: t('transparency.editAsIs'), onPress: () => resolve(true) },
              ],
            );
          });
          steps = editAsIs ? [] : [defaultStep];
        } else if (stats.ratio >= PARTIAL_TRANSPARENCY_RATIO) {
          // 部分的に透過されているかも: 止めるのではなく教えるだけ。
          // デフォルトの動線は「そのまま続行」（普通の写真にもよくある誤検知の
          // 余地があるため、キャンセル一択にはしない）。
          const proceed = await new Promise<boolean>(resolve => {
            Alert.alert(
              t('transparency.partialTitle'),
              t('transparency.partialMessage'),
              [
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('transparency.continueAnyway'), onPress: () => resolve(true) },
              ],
            );
          });
          if (!proceed) {
            setAppState('idle');
            return;
          }
          steps = [defaultStep];
        } else {
          // 透明画素がほぼ無い、普通の写真: 従来どおり何も聞かず進む。
          steps = [defaultStep];
        }
      }
      applyEditSteps(result.rgba, result.width, result.height, steps, baseRgbaRef.current);
      // 透過処理完了 → 統計「透過処理」を加算。セッション再開時の再生（resumeEdits）は
      // 既に実行済みの操作をなぞるだけなので数えない。新規に autoBg を実行した時だけ数える。
      if (!resumeEdits?.length && steps.some(s => s.kind === 'autoBg')) {
        recordTransparencyOp();
      }
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
    // セル配列そのものが総入れ替えになるので、index に紐づく下書きは意味を失う。
    cellDraftsRef.current.clear();
    setAppState('preview');

    // 分割完了後にセッションへカット一覧を保存（復元用）
    if (currentSessionId) {
      const savedCells: SavedCell[] = newCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
        multipleObjects: cell.kind === 'auto' ? cell.multipleObjects : undefined,
        // 手動分割したカットも再開後に編集し直せるよう、位置と形を残す。
        srcBBox: cell.kind === 'poly' ? cell.srcBBox : undefined,
        polygon: cell.kind === 'poly' ? cell.polygon : undefined,
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

  // ── 共有シートから渡された画像の引き取り ─────────────────────────────────
  // Share Extension が App Group に置いた画像があれば、画像選択と同じ流れへ流す。
  //
  // 起動時だけでは足りない。アプリが動いたまま共有された場合（自分の共有シートから
  // 自分の Extension に渡した場合を含む）プロセスは起動し直されないので、
  // 前面に戻ってきた時にも確認する。画像は引き取った時点で App Group から消えるので、
  // 二重に走っても2回処理されることはない。
  const consumingShareRef = useRef(false);
  useEffect(() => {
    const pickUpSharedImage = async () => {
      if (consumingShareRef.current) return; // 取得中の再入を防ぐ
      consumingShareRef.current = true;
      try {
        const uri = await consumeSharedImage();
        if (uri) await startWithImage(uri);
      } finally {
        consumingShareRef.current = false;
      }
    };

    void pickUpSharedImage(); // 起動時
    const sub = RNAppState.addEventListener('change', next => {
      if (next === 'active') void pickUpSharedImage(); // 前面に戻った時
    });
    // アプリ内の共有シートから自分の Extension に渡した場合はここだけが手掛かり。
    // Extension の書き込みとシートが閉じるのが前後することがあるので、
    // 空振りしたら一度だけ間を置いて見直す。
    const unsubscribeShare = onShareSheetClosed(() => {
      void (async () => {
        await pickUpSharedImage();
        setTimeout(() => { void pickUpSharedImage(); }, 800);
      })();
    });
    // Android: singleTask のため起動中の共有は onNewIntent 経由でしか気付けない。
    const unsubscribeAndroidShare = onAndroidSharedImageReceived(() => {
      void pickUpSharedImage();
    });
    return () => {
      sub.remove();
      unsubscribeShare();
      unsubscribeAndroidShare();
    };
    // マウント時に1度だけ購読する。startWithImage は毎レンダリング作り直されるので
    // 依存に入れない（入れると購読し直しになる）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // 手動分割したカットも再開後に編集し直せるよう、位置と形を残す。
        srcBBox: cell.kind === 'poly' ? cell.srcBBox : undefined,
        polygon: cell.kind === 'poly' ? cell.polygon : undefined,
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

  /**
   * セル1枚ぶんの RGBA を作る。描画（cell_editing）と確定（handleCellEditConfirm）で
   * 必ず同じものを使うため、生成元をこの1箇所に集約する。
   *
   * 常に元画像 baseRgbaRef + 操作列(editsRef) からセル範囲だけを作り直す
   * （bg.rgba＝シート全体サイズのバッファは一切見ない）。
   * 透過済みの bgResult を作り直しの入力にしてはいけない（消えた画素は戻らず
   * 「透過しすぎ」を弱める方向に直せない）ので、必ず元画像から作る。
   *
   * この「bg.rgba を見ない」性質のおかげで、cell_editing 中は bg.rgba を
   * 都度作り直さずに済む（applyEdits 側の遅延評価とセットで効く。詳しくは
   * bgRgbaDirtyRef 参照）。
   *
   * cellTolerance が null（このセルの強さをまだ調整していない）場合は、
   * シート作成時に実際に使われた強さ（先頭の autoBg ステップの tolerance）を
   * 使う。ここで appSettings.tolerance を使ってしまうと、シート作成後に
   * 設定画面で既定値を変えた時に見た目が変わってしまう。
   */
  const buildCellRgba = useCallback((bbox: {
    minX: number; minY: number; maxX: number; maxY: number;
  }): RemoveBgResult | null => {
    const bg = bgResultRef.current;
    if (!bg) return null;
    const base = baseRgbaRef.current;
    if (!base || !isBBoxInside(bbox, bg.width, bg.height)) return null;

    const firstStep = editsRef.current[0];
    const sheetTolerance = firstStep?.kind === 'autoBg' ? firstStep.tolerance : appSettings.tolerance;

    return rebuildCellFromOriginal(base, bg.width, bg.height, bbox, {
      tolerance: cellTolerance ?? sheetTolerance,
      feather: appSettings.featherEdges,
      fillHoles: appSettings.fillTextHoles,
      steps: editsRef.current,
    });
  }, [cellTolerance, appSettings.tolerance, appSettings.featherEdges, appSettings.fillTextHoles]);

  /**
   * セル編集で復元ブラシの透かしに使う、元画像の切り出し。
   *
   * レンダーのたびに切り出すと毎回別の配列になり、PolygonEditor 側で
   * SkImage を作り直し続けることになる。開いているセルが変わった時だけ作る。
   */
  /**
   * セル編集で表示するセル画像。
   *
   * 以前はレンダーのたびに buildCellRgba を呼んでいた。復元ブラシは1ストロークごとに
   * 再レンダーを起こすので、そのたびに「切り出し + SkImage 生成 + 連結成分の再計算」が
   * 走って重くなっていた。編集が進んだ時（bgVersion）と対象が変わった時だけ作り直す。
   */
  const cellSubResult = useMemo(() => {
    if (appState !== 'cell_editing' || editingCellIdx === null) return null;
    const c = cells[editingCellIdx];
    const bb = c?.kind === 'auto' ? c.bbox : c?.srcBBox;
    if (!bb) return null;
    return buildCellRgba(bb);
    // buildCellRgba は cellTolerance と設定に依存する（useCallback の依存に入っている）。
    // bgVersion は「画素が変わった」ことを示す唯一の合図なので依存に含める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, editingCellIdx, cells, buildCellRgba, bgVersion]);

  const cellBaseRgba = useMemo(() => {
    if (appState !== 'cell_editing' || editingCellIdx === null) return null;
    const bg = bgResult;
    const base = baseRgbaRef.current;
    if (!bg || !base) return null;
    const c = cells[editingCellIdx];
    const bb = c?.kind === 'auto' ? c.bbox : c?.srcBBox;
    if (!bb || !isBBoxInside(bb, bg.width, bg.height)) return null;
    return cropFromOriginal(base, bg.width, bb).rgba;
  }, [appState, editingCellIdx, cells, bgResult]);

  /**
   * セル編集中に描いた形の「下書き」。
   *
   * 決定ボタンを押すまでは cells 配列にもセッションにも触れない
   * （囲んだ時点で「手動分割済み」セクションへ移ってしまうと、まだ調整中なのに
   * 結果が確定したかのように見えて紛らわしい、という声を受けての設計）。
   * その代わり、決定を押し忘れて「戻る」で抜けてしまっても直前の形を復元できる
   * よう、この Map（cellIndex → 直近の polygons）にだけ逃がしておく。
   * アプリを完全に終了すると失われる（あくまで「うっかり離脱」対策）。
   */
  const cellDraftsRef = useRef<Map<number, Polygon[]>>(new Map());

  /** 決定/プレビュー。編集結果を実際に cells とセッションへ確定し、画面を抜ける。 */
  const commitCellEdit = useCallback(async (polygons: Polygon[]) => {
    if (editingCellIdx === null || !bgResult) return;
    const editedCell = cells[editingCellIdx];
    if (!editedCell) return;
    // auto は bbox、手動分割済みは srcBBox。どちらも元画像上の矩形。
    const bbox = editedCell.kind === 'auto' ? editedCell.bbox : editedCell.srcBBox;
    if (!bbox) return;
    const subW = bbox.maxX - bbox.minX + 1;
    const subH = bbox.maxY - bbox.minY + 1;

    // 画面に出していたものと同じセル画像を使う（透過強度を変えていればその結果）。
    const built = buildCellRgba(bbox);
    if (!built) return;
    const subRgba = built.rgba;

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
      // 後から編集し直せるように、元画像上の位置とポリゴンを残す。
      //
      // tight（マスク後に残った画素だけの最小範囲）をそのまま srcBBox にすると、
      // 再編集で開いた時のキャンバスが前回の輪郭ぴったりに切り詰められてしまい、
      // 「輪郭が少し内側すぎた」を後から直そうとしても、はみ出したかった部分の
      // 画素データ自体がそもそも含まれておらず直せない（＝開始位置がズレて見える
      // 不具合の原因）。tight の周りに少し余白を足した範囲を srcBBox にすることで、
      // 再編集時に前回の輪郭より外側へも調整できる余地を残す。
      // 最終的な書き出し画像（cropped/thumbUri）は従来どおり tight のまま変えない
      // （書き出しサイズに余白入りの透明ピクセルを含めたくないため）。
      const padW = Math.max(
        INIT_PAD_MIN_PX,
        Math.round(Math.min(subW, subH) * INIT_PAD_MIN_RATIO),
        Math.round(Math.min(cw, ch) * INIT_PAD_RATIO),
      );
      const padMinX = Math.max(0, tight.minX - padW);
      const padMinY = Math.max(0, tight.minY - padW);
      const padMaxX = Math.min(subW - 1, tight.maxX + padW);
      const padMaxY = Math.min(subH - 1, tight.maxY + padW);
      const srcBBox = {
        minX: bbox.minX + padMinX,
        minY: bbox.minY + padMinY,
        maxX: bbox.minX + padMaxX,
        maxY: bbox.minY + padMaxY,
        area: (padMaxX - padMinX + 1) * (padMaxY - padMinY + 1),
      };
      // ポリゴンは切り出し原点（余白込みの左上）基準へ移す。再編集で開いた時に
      // そのまま initialPolygons として使える。
      const polygon = p.points.map(
        ([px, py]) => [px - padMinX, py - padMinY] as [number, number],
      );
      return { kind: 'poly' as const, rgba: cropped, w: cw, h: ch, thumbUri, srcBBox, polygon };
    }));
    const newCells = cellOrNulls.filter(Boolean) as Array<Extract<Cell, { kind: 'poly' }>>;

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
    cellDraftsRef.current.delete(editingCellIdx); // 確定したので下書きは不要
    setEditingCellIdx(null);
    // 透過強度はセル単位の調整。確定したらここで捨てる（次のセルへ持ち越さない）。
    setCellTolerance(null);
    setAppState('preview');
    // セルを抜けるので、サボっていた bg.rgba の作り直しをここで片付ける。
    flushBgRgba();

    // 編集確定後のセル一覧をセッションに保存。
    // patchSession でマージするのは、スポイト・復元ブラシの edits 保存
    // （applyEdits 内、同じく patchSession 経由）と競合しても片方が消えないようにするため。
    if (currentSessionId) {
      const savedCells: SavedCell[] = nextCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
        multipleObjects: cell.kind === 'auto' ? cell.multipleObjects : undefined,
        // 手動分割したカットも再開後に編集し直せるよう、位置と形を残す。
        srcBBox: cell.kind === 'poly' ? cell.srcBBox : undefined,
        polygon: cell.kind === 'poly' ? cell.polygon : undefined,
      }));
      await patchSession(currentSessionId, {
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
  }, [cells, editingCellIdx, bgResult, currentSessionId, currentImageUri, appSettings.tolerance, rows, flushBgRgba]);

  /** 「決定/プレビュー」ボタン。確定して一覧へ戻る。 */
  const handleCellEditConfirm = useCallback((polys: Polygon[]) => { void commitCellEdit(polys); }, [commitCellEdit]);

  /**
   * セル編集中、確定操作（囲む・頂点調整など）のたびに下書きだけ更新する
   * （onPolygonsChange から呼ぶ）。cells/セッションには触れないので軽い
   * （画像処理を伴わない）。決定ボタンを押し忘れて「戻る」で抜けても、
   * 次に同じセルを開いた時にこの下書きから復元できる（commitCellEdit 冒頭の
   * cellDraftsRef のコメント参照）。
   */
  const handleCellPolygonsChange = useCallback((polys: Polygon[]) => {
    if (editingCellIdx === null) return;
    cellDraftsRef.current.set(editingCellIdx, polys);
  }, [editingCellIdx]);

  // ── 自動分割の書き出し ─────────────────────────────────────────────────────

  const doAutoExport = useCallback(async () => {
    if (cells.length === 0) return;
    if (!await requestSave()) {
      Alert.alert(t('permission.errorTitle'), t('permission.saveDenied'));
      return;
    }
    setAppState('processing');
    try {
      // auto/poly 両種別を SkImage に変換して保存する。
      // bgResult が null（復元セッション）の場合: auto セルは thumbUri から、
      // poly セルも thumbUri から読み込む（thumb は最終品質の PNG）。
      //
      // 【重要】ここでは「作る関数」だけを並べて渡し、実際の生成は saveSkImages が
      // 1件ずつ行う。全件を先に生成すると、カット数が多いシートでフル解像度の
      // SkImage が同時に何十枚も Native メモリへ載り、実機で OOM 強制終了する
      // 原因になっていたため。
      const builders: Array<() => Promise<SkImage> | SkImage> = cells.map(cell => () => {
        if (cell.kind === 'auto') {
          if (bgResult) {
            // fresh path: マージン付与（サムネと同じ処理）
            const raw = cropToImage(bgResult.rgba, bgResult.width, cell.bbox);
            const img = addMarginToImage(raw);
            raw.dispose();
            return img;
          }
          // 復元セッション: thumbUri はサムネ生成時にマージン付与済みのためそのまま使う
          return Skia.Data.fromURI(cell.thumbUri).then(data => Skia.Image.MakeImageFromEncoded(data)!);
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
        return Skia.Data.fromURI(cell.thumbUri).then(data => Skia.Image.MakeImageFromEncoded(data)!);
      });

      const { count, paths } = await saveSkImages(builders, await ensureAlbumName());
      // 書き出し成功 → 統計を加算。
      // 「作成したスタンプ」は生成した個数ではなく書き出しが成功した個数で数える
      // （途中で分割し直したり合体したりで生成数と完成数はズレるため、
      // ユーザーが見て嬉しいのは「実際に完成した枚数」の方）。
      recordExportCompleted();
      recordStampsCreated(count);

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
      // 書き出した実ファイル（EXPORT_DIR 配下）を渡す。セッションのサムネとは別物なので
      // autoDeleteOnExport で消えることもない。
      setSavedLocalUris(paths);
      setAppState('done');
    } catch (e: unknown) {
      // 写真の権限が原因のことが多いので、日本語の対処手順に変換して出す。
      Alert.alert(t('errors.exportTitle'), describeSaveError(e));
      setAppState('preview');
    }
  }, [bgResult, cells, currentSessionId, currentImageUri, rows, reloadSessions, requestSave, appSettings.tolerance, appSettings.autoDeleteOnExport, ensureAlbumName, t, recordExportCompleted, recordStampsCreated]);

  // ── リセット ──────────────────────────────────────────────────────────────

  const reset = () => {
    setBgResult(null);
    setCells([]);
    setEditingCellIdx(null);
    setCellTolerance(null);
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

    // ── 書き出し済み（step='done'）── 保存完了画面へ直行 ──────────────────────
    // 作業が完了しているセッションで分割結果を開いても「もう一度保存する」しか
    // することがないので、最後に見た画面（保存完了）へ戻す。
    // removeBackground を走らせる必要がないぶん、再開も速い。
    const doneCount = latest.autoData?.cells?.length ?? latest.polygons?.length ?? 0;
    if (latest.step === 'done' && doneCount > 0) {
      setCurrentImageUri(latest.imageUri);
      setSavedCount(doneCount);
      // 書き出し用ファイル(EXPORT_DIR)は次の書き出しで消えるので、再開時はセッションが
      // 持つカットのサムネを使う。こちらも file:// の PNG なので透過は保たれる。
      // autoDeleteOnExport で実ファイルが消えている場合があるため存在確認する
      // （残っていなければ空 → 保存完了画面が CameraRoll へフォールバックする）。
      const savedPaths = await Promise.all(
        (latest.autoData?.cells ?? []).map(async c => {
          const path = c.thumbPath.startsWith('file://') ? c.thumbPath.slice(7) : c.thumbPath;
          return (await RNFS.exists(path)) ? c.thumbPath : null;
        }),
      );
      setSavedLocalUris(savedPaths.filter((u): u is string => u !== null));
      setAppState('done');
      return;
    }

    // ── 自動モードで autoData（カット一覧）が保存済みの場合 ──────────────────
    // doSplit を再実行せず、保存済みセルを復元して ResultScreen を直接開く。
    // bgResult は編集・再分割に備えて removeBackground を再実行して取得する。
    if (mode === 'auto' && latest.autoData?.cells?.length) {
      setAppState('processing');
      setBgResult(null);
      setCells([]);
      setCurrentImageUri(latest.imageUri);
      try {
        // 【重要】ここで removeBackground を使うと「透過済みの画素」しか手に入らず、
        // 元画像 baseRgbaRef が null のままになる。すると applyEdits のガード
        // (base && bg) を通れず、スポイトも復元ブラシも何も起きない
        // （操作は積まれ、処理中表示だけ一瞬出る）。復元ブラシの透かしも出ない。
        // 元画像を読み込んで base として保持し、操作列を掛け直す形にする。
        const result = await loadImagePixels(latest.imageUri);
        baseRgbaRef.current = result.rgba.slice();
        const resumeSteps: EditStep[] = latest.edits?.length
          ? latest.edits
          : [{
              kind: 'autoBg',
              tolerance: latest.autoData.tolerance ?? appSettings.tolerance,
              feather: appSettings.featherEdges,
              fillHoles: appSettings.fillTextHoles,
            }];
        applyEditSteps(result.rgba, result.width, result.height, resumeSteps, baseRgbaRef.current);
        editsRef.current = resumeSteps;
        setEdits(resumeSteps);
        setRedoSteps([]);
        redoStepsRef.current = [];
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
            // poly セル: rgba なしで復元（export 時は thumbUri から再読み込み）。
            // srcBBox/polygon があれば、再開後もこのカットを編集し直せる。
            return {
              kind: 'poly' as const,
              thumbUri,
              srcBBox: savedCell.srcBBox,
              polygon: savedCell.polygon,
            };
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
          : [{ kind: 'autoBg', tolerance: appSettings.tolerance, feather: appSettings.featherEdges, fillHoles: appSettings.fillTextHoles }];
        applyEditSteps(result.rgba, result.width, result.height, steps, baseRgbaRef.current);
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

  // ── セル個別編集からの離脱: 先にローディングを出してから重い処理をする ──────
  //
  // cell_editing の onBack は flushBgRgba でシート全体サイズの bg.rgba を
  // 操作列の先頭（背景除去そのもの）から掛け直す。画像が大きいと同様に
  // JS スレッドが数百ms〜数秒止まり、何も出さないと固まったように見える。
  // pendingEditor と同じ「ローディングを描く→1〜2フレーム待つ→重い処理」の
  // 順にする。
  const [pendingCellExit, setPendingCellExit] = useState(false);

  // ── 切り取りプレビューへの遷移: 同じくローディングを挟む ────────────────────
  //
  // PolygonEditor の「プレビュー」を押した直後、PreviewScreen 側でもポリゴン
  // ごとに画素単位でサムネイルを作る重い処理が走る（PreviewScreen 内の
  // ActivityIndicator だけでは、画面が実際にコミットされる前に処理が始まって
  // 固まって見えることがある）。ここでも一段ローディングを挟んでおく。
  const [pendingPreview, setPendingPreview] = useState(false);

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

  useEffect(() => {
    if (!pendingCellExit) return;
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setEditingCellIdx(null);
        // 透過強度はセルごとの調整なので、抜ける時に必ず捨てる。
        // 残すと次に開いた別のセルへ意図せず引き継がれる。
        setCellTolerance(null);
        setAppState('preview');
        // セルを抜けるので、サボっていた bg.rgba の作り直しをここで片付ける。
        flushBgRgba();
        setPendingCellExit(false);
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(outer); };
  }, [pendingCellExit, flushBgRgba]);

  useEffect(() => {
    if (!pendingPreview) return;
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setAppState('polygon_preview');
        setPendingPreview(false);
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(outer); };
  }, [pendingPreview]);

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

  // ── セル個別編集からの離脱準備中 ────────────────────────────────────────
  if (pendingCellExit) {
    return (
      <>
        <StatusBar hidden />
        <LoadingView message={t('loading.cellExitTitle')} sub={t('loading.cellExitSub')} />
      </>
    );
  }

  // ── 切り取りプレビューへの遷移準備中 ────────────────────────────────────
  if (pendingPreview) {
    return (
      <>
        <StatusBar hidden />
        <LoadingView message={t('loading.previewGenerating')} sub={t('loading.editorSub')} />
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
          // auto セルはそのまま、手動分割済み(poly)でも srcBBox があれば開ける。
          // srcBBox が無いのは旧バージョンで作られたカットだけで、その場合は
          // 元画像のどこだったか復元できないため開かない。
          const c = cells[i];
          if (!c) return;
          if (c.kind === 'poly' && !c.srcBBox) return;
          goToEditor('cell_editing', i);
        }}
        onMerge={handleMerge}
      />
    );
  }

  // ── 合体ブロック手動分割: セル切り出し画像を PolygonEditor に渡して編集 ──
  if (appState === 'cell_editing' && bgResult && editingCellIdx !== null) {
    const editedCell = cells[editingCellIdx];
    // 手動分割済みのカットは srcBBox（元画像上の位置）を使って同じ土俵に載せる。
    // 開いた時にはマスク前の矩形が出るので、ポリゴンを引き直して切り直せる。
    const bbox = editedCell?.kind === 'auto' ? editedCell.bbox : editedCell?.srcBBox;
    if (editedCell && bbox) {
      // 透過強度を変えていれば元画像から作り直したもの、そうでなければ従来どおり
      // bgResult から切り出したものが返る（確定時と同じヘルパを通す）。
      const subBgResult = cellSubResult;
      if (!subBgResult) return null;
      // 前回のポリゴンがあれば復元して開く（形の作り直しではなく調整で済む）。
      // 決定済みの .polygon より、決定前の下書き（cellDraftsRef）を優先する:
      // 決定を押し忘れて「戻る」で抜けた直後の再編集では、こちらの方が新しい。
      const draft = cellDraftsRef.current.get(editingCellIdx);
      const initialPolys = draft ?? (editedCell.kind === 'poly' && editedCell.polygon
        ? [{ id: 0, points: editedCell.polygon }]
        : undefined);
      return (
        <>
          <StatusBar hidden />
          <PolygonEditor
            bgResult={subBgResult}
            displayW={winW}
            displayH={winH}
            onPreview={handleCellEditConfirm}
            // 確定操作（囲む・頂点調整など）のたびに下書きだけ更新する（cells/セッションは
            // 「決定」を押すまで変えない — 手動分割済みセクションへ早期に移ってしまうのを防ぐ）。決定ボタンを
            // 押し忘れて戻っても、直前まで描いていた形が失われないようにするため
            // （commitCellEdit のコメント参照）。
            onPolygonsChange={handleCellPolygonsChange}
            initialPolygons={initialPolys}
            onBack={() => setPendingCellExit(true)}
            onSettings={() => goToSettings()}
            // スポイトはセルの切り出し座標で来るので、元画像の座標へ戻して積む。
            // 操作列は常に元画像1枚に対するものなので、bbox の分だけずらさないと
            // 別の場所の色が抜ける。
            onEyedrop={(x, y, tolerance, feather) =>
              pushEdit({ kind: 'eyedrop', x: x + bbox.minX, y: y + bbox.minY, tolerance, feather })}
            // 復元ブラシ。セル内座標で来るので、元画像座標へ戻して積む。
            onRestore={(points, radius) => pushEdit({
              kind: 'restore',
              points: points.map(([px, py]) => [px + bbox.minX, py + bbox.minY] as [number, number]),
              radius,
            })}
            baseRgba={cellBaseRgba}
            onUndoEdit={undoEdit}
            onRedoEdit={redoEdit}
            // 先頭の autoBg はここからは取り消させない。セル編集中に背景除去まで
            // 巻き戻ると、編集対象のセルの前提そのものが崩れるため。
            canUndoEdit={edits.length > 1}
            canRedoEdit={redoSteps.length > 0}
            // 透過強度を変えるたびに再生成するので、画像の差し替えを伝える。
            bgVersion={bgVersion + (cellTolerance ?? 0)}
            cellTolerance={cellTolerance ?? appSettings.tolerance}
            // 「再適用」。scopeBBox が無ければ従来どおりセル全体を作り直す
            // （元画像の該当セル範囲から、透過済みは入力にしない）。
            // scopeBBox がある（選択範囲だけ再透過）場合は、セル全体は作り直さず
            // 通常の編集操作（スポイト等）と同じ「元画像1枚に対する操作列」に
            // 1件積む —— こうするとその範囲だけが変わり、undo/redo も効く。
            // 座標はこのエディタのセル内基準で来るので、bbox 分だけ元画像基準へ
            // 戻す（スポイト・復元ブラシと同じ変換）。
            onRetransparent={(tol, scope) => {
              // 再透過処理完了 → 統計「透過処理」を加算（範囲限定・セル全体どちらも対象）
              recordTransparencyOp();
              if (scope) {
                pushEdit({
                  kind: 'retransRegion',
                  minX: scope.minX + bbox.minX,
                  minY: scope.minY + bbox.minY,
                  maxX: scope.maxX + bbox.minX,
                  maxY: scope.maxY + bbox.minY,
                  // ポリゴン/ブラシどちらの選択でも同じ「点列」として来る。
                  // 矩形と同じくセルのローカル座標→元画像座標へ戻す。
                  maskPoints: scope.maskPoints?.map(
                    ([x, y]) => [x + bbox.minX, y + bbox.minY] as [number, number],
                  ),
                  tolerance: tol,
                  feather: appSettings.featherEdges,
                  fillHoles: appSettings.fillTextHoles,
                });
              } else {
                setCellTolerance(tol);
              }
            }}
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
          // 復元ブラシ。座標はこの画面では元画像そのものなので変換不要。
          onRestore={(points, radius) => pushEdit({ kind: 'restore', points, radius })}
          // 復元ブラシの透かし用。この画面では元画像そのものを渡す。
          baseRgba={baseRgbaRef.current}
          onUndoEdit={undoEdit}
          onRedoEdit={redoEdit}
          onResetEdits={resetEdits}
          canUndoEdit={edits.length > 0}
          canRedoEdit={redoSteps.length > 0}
          bgVersion={bgVersion}
          // 再透過。この画面は元画像そのものを編集しているので、cell_editing と
          // 違って bbox 分のオフセットは不要（PolygonEditor から来る座標が
          // そのまま元画像座標）。「画像全体」は cellTolerance のような専用の
          // 軽い経路が無いので、全域を対象にした retransRegion として同じ
          // pushEdit 経路に積む（undo/redo も自然に効く）。
          onRetransparent={(tol, scope) => {
            if (scope) {
              pushEdit({
                kind: 'retransRegion',
                minX: scope.minX, minY: scope.minY, maxX: scope.maxX, maxY: scope.maxY,
                maskPoints: scope.maskPoints,
                tolerance: tol, feather: appSettings.featherEdges, fillHoles: appSettings.fillTextHoles,
              });
            } else {
              pushEdit({
                kind: 'retransRegion',
                minX: 0, minY: 0, maxX: bgResult.width - 1, maxY: bgResult.height - 1,
                tolerance: tol, feather: appSettings.featherEdges, fillHoles: appSettings.fillTextHoles,
              });
            }
          }}
          // 確定操作ごとにポリゴンをセッションに保存。
          // プレビュー押下を待たず、頂点追加・削除・ドラッグ終了の都度 upsert する。
          // 毎フレームではなく「操作確定時のみ」発火するため頻度は低い（PolygonEditor 側で制御）。
          // step は 'keyed' 固定: 編集中は常に再開可能状態として保存する。
          onPolygonsChange={polys => {
            if (!currentSessionId) return;
            // patchSession は既存レコードへマージするので、スポイトの edits 保存
            // （applyEdits 側）と競合しても片方が消えることはない。
            void patchSession(currentSessionId, {
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
              void patchSession(currentSessionId, {
                step:       'keyed',
                mode:       'custom',
                keyConfig:  { tolerance: appSettings.tolerance },
                polygons:   toSessionPolygons(polys),
                updatedAt:  Date.now(),
                edits:      editsRef.current,
              });
            }
            setPendingPreview(true);
          }}
          onBack={currentPolys => {
            // 離脱時に最終状態を確定保存する。
            // onPolygonsChange の自動保存は操作ごとに void で投げっぱなしのため、
            // 最後の操作後すぐ戻ると未保存のまま抜ける可能性がある。
            // ここで現在の polygons を patchSession することでその隙間を塞ぐ。
            // 既存の自動保存と重複しても merge は冪等なので安全。
            if (currentSessionId) {
              void patchSession(currentSessionId, {
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
          onSave={async (count: number, paths: string[]) => {
            // 書き出し成功 → 統計を加算。「作成したスタンプ」は書き出しが成功した個数で数える
            // （doAutoExport 側と同じ方針。詳細はそちらのコメント参照）。
            recordExportCompleted();
            recordStampsCreated(count);
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
            setSavedLocalUris(paths);
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
          localUris={savedLocalUris}
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

/**
 * App — 画面ツリーの上に起動スプラッシュを重ねるだけのラッパー。
 *
 * 「背景を剥がすとホーム画面が現れる」演出のため、**ホーム画面を先に描画し**、
 * その上に不透明なスプラッシュ層を置いて、演出でその層を削っていく。
 * 演出が終わったらスプラッシュ層だけを外すので、そのまま操作できる。
 *
 * 早期 return だらけの AppScreens を書き換えずに重ねられるよう、包む形にした。
 */
export default function App() {
  const { settings, loaded } = useSettings();
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  // OFF なら最初から出さない。ロード前は DEFAULTS(ON)なので初回フレームから
  // 演出が始まる。判定は store の isSplashEnabled に集約(旧 'off' 値も吸収)。
  //
  // 初回起動(オンボーディング前)はスプラッシュを出さない。ロード完了後に
  // 未オンボと判明したら splashDone を立てて、この起動中は二度と出さない
  // (オンボーディング完了で hasSeenOnboarding が立っても再生しない)。
  // 2回目以降の起動では loaded 前でも従来どおり初回フレームから演出が始まる。
  const firstRun = loaded && !settings.hasSeenOnboarding;
  useEffect(() => {
    if (firstRun) setSplashDone(true);
  }, [firstRun]);
  const showSplash = !splashDone && !firstRun && isSplashEnabled(settings);

  return (
    <View style={styles.appRoot}>
      <AppScreens />
      {/* pointerEvents="none" で演出中も下のホーム画面を操作可能にする。 */}
      {showSplash && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <StatusBar hidden />
          <SplashAnimationView
            animationType={SPLASH_ANIMATION}
            setting={
              settings.splashAnimation === 'off' ? 'auto' : settings.splashAnimation
            }
            onFinish={handleSplashFinish}
          />
        </View>
      )}
    </View>
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
  // スプラッシュを重ねるためのルート。
  appRoot: { flex: 1 },
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
    marginTop: 8,
    marginBottom: 8,
  },
  latestThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: IOS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
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
