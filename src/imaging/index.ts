import { Skia, ColorType, AlphaType, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { removeBackground, TOLERANCE, removeColorAt, removeBackgroundInPlace } from './removeBackground';
import { applyRestoreStroke, applyEraseStroke } from './restoreBrush';
import type { EditStep } from '../session/types';
import { pointInPolygon } from './maskPolygon';
import { splitRowsThenCols, splitNone, cropToImage } from './splitObjects';
import type { BBox } from './splitObjects';

export { removeBackground, TOLERANCE, removeColorAt, isTransparentAt, loadImagePixels, removeBackgroundInPlace, analyzeExistingTransparency } from './removeBackground';
export type { TransparencyStats } from './removeBackground';
export {
  removeBackgroundVision,
  isVisionBgRemovalSupported,
  markSubjectDetectionUnavailable,
  subscribeSubjectDetectionSupport,
  SubjectDetectionError,
} from './removeBackgroundVision';
export type { SubjectDetectionReason } from './removeBackgroundVision';

/**
 * 元画像の画素に編集操作を順番に掛け直して、現在の見た目を作る（破壊的）。
 *
 * 加工後の画像は保存せず、元画像＋操作列を「正」として毎回ここで再現する。
 * 取り消しは steps を短くして呼び直すだけでよく、巻き戻し用の画像を
 * 抱える必要がない。
 */
export function applyEditSteps(
  rgba: Uint8Array,
  width: number,
  height: number,
  steps: EditStep[],
  /**
   * 元画像の画素。復元ブラシ(restore)と選択範囲だけ再透過(retransRegion)が
   * 必要とする。渡さない場合はどちらも何もしない（元の画素が分からないため）。
   */
  baseRgba?: Uint8Array | null,
  /**
   * true なら復元ブラシ(restore)で RGB も元画像から復元する。
   * 先頭が engine:'vision' の autoBg のときに呼び出し側から渡す。
   * ここで steps[0] を見て自動判定しない理由: applyEdits 側は「追加分の
   * 差分だけ」を steps として渡すことがあり（先頭の autoBg を含まない）、
   * その場合は正しく判定できないため、呼び出し側が常に把握している
   * 完全な操作列から渡してもらう契約にしてある。
   */
  restoreRgb = false,
): void {
  for (const s of steps) {
    if (s.kind === 'autoBg') {
      // engine:'vision' の場合、この関数はネイティブ推論を呼べない（同期関数のため）。
      // 呼び出し側が rgba の初期値として「Vision適用直後の画素」を渡している前提で、
      // ここでは何もしない（既に反映済み）。engine 未指定/'flood' は従来どおり。
      if (s.engine === 'vision') continue;
      removeBackgroundInPlace(rgba, width, height, s.tolerance, s.feather, s.fillHoles ?? false);
    } else if (s.kind === 'restore') {
      if (!baseRgba) continue;
      applyRestoreStroke(rgba, baseRgba, width, height, width, height,
        { points: s.points, radius: s.radius }, 0, 0, restoreRgb);
    } else if (s.kind === 'retransRegion') {
      // 「選択範囲だけ再透過」。矩形を元画像から切り出し、その小さい範囲だけ
      // フラッドフィルし直してから、結果を元の位置へ貼り戻す。矩形の外は
      // 一切触らない（＝「全体を壊さず直せる」）ぶん、四隅が本当に背景で
      // ないと誤動作するので、呼び出し側で十分な余白を付けてもらう前提。
      if (!baseRgba) continue;
      const bw = s.maxX - s.minX + 1;
      const bh = s.maxY - s.minY + 1;
      if (bw <= 0 || bh <= 0) continue;
      const region = new Uint8Array(bw * bh * 4);
      for (let y = 0; y < bh; y++) {
        const srcOff = ((s.minY + y) * width + s.minX) * 4;
        region.set(baseRgba.subarray(srcOff, srcOff + bw * 4), y * bw * 4);
      }
      removeBackgroundInPlace(region, bw, bh, s.tolerance, s.feather, s.fillHoles ?? false);
      if (s.maskPoints && s.maskPoints.length >= 3) {
        // 多角形の内側だけ貼り戻す（矩形の四隅はフラッドフィルの起点として
        // 使っただけで、実際に見た目が変わるのは多角形の内側だけにする）。
        for (let y = 0; y < bh; y++) {
          const imgY = s.minY + y;
          const dstRowOff = imgY * width;
          for (let x = 0; x < bw; x++) {
            const imgX = s.minX + x;
            // ピクセル中心(+0.5)で判定して端部の誤差を減らす（maskOutsidePolygon と同じ）。
            if (!pointInPolygon(imgX + 0.5, imgY + 0.5, s.maskPoints)) continue;
            const srcI = (y * bw + x) * 4;
            const dstI = (dstRowOff + imgX) * 4;
            rgba[dstI] = region[srcI];
            rgba[dstI + 1] = region[srcI + 1];
            rgba[dstI + 2] = region[srcI + 2];
            rgba[dstI + 3] = region[srcI + 3];
          }
        }
      } else {
        for (let y = 0; y < bh; y++) {
          const dstOff = ((s.minY + y) * width + s.minX) * 4;
          rgba.set(region.subarray(y * bw * 4, y * bw * 4 + bw * 4), dstOff);
        }
      }
    } else if (s.kind === 'erase') {
      applyEraseStroke(rgba, width, height, { points: s.points, radius: s.radius });
    } else {
      removeColorAt(rgba, width, height, s.x, s.y, s.tolerance, s.feather);
    }
  }
}
export { splitRowsThenCols, splitRowsThenColsWithLines, splitByBoundaries, splitNone, cropToImage, trimToForeground, detectRowCount, detectColCount, calcRowBoundaries, calcColEdgesPerRow, toleranceToGapParams, ALPHA_TH, MIN_REAL_GAP, EMPTY_CELL_RATIO } from './splitObjects';
export type { RowColEdges, SplitLines, SplitResult } from './splitObjects';
export { splitConnected, MIN_AREA, MERGE_GAP } from './splitConnected';
export type { BBox } from './splitObjects';
export type { RemoveBgResult } from './removeBackground';
export { maskOutsidePolygon, findUncoveredRegions } from './maskPolygon';
export { rebuildCellFromOriginal, cropFromOriginal, isBBoxInside } from './rebuildCell';
export { applyRestoreStroke, applyEraseStroke, densifyStroke, thinStroke } from './restoreBrush';
export { initialRectFromBBox, INIT_PAD_RATIO, INIT_PAD_MIN_RATIO, INIT_PAD_MIN_PX } from './polygonInit';
export type { RestoreStroke } from './restoreBrush';
export type { CellBBox, RebuildOptions } from './rebuildCell';
export type { UncoveredRegion } from './maskPolygon';

const TARGET_SIZE = 500;
// アルバム名は呼び出し側（settings の useAlbumName）から渡す。
// 「初回保存時の言語で決めて固定」という規則をここに持ち込まないための分離
// （imaging は React の外なので設定を読めない）。

// 元画像の永続保存先ディレクトリ（DocumentDirectory 配下）。
export const SOURCE_DIR = `${RNFS.DocumentDirectoryPath}/sources`;

/**
 * 画像ピッカーが返す一時ファイル（CachesDirectory の rn_image_picker_lib_temp_*）は
 * OS にいつでも削除され得るため、DocumentDirectory へコピーして永続化する。
 * これをしないと「続きから」再開時に元画像が消えており、removeBackground が
 * 無限ローディングになる。返り値は永続パスの file:// URI。
 * コピーに失敗した場合は元の URI をそのまま返す（新規処理は続行できるため）。
 */
export async function persistSourceImage(srcUri: string, id: string): Promise<string> {
  const srcPath = srcUri.startsWith('file://') ? srcUri.slice('file://'.length) : srcUri;
  // content:// 等ファイルパスでないものはコピーできないのでそのまま返す。
  if (!srcUri.startsWith('file://')) return srcUri;

  const rawExt = srcPath.split('/').pop()?.split('.').pop() ?? '';
  const ext = /^[A-Za-z0-9]{1,5}$/.test(rawExt) ? rawExt.toLowerCase() : 'png';
  const destPath = `${SOURCE_DIR}/${id}.${ext}`;
  try {
    await RNFS.mkdir(SOURCE_DIR);
    if (await RNFS.exists(destPath)) {
      await RNFS.unlink(destPath);
    }
    await RNFS.copyFile(srcPath, destPath);
    return `file://${destPath}`;
  } catch (e) {
    console.warn('[persistSourceImage] コピー失敗、元URIを使用:', e);
    return srcUri;
  }
}

export interface SaveResult {
  count: number;
  album: string;
  /**
   * 書き出した PNG のローカルパス（file:// URI）。
   *
   * ギャラリー保存後もファイルを消さずに残す。保存完了画面の表示と共有に使う。
   * CameraRoll が返す ph:// は
   *   - 表示時にアルファが白へ潰れる（背景色設定が効かないように見える）
   *   - 共有シートがファイルではなくリンクとして扱う（「N Links」になる）
   * ため、書き出した実ファイルを持っておく必要がある。
   */
  paths: string[];
}

/**
 * 書き出した PNG を保存完了画面まで残しておくディレクトリ。
 * Caches 配下なので OS に消されても構わない（消えたら CameraRoll へフォールバックする）。
 */
export const EXPORT_DIR = `${RNFS.CachesDirectoryPath}/exports`;

/**
 * 書き出し用ディレクトリを空にして作り直す。
 * 前回の書き出しぶんが残っていると、保存完了画面に古い画像が混ざるため
 * 各書き出しの先頭で必ず呼ぶ。
 */
async function prepareExportDir(): Promise<void> {
  try {
    if (await RNFS.exists(EXPORT_DIR)) await RNFS.unlink(EXPORT_DIR);
  } catch (e) {
    console.warn('[imaging] failed to clear export dir', e);
  }
  await RNFS.mkdir(EXPORT_DIR);
}

// Uint8Array を base64 文字列に変換（RNFS の base64 書き込み用）。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const len = bytes.length;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

// 各セルをリサイズ済み透過PNGにし、ギャラリー(写真アプリ)のアルバム「スタンプ抜き」へ保存する。
// AirDropやLINE スタンプ Makerの写真選択からそのまま選べるようにするのが狙い。
export async function saveCells(
  rgba: Uint8Array,
  srcW: number,
  bboxes: BBox[],
  album: string,
): Promise<SaveResult> {
  const bytesList = exportCells(rgba, srcW, bboxes);
  const stamp = Date.now();
  const paths: string[] = [];

  await prepareExportDir();

  for (let i = 0; i < bytesList.length; i++) {
    // 1) 書き出し用ディレクトリに PNG を書く（CameraRollはファイルパスを要求するため）。
    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const outPath = `${EXPORT_DIR}/${name}`;
    await RNFS.writeFile(outPath, bytesToBase64(bytesList[i]), 'base64');

    // 2) アルバム指定でフォトライブラリ/ギャラリーへ保存（iOS/Android共通）。
    await CameraRoll.saveAsset(`file://${outPath}`, {
      type: 'photo',
      album,
    });

    // 3) 保存後もファイルは残す。保存完了画面の表示と共有がこれを使う。
    paths.push(`file://${outPath}`);
  }

  console.log(`[SAVED] ${bytesList.length} images → album "${album}"`);
  return { count: bytesList.length, album, paths };
}

// ── PolygonEditor 向け保存ユーティリティ ──────────────────────────────────────

/**
 * 日付文字列を YYYYMMDD_HHMMSS 形式で返す。
 * PolygonEditor のファイル名生成に使用。
 */
export function makeDateStr(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // 例: "20260622_153045"
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
       + `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * base64 PNG を一時ファイル経由で指定アルバムに保存する。
 * CameraRoll の呼び出しはここに集約し、PolygonEditor 側には持たせない。
 */
export async function saveStickerPng(base64: string, filename: string, album: string): Promise<void> {
  const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;
  // 1) キャッシュに一時 PNG を書き出す
  await RNFS.writeFile(tmpPath, base64, 'base64');
  // 2) ギャラリーのアルバムに保存
  await CameraRoll.saveAsset(`file://${tmpPath}`, { type: 'photo', album });
  // 3) 一時ファイルを削除
  await RNFS.unlink(tmpPath).catch(() => {});
}

export function exportCells(
  rgba: Uint8Array,
  srcW: number,
  bboxes: BBox[],
): Uint8Array[] {
  return bboxes.map(bb => {
    const img = cropToImage(rgba, srcW, bb);
    const resized = resizeImage(img, TARGET_SIZE);
    const bytes = resized.encodeToBytes();
    img.dispose();
    if (resized !== img) resized.dispose();
    return bytes;
  });
}

// ── ポリゴンマスク書き出し ────────────────────────────────────────────────────

// 多角形の外接矩形を切り出し、外側ピクセルの alpha を 0 にする。
function cropAndMask(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  points: [number, number][],
): { bytes: Uint8Array; w: number; h: number } | null {
  if (points.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const left   = Math.max(0, Math.floor(minX));
  const top    = Math.max(0, Math.floor(minY));
  const right  = Math.min(srcW - 1, Math.ceil(maxX));
  const bottom = Math.min(srcH - 1, Math.ceil(maxY));
  const cropW  = right - left + 1;
  const cropH  = bottom - top + 1;
  if (cropW <= 0 || cropH <= 0) return null;

  const bytes = new Uint8Array(cropW * cropH * 4);
  for (let row = 0; row < cropH; row++) {
    for (let col = 0; col < cropW; col++) {
      const imgX = left + col;
      const imgY = top + row;
      const srcIdx = (imgY * srcW + imgX) * 4;
      const dstIdx = (row * cropW + col) * 4;
      bytes[dstIdx]     = rgba[srcIdx];
      bytes[dstIdx + 1] = rgba[srcIdx + 1];
      bytes[dstIdx + 2] = rgba[srcIdx + 2];
      // ピクセル中心(+0.5)で判定して端部の誤差を最小化。
      bytes[dstIdx + 3] = pointInPolygon(imgX + 0.5, imgY + 0.5, points)
        ? rgba[srcIdx + 3]
        : 0;
    }
  }
  return { bytes, w: cropW, h: cropH };
}

/**
 * 1ポリゴンを保存と同じ経路（切り出し・余白・TARGET_SIZE）で PNG にする。
 * PreviewScreen と savePolygons が同じ画素を見るために共通化する。
 */
function encodePolygonExportPng(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  points: [number, number][],
): Uint8Array | null {
  const masked = cropAndMask(rgba, srcW, srcH, points);
  if (!masked) return null;

  const data = Skia.Data.fromBytes(masked.bytes);
  const img = Skia.Image.MakeImage(
    {
      width: masked.w,
      height: masked.h,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    data,
    masked.w * 4,
  );
  if (!img) return null;

  const withMargin = addMarginToImage(img);
  img.dispose();
  const resized = resizeImage(withMargin, TARGET_SIZE);
  const bytes = resized.encodeToBytes();
  withMargin.dispose();
  if (resized !== withMargin) resized.dispose();
  return bytes;
}

/** 範囲調整後プレビュー用。Caches 配下なので OS に消されても構わない。 */
export const PREVIEW_DIR = `${RNFS.CachesDirectoryPath}/preview`;

export async function clearPreviewDir(): Promise<void> {
  try {
    if (await RNFS.exists(PREVIEW_DIR)) await RNFS.unlink(PREVIEW_DIR);
  } catch (e) {
    console.warn('[imaging] failed to clear preview dir', e);
  }
}

/**
 * 保存と同じ PNG をプレビュー用ディレクトリに書き、file:// URI を返す。
 * 失敗したポリゴンは null。isCancelled が true なら途中でやめてディレクトリを空にする。
 */
export async function writePreviewPolygons(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  polygons: Array<{ points: [number, number][] }>,
  isCancelled?: () => boolean,
): Promise<(string | null)[]> {
  await clearPreviewDir();
  await RNFS.mkdir(PREVIEW_DIR);
  const stamp = Date.now();
  const uris: (string | null)[] = [];

  for (let i = 0; i < polygons.length; i++) {
    if (isCancelled?.()) {
      await clearPreviewDir();
      return [];
    }
    const bytes = encodePolygonExportPng(rgba, srcW, srcH, polygons[i].points);
    if (!bytes) {
      uris.push(null);
      continue;
    }
    const name = `preview_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const outPath = `${PREVIEW_DIR}/${name}`;
    await RNFS.writeFile(outPath, bytesToBase64(bytes), 'base64');
    uris.push(`file://${outPath}`);
  }
  return uris;
}

// 各ポリゴンをマスク済み PNG としてギャラリーに保存する。
export async function savePolygons(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  polygons: Array<{ id: number; points: [number, number][] }>,
  album: string,
): Promise<SaveResult> {
  const stamp = Date.now();
  const paths: string[] = [];
  let count = 0;

  await prepareExportDir();

  for (let i = 0; i < polygons.length; i++) {
    const bytes = encodePolygonExportPng(rgba, srcW, srcH, polygons[i].points);
    if (!bytes) continue;

    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const outPath = `${EXPORT_DIR}/${name}`;
    await RNFS.writeFile(outPath, bytesToBase64(bytes), 'base64');
    await CameraRoll.saveAsset(`file://${outPath}`, { type: 'photo', album });
    paths.push(`file://${outPath}`);
    count++;
  }

  console.log(`[SAVED] ${count} polygons → album "${album}"`);
  return { count, album, paths };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * セルごとの SkImage を1件ずつ生成させながらリサイズ・アルバム保存する。
 * auto/poly 両セルの統一書き出しパス。
 *
 * 【設計】builders は「SkImage を作る関数」の配列（まだ作っていない）。
 * 全件を先に Promise.all で作ってから保存すると、カット数が多いシートで
 * フル解像度 SkImage が同時に何十枚も Native メモリへ載ってしまい、
 * 実機で OOM 強制終了する原因になっていた（savePolygons は元々1件ずつ
 * 生成→保存→dispose だったのに、こちらだけ一括生成になっていた）。
 * ここで1件ずつ「生成→リサイズ→書き込み→dispose」を回すことで、
 * 常に高々1枚ぶん（フル解像度＋リサイズ後）のメモリしか使わないようにする。
 */
export async function saveSkImages(
  builders: Array<() => Promise<SkImage> | SkImage>,
  album: string,
): Promise<SaveResult> {
  const stamp = Date.now();
  const paths: string[] = [];
  let count = 0;

  await prepareExportDir();

  for (let i = 0; i < builders.length; i++) {
    const img = await builders[i]();
    const resized = resizeImage(img, TARGET_SIZE);
    const bytes = resized.encodeToBytes();
    if (resized !== img) resized.dispose();
    img.dispose();

    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const outPath = `${EXPORT_DIR}/${name}`;
    await RNFS.writeFile(outPath, bytesToBase64(bytes), 'base64');
    await CameraRoll.saveAsset(`file://${outPath}`, { type: 'photo', album });
    // 保存後も消さない。保存完了画面の表示と共有がこのファイルを使う。
    paths.push(`file://${outPath}`);
    count++;
  }

  console.log(`[SAVED] ${count} images → album "${album}"`);
  return { count, album, paths };
}

/**
 * 出力画像に付与する比率マージン（全経路: 自動/合体/手動 共通の単一の出所）。
 * 幅/高さ それぞれのこの割合を左右・上下に足す。微調整はこの値だけ変える。
 */
export const OUTPUT_MARGIN_RATIO = 0.04;

/**
 * SkImage の四辺に透明マージンを追加して返す。
 * ratio = 0.04 なら 幅/高さ それぞれの 4% を左右・上下に足す。
 * 絵のサイズに比例するため大小関係なくマージンの見た目が揃う。
 * 呼び出し側は元の image を dispose する責任を持つ。
 */
export function addMarginToImage(image: SkImage, ratio = OUTPUT_MARGIN_RATIO): SkImage {
  const w = image.width();
  const h = image.height();
  const mx = Math.round(w * ratio);
  const my = Math.round(h * ratio);
  const newW = w + mx * 2;
  const newH = h + my * 2;

  const surface = Skia.Surface.Make(newW, newH)!;
  const canvas  = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  // 等倍配置なので補間は効かないが、サンプリング指定は resizeImage と揃えておく。
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, w, h),
    Skia.XYWHRect(mx, my, w, h),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );

  const result = surface.makeImageSnapshot();
  surface.dispose();
  return result;
}

function resizeImage(image: SkImage, size: number): SkImage {
  const w = image.width();
  const h = image.height();

  const surface = Skia.Surface.Make(size, size)!;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const scale = Math.min(size / w, size / h); // 縮小も拡大も行い、常にキャンバスいっぱいにフィットさせる
  const dstW = w * scale;
  const dstH = h * scale;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  // 【drawImageRect ではなく drawImageRectOptions を使う】
  // drawImageRect は SkSamplingOptions() の既定 = ニアレストネイバーで拡縮する。
  // paint.setAntiAlias(true) は図形の縁にしか効かず、画像のサンプリングには無関係なので、
  // これだけだと拡大時に階段状（ガビガビ）になる。書き出しは 500px へ拡大することが
  // 多いので影響が大きい。Linear を明示して補間させる。
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, w, h),
    Skia.XYWHRect((size - dstW) / 2, (size - dstH) / 2, dstW, dstH),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );

  const result = surface.makeImageSnapshot();
  surface.dispose();
  return result;
}
