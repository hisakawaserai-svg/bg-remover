/**
 * App.tsx
 *
 * 2 つの分割モードを持つ。
 *   モード A「自動分割」: removeBackground → splitRowsThenCols → saveCells
 *   モード B「手動で囲む」: removeBackground → PolygonEditor（多角形描画・書き出し）
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
  detectRowCount,
  cropToImage,
  trimToForeground,
  maskOutsidePolygon,
  saveSkImages,
  addMarginToImage,
} from './src/imaging';
import type { BBox, RemoveBgResult } from './src/imaging';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import type { Cell } from './src/cellTypes';

// ── 手動モードのコンポーネント ────────────────────────────────────────────────
import PolygonEditor from './src/components/PolygonEditor';
import PreviewScreen from './src/components/PreviewScreen';
import type { Polygon } from './src/components/PolygonEditor';

// ── サムネイル一時ファイル書き出し ────────────────────────────────────────────
import RNFS from 'react-native-fs';

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
import type { StickerSession, SessionPolygon, SavedCell } from './src/session/types';

// ── 共通 UI プリミティブ ──────────────────────────────────────────────────────
import Card         from './src/components/ui/Card';
import Chip         from './src/components/ui/Chip';
import HeaderActions from './src/components/ui/HeaderActions';
import AppHeader     from './src/components/ui/AppHeader';

// ── 設定画面 ──────────────────────────────────────────────────────────────────
import SettingsScreen from './src/components/SettingsScreen';
import SavedScreen    from './src/components/SavedScreen';
import HowToScreen   from './src/components/HowToScreen';
import SetupScreen   from './src/components/SetupScreen';
import ResultScreen       from './src/components/ResultScreen';
import SaveCompleteScreen from './src/components/SaveCompleteScreen';
import { useSettings } from './src/settings/SettingsContext';

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
type AppState = 'idle' | 'processing' | 'row_confirm' | 'preview' | 'cell_editing' | 'editing' | 'polygon_preview' | 'settings' | 'saved' | 'howto' | 'done';


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
  if (step === 'done')  return '完了';
  if (step === 'keyed') {
    if (mode === 'custom') return '透過済み（手動）';
    if (mode === 'auto')   return '透過済み（自動）';
    return '透過済み';
  }
  return '未処理';
}
function stepTone(step: StickerSession['step']): 'default' | 'accent' {
  return step === 'done' ? 'default' : 'accent';
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { width: winW, height: winH } = useWindowDimensions();
  const [splitMode, setSplitMode] = useState<SplitMode>('auto');
  const [appState,  setAppState]  = useState<AppState>('idle');
  // 設定画面を開く直前の state を退避し、閉じた時に元の画面へ戻すために使う
  const prevStateRef = useRef<AppState>('idle');

  // 自動分割モード用
  const [rows,        setRows]        = useState(DEFAULT_ROWS);
  // confirmRows: detectRowCount で推定した行数を初期値とし、ユーザーが確認・修正する値。
  // row_confirm 画面でのみ使用。分割実行後はリセットしない（再試行時に再利用）。
  const [confirmRows, setConfirmRows] = useState(DEFAULT_ROWS);
  // cells: 自動分割結果のセル一覧。auto=BBox保持, poly=マスク済みRGBA保持。
  const [cells,     setCells]     = useState<Cell[]>([]);
  // editingCellIdx: cell_editing 中に手動分割中のセルのインデックス
  const [editingCellIdx, setEditingCellIdx] = useState<number | null>(null);

  // 手動モード用（PolygonEditor / PreviewScreen に渡す）
  const [bgResult,  setBgResult]  = useState<RemoveBgResult | null>(null);
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
  const { settings: appSettings, updateSettings } = useSettings();

  // ── セッション管理 ─────────────────────────────────────────────────────────
  // sessions: ホーム一覧に表示するセッション配列（updatedAt 降順）
  const [sessions,          setSessions]          = useState<StickerSession[]>([]);
  // currentSessionId: 現在作業中のセッション id（画像選択〜完了まで持ち回る）
  const [currentSessionId,  setCurrentSessionId]  = useState<string | null>(null);

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
      { title: 'ギャラリーへのアクセス', message: '画像を選択するために必要です。',
        buttonPositive: '許可', buttonNegative: 'キャンセル' },
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  };

  const requestSave = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const perm = (Platform.Version as number) >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    const r = await PermissionsAndroid.request(perm, {
      title: '写真への保存', message: 'ギャラリーへの保存に必要です。',
      buttonPositive: '許可', buttonNegative: 'キャンセル',
    });
    return r === PermissionsAndroid.RESULTS.GRANTED;
  };

  // ── 画像選択 ──────────────────────────────────────────────────────────────

  const pickImage = async () => {
    if (!await requestStorage()) {
      Alert.alert('権限エラー', 'ギャラリーへのアクセスが拒否されました。');
      return;
    }
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 1, selectionLimit: 1 });
    if (result.didCancel || !result.assets?.[0]?.uri) return;

    const uri = result.assets[0].uri;

    // 画像選択直後にセッションを作成（step='picked'）
    // ここで保存しておくことで、アプリを閉じても「選んだ画像」がホーム一覧に残る
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setCurrentSessionId(id);
    await upsertSession({ id, imageUri: uri, step: 'picked', updatedAt: Date.now() });
    void reloadSessions(); // UI を非同期で更新（processImage と並行してよい）

    setSplitMode('auto'); // 新規画像は常に自動モードからスタート
    await processImage(uri);
  };

  // ── 処理（モード共通: removeBackground、その後モード別分岐）──────────────
  // overrideMode: resumeSession から呼ぶ際に保存済みモードを注入する
  // （setState は非同期のため、splitMode state は即座に反映されない）

  const processImage = async (uri: string, overrideMode?: SplitMode, resumePolygons?: Polygon[]) => {
    const effectiveMode = overrideMode ?? splitMode; // ← 追加: overrideMode 優先
    setAppState('processing');
    setBgResult(null);
    setCells([]);
    setEditingCellIdx(null);
    setCurrentImageUri(uri); // done upsert 時に参照する

    try {
      // removeBackground は両モード共通。
      // tolerance は設定画面で変更可能: appSettings.tolerance を使う
      const result = await removeBackground(uri, appSettings.tolerance);

      setBgResult(result);
      if (resumePolygons != null) {
        // 手動セッション再開: 保存済みポリゴンを復元し、編集画面へ直行する。
        // 戻る時は SetupScreen(row_confirm)経由になる(onBack参照)。
        setPolygons(resumePolygons);
        setConfirmRows(detectRowCount(result.rgba, result.width, result.height));
        setAppState('editing');
      } else {
        // 新規選択 / 自動再開: SetupScreen を経由してモードと行数を確認する。
        setConfirmRows(detectRowCount(result.rgba, result.width, result.height));
        setAppState('row_confirm');
      }
    } catch (e: unknown) {
      Alert.alert('処理エラー', e instanceof Error ? e.message : '不明なエラー');
      setAppState('idle');
    }
  };

  // ── 行数確認後の分割実行 ───────────────────────────────────────────────────
  // row_confirm 画面で「この行数で分割」を押した時に呼ぶ。
  // 行はユーザーが指定（n）、各行内の列は splitRowsThenCols が自動検出する。

  const doSplit = useCallback(async (n: number) => {
    if (!bgResult) return;
    const bboxList = splitRowsThenCols(bgResult.rgba, bgResult.width, bgResult.height, n);
    if (bboxList.length === 0) {
      Alert.alert('結果', '前景が検出されませんでした。行数を変えて再試行してください。');
      return;
    }
    const newCells: Cell[] = await Promise.all(bboxList.map(async (bbox, idx) => {
      const raw = cropToImage(bgResult.rgba, bgResult.width, bbox);
      const img = addMarginToImage(raw);
      raw.dispose();
      const thumbUri = await saveThumbToFile(img, currentSessionId ?? undefined, idx);
      img.dispose();
      return { kind: 'auto' as const, bbox, thumbUri };
    }));
    setRows(n);
    setCells(newCells);
    setAppState('preview');

    // 分割完了後にセッションへカット一覧を保存（復元用）
    if (currentSessionId) {
      const savedCells: SavedCell[] = newCells.map(cell => ({
        kind: cell.kind,
        bbox: cell.kind === 'auto' ? cell.bbox : undefined,
        thumbPath: cell.thumbUri,
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows: n },
        autoData: { rows: n, tolerance: appSettings.tolerance, cells: savedCells },
        thumbUri: newCells[0]?.thumbUri,
        updatedAt: Date.now(),
      });
      void reloadSessions();
    }
  }, [bgResult, currentSessionId, currentImageUri, appSettings.tolerance]);

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
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows },
        autoData: { rows, tolerance: appSettings.tolerance, cells: savedCells },
        updatedAt: Date.now(),
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
      }));
      await upsertSession({
        id: currentSessionId,
        imageUri: currentImageUri,
        step: 'keyed',
        mode: 'auto',
        keyConfig: { tolerance: appSettings.tolerance, rows },
        autoData: { rows, tolerance: appSettings.tolerance, cells: savedCells },
        updatedAt: Date.now(),
      });
      void reloadSessions();
    }
  }, [cells, editingCellIdx, bgResult, currentSessionId, currentImageUri, appSettings.tolerance, rows]);

  // ── 自動分割の書き出し ─────────────────────────────────────────────────────

  const doAutoExport = useCallback(async () => {
    if (cells.length === 0) return;
    if (!await requestSave()) {
      Alert.alert('権限エラー', '写真への保存が拒否されました。');
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

      const { count, album } = await saveSkImages(skImages);
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
      Alert.alert('書き出しエラー', e instanceof Error ? e.message : '不明なエラー');
      setAppState('preview');
    }
  }, [bgResult, cells, currentSessionId, currentImageUri, rows, reloadSessions, appSettings.tolerance, appSettings.autoDeleteOnExport]);

  // ── リセット ──────────────────────────────────────────────────────────────

  const reset = () => {
    setBgResult(null);
    setCells([]);
    setEditingCellIdx(null);
    setCurrentSessionId(null);
    setCurrentImageUri('');
    setAppState('idle');
    void reloadSessions(); // ホームに戻ったときセッション一覧を最新化
  };

  // ── セッション操作 ─────────────────────────────────────────────────────────

  // 削除確認 → deleteSession → 一覧再読み込み
  const handleDeleteSession = (id: string) => {
    Alert.alert('削除', 'この作業を削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await deleteSession(id);
          await reloadSessions(); // 削除後に一覧を更新
        },
      },
    ]);
  };

  // セッションの設定を復元して再処理開始
  const resumeSession = async (session: StickerSession) => {
    setCurrentSessionId(session.id);
    const latest = await getSession(session.id) ?? session;
    const mode: SplitMode = latest.mode === 'custom' ? 'manual' : 'auto';
    setSplitMode(mode);
    if (latest.keyConfig?.rows) setRows(latest.keyConfig.rows);

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
              return { kind: 'auto' as const, bbox: savedCell.bbox, thumbUri };
            }
            // poly セル: rgba なしで復元（export 時は thumbUri から再読み込み）
            return { kind: 'poly' as const, thumbUri };
          }),
        );

        setCells(restoredCells);
        setAppState('preview');
      } catch (e: unknown) {
        Alert.alert('復元エラー', e instanceof Error ? e.message : '不明なエラー');
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
        const result = await removeBackground(latest.imageUri, appSettings.tolerance);
        setBgResult(result);
        setConfirmRows(detectRowCount(result.rgba, result.width, result.height));
        setPolygons(latest.polygons?.length ? fromSessionPolygons(latest.polygons) : []);
        setAppState('editing');
      } catch (e: unknown) {
        Alert.alert('復元エラー', e instanceof Error ? e.message : '不明なエラー');
        setAppState('idle');
      }
      return;
    }

    // ── 自動モード・autoData なし: processImage 経由で SetupScreen を表示 ──
    await processImage(latest.imageUri, mode);
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

  // 「最近の書き出し」用: done セッションを最大5件取得。
  // 先頭4件をサムネとして表示し、残りを "+N" で表す。
  const doneSessions  = sessions.filter(s => s.step === 'done');
  const recentDone    = doneSessions.slice(0, 5);   // 表示上限（4枚 + 溢れ分）
  const recentOverflow = doneSessions.length > 4 ? doneSessions.length - 4 : 0;

  // ── レンダー ──────────────────────────────────────────────────────────────

  const isBusy = appState === 'processing';

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

  // ── 設定画面: 全画面で SettingsScreen を表示 ────────────────────────────
  if (appState === 'settings') {
    return (
      <SettingsScreen
        onClose={() => setAppState(prevStateRef.current)}
        onHowTo={() => {
          // 設定→使い方→戻るで設定に戻れるよう prevStateRef を更新してから遷移
          prevStateRef.current = 'settings';
          setAppState('howto');
        }}
      />
    );
  }

  // ── 保存先画面: アルバムのグリッド表示 ──────────────────────────────────
  if (appState === 'saved') {
    return (
      <SavedScreen
        onClose={() => setAppState(prevStateRef.current)}
      />
    );
  }

  if (appState === 'howto') {
    return (
      <HowToScreen
        onClose={() => setAppState(prevStateRef.current)}
      />
    );
  }

  // ── 行数確認画面（自動モード: removeBackground 完了後・分割前）──────────
  if (appState === 'row_confirm' && bgResult) {
    return (
      <SetupScreen
        bgResult={bgResult}
        initialRows={confirmRows}
        initialMode={splitMode}
        onConfirm={(rows, mode) => {
          setSplitMode(mode);
          if (mode === 'auto') {
            doSplit(rows);
          } else {
            setAppState('editing');
          }
        }}
        onBack={() => setAppState('idle')}
        onSettings={goToSettings}
      />
    );
  }

  // ── 自動分割結果確認画面 ────────────────────────────────────────────────────
  if (appState === 'preview' && splitMode === 'auto') {
    return (
      <ResultScreen
        cells={cells}
        originalImageUri={currentImageUri}
        // 復元セッション（bgResult=null）の場合は row_confirm に戻れない → ホームへ
        onBack={() => bgResult ? setAppState('row_confirm') : reset()}
        onHome={reset}
        onSettings={() => goToSettings()}
        onSave={doAutoExport}
        onReSplit={() => doSplit(rows)}
        onManualSplit={() => setAppState('editing')}
        onEditCell={(i) => {
          // poly セル（セッション復元 or 編集済み）はセル編集不可
          if (cells[i]?.kind !== 'auto') return;
          setEditingCellIdx(i);
          setAppState('cell_editing');
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
          // セッション復元時: polygons が空でなければ initialPolygons として渡す。
          // 座標は画像ピクセル基準なのでそのまま渡せる（変換不要）。
          initialPolygons={polygons.length > 0 ? polygons : undefined}
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
          onBack={() => setAppState('editing')}
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
              });
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
          onNewImage={reset}
          onSaved={goToSaved}
          onHome={reset}
          onSettings={goToSettings}
        />
      </>
    );
  }

  const homeHeader = (
    <AppHeader
      title="アイコン抜き"
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
      footer={appState === 'idle' ? (
        <AnimatedPressable
          style={styles.startBtn}
          onPress={pickImage}
          disabled={isBusy}
          pressedScale={0.97}
        >
          <Icon name="add-photo-alternate" size={22} color="#FFF" />
          <Text style={styles.startBtnTxt}>新しい画像を選ぶ</Text>
        </AnimatedPressable>
      ) : undefined}
    >

        {/* ════════════════════════════════════════════════
            HOME 画面（idle 時のみ）
        ════════════════════════════════════════════════ */}
        {appState === 'idle' && (
          <>

            {/* ── 進捗サマリーカード: セッションの有無に関わらず常に表示 ──
                上段: 大きい数値で「作業中 N / 完了 N」を一覧表示。
                下段: 最新の作業中セッションの step を3本バーで可視化。
                セッションなし時は数値0・バー未塗りで表示し、案内文を添える。 */}
            <Card style={styles.progressCard}>
              {/* カードタイトル */}
              <Text style={styles.progressTitle}>作業状況</Text>

              {/* 大きい数値行: 左=作業中、右=完了 */}
              <View style={styles.progressStats}>
                {/* 作業中 */}
                <View style={styles.progressStat}>
                  <Text style={styles.progressStatNum}>{inProgressCount}</Text>
                  <Text style={styles.progressStatLabel}>作業中</Text>
                </View>
                {/* 縦の区切り線 */}
                <View style={styles.progressDivider} />
                {/* 完了 */}
                <View style={styles.progressStat}>
                  <Text style={[styles.progressStatNum, styles.progressStatNumDone]}>
                    {doneCount}
                  </Text>
                  <Text style={styles.progressStatLabel}>完了</Text>
                </View>
              </View>

              {/* 3段階ゲージ: 常に3本表示。塗りは gaugeLevel (0=全空) で決まる */}
              <View style={styles.gaugeRow}>
                <View style={[styles.gaugeBar, gaugeLevel >= 1 && styles.gaugeBarFilled]} />
                <View style={[styles.gaugeBar, gaugeLevel >= 2 && styles.gaugeBarFilled]} />
                <View style={[styles.gaugeBar, gaugeLevel >= 3 && styles.gaugeBarFilled]} />
              </View>
              <View style={styles.gaugeLabelRow}>
                <Text style={styles.gaugeLabel}>選択</Text>
                <Text style={styles.gaugeLabel}>透過</Text>
                <Text style={styles.gaugeLabel}>書き出し</Text>
              </View>

              {/* セッションなし時の案内文 */}
              {sessions.length === 0 && (
                <Text style={styles.progressEmptyHint}>
                  画像を選んで始めましょう
                </Text>
              )}
            </Card>

            {/* セッションなし時: 使い方ガイドを兼ねた空状態コンテンツ */}
            {sessions.length === 0 && (
              <View style={styles.emptyContent}>
                <Icon name="auto-fix-high" size={52} color={IOS.fill} />
                <Text style={styles.emptyContentTitle}>作業はまだありません</Text>
                <Text style={styles.emptyContentDesc}>
                  イラストシートを1枚選ぶだけで{'\n'}
                  キャラクターを自動で切り出せます
                </Text>
                <View style={styles.emptyHints}>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle-outline" size={15} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>PNG・JPEG どちらも対応</Text>
                  </View>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle-outline" size={15} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>背景を自動で透過処理</Text>
                  </View>
                  <View style={styles.emptyHintRow}>
                    <Icon name="check-circle-outline" size={15} color={IOS.blue} />
                    <Text style={styles.emptyHintTxt}>透過 PNG でアルバムに保存</Text>
                  </View>
                </View>
              </View>
            )}

            {sessions.length > 0 && (
              <>
                {/* 続きからリスト */}
                <Text style={styles.sectionLabel}>続きから</Text>
                <Card style={styles.sessionListCard} padding={0}>
                  {sessions.map((session, idx) => {
                    // 日付フォーマット: M/D HH:MM
                    const d = new Date(session.updatedAt);
                    const dateStr = `${d.getMonth() + 1}/${d.getDate()} `
                      + `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

                    return (
                      <React.Fragment key={session.id}>
                        <AnimatedPressable
                          style={styles.sessionRow}
                          onPress={() => void resumeSession(session)}
                          pressedScale={0.98}
                        >
                          {/* サムネイル: thumbUri があればそれを、無ければ元画像を縮小表示 */}
                          <Image
                            source={{ uri: session.thumbUri ?? session.imageUri }}
                            style={styles.sessionThumb}
                            resizeMode="cover"
                          />

                          {/* テキスト情報 */}
                          <View style={styles.sessionInfo}>
                            <Chip label={stepLabel(session.step, session.mode)} tone={stepTone(session.step)} />
                            <Text style={styles.sessionDate}>{dateStr}</Text>
                          </View>

                          {/* 削除ボタン（ゴミ箱アイコン） */}
                          <AnimatedPressable
                            style={styles.sessionDeleteBtn}
                            onPress={() => handleDeleteSession(session.id)}
                          >
                            <Icon name="delete-outline" size={20} color={IOS.secondary} />
                          </AnimatedPressable>
                        </AnimatedPressable>

                        {/* セパレータ（最後の行には引かない） */}
                        {idx < sessions.length - 1 && (
                          <View style={styles.sessionSeparator} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </Card>

                {/* ── 2a: 最近の書き出し ──
                    done セッションが1件以上あるときだけ表示。
                    thumbUri が無い場合は imageUri で代替（グレーの正方形で埋まる）。
                    タップ時は TODO: カメラロールのアルバムを開く API が
                    react-native-camera-roll に存在するか要確認。暫定でアラート。 */}
                {recentDone.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>最近の書き出し</Text>
                    <View style={styles.recentRow}>
                      {recentDone.slice(0, 4).map(s => (
                        <AnimatedPressable
                          key={s.id}
                          style={styles.recentThumbWrap}
                          onPress={() => Alert.alert('書き出し済み', '「アイコン抜き」アルバムに保存されています。')}
                          pressedScale={0.92}
                        >
                          <Image
                            source={{ uri: s.thumbUri ?? s.imageUri }}
                            style={styles.recentThumb}
                            resizeMode="cover"
                          />
                        </AnimatedPressable>
                      ))}
                      {/* 5件目以降は "+N" バッジで件数だけ示す */}
                      {recentOverflow > 0 && (
                        <View style={styles.recentOverflow}>
                          <Text style={styles.recentOverflowTxt}>+{recentOverflow}</Text>
                        </View>
                      )}
                    </View>
                  </>
                )}
              </>
            )}

          </>
        )}

        {/* ── ローディングスピナー ── */}
        {isBusy && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={IOS.blue} />
            <Text style={styles.loadingTxt}>処理しています...</Text>
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

  // ── HOME: セッションリスト（Card 内） ─────────────────────────────────────────
  sessionListCard: {
    width: '100%',
    marginBottom: 16, // カード間 16px で統一（3. 余白調整）
    overflow: 'hidden',  // radius の内側に行を収める
  },

  // ── HOME: 最近の書き出し（2a）──────────────────────────────────────────────
  // done セッションのサムネを横並び4枚 + 溢れ分 "+N" で表示
  recentRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    marginBottom: 16,
  },
  recentThumbWrap: {
    // (全幅 - 左右padding40 - gap*3=24) / 4 ≈ 可変。flex で均等割り
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: IOS.fill,
  },
  recentThumb: {
    width: '100%',
    height: '100%',
  },
  // 5件目以降を示す "+N" バッジ: サムネと同じサイズ感のグレー枠
  recentOverflow: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: IOS.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentOverflowTxt: {
    fontSize: 16,
    fontWeight: '600',
    color: IOS.secondary,
  },

  // ── HOME: クイックアクション（2b）─────────────────────────────────────────
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  sessionThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: IOS.fill,
  },
  sessionInfo: {
    flex: 1,
    gap: 3,
  },
  sessionMeta: {
    fontSize: 12,
    color: IOS.secondary,
  },
  sessionDate: {
    fontSize: 11,
    color: IOS.secondary,
  },
  sessionDeleteBtn: {
    padding: 4,
  },
  sessionSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: IOS.separator,
    marginLeft: 70,  // サムネイル幅(44) + paddingH(14) + gap(12) に揃える
  },

  // ── HOME: セッションなし 空状態コンテンツ ────────────────────────────────
  emptyContent: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyContentTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: IOS.label,
    marginTop: 8,
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
