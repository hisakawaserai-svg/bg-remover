import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { removeBackground, TOLERANCE } from './removeBackground';
import { splitRowsThenCols, splitNone, cropToImage } from './splitObjects';
import type { BBox } from './splitObjects';

export { removeBackground, TOLERANCE } from './removeBackground';
export { splitRowsThenCols, splitRowsThenColsWithLines, splitByBoundaries, splitNone, cropToImage, trimToForeground, detectRowCount, detectColCount, calcRowBoundaries, calcColEdgesPerRow, ALPHA_TH, MIN_REAL_GAP, EMPTY_CELL_RATIO } from './splitObjects';
export type { RowColEdges, SplitLines, SplitResult } from './splitObjects';
export { splitConnected, MIN_AREA, MERGE_GAP } from './splitConnected';
export type { BBox } from './splitObjects';
export type { RemoveBgResult } from './removeBackground';
export { maskOutsidePolygon } from './maskPolygon';

const TARGET_SIZE = 500;
export const ALBUM_NAME = 'スタンプ抜き';

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
): Promise<SaveResult> {
  const bytesList = exportCells(rgba, srcW, bboxes);
  const stamp = Date.now();

  for (let i = 0; i < bytesList.length; i++) {
    // 1) いったんCachesに一時PNGファイルを書く（CameraRollはファイルパスを要求するため）。
    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const tmpPath = `${RNFS.CachesDirectoryPath}/${name}`;
    await RNFS.writeFile(tmpPath, bytesToBase64(bytesList[i]), 'base64');

    // 2) アルバム指定でフォトライブラリ/ギャラリーへ保存（iOS/Android共通）。
    await CameraRoll.saveAsset(`file://${tmpPath}`, {
      type: 'photo',
      album: ALBUM_NAME,
    });

    // 3) 一時ファイルは掃除（保存はギャラリー側に残る）。
    await RNFS.unlink(tmpPath).catch(() => {});
  }

  console.log(`[SAVED] ${bytesList.length} images → album "${ALBUM_NAME}"`);
  return { count: bytesList.length, album: ALBUM_NAME };
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
 * base64 PNG を一時ファイル経由で ALBUM_NAME アルバムに保存する。
 * CameraRoll の呼び出しはここに集約し、PolygonEditor 側には持たせない。
 */
export async function saveStickerPng(base64: string, filename: string): Promise<void> {
  const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;
  // 1) キャッシュに一時 PNG を書き出す
  await RNFS.writeFile(tmpPath, base64, 'base64');
  // 2) ギャラリーのアルバムに保存
  await CameraRoll.saveAsset(`file://${tmpPath}`, { type: 'photo', album: ALBUM_NAME });
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

// レイキャスティング法による点内判定。
function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

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

// 各ポリゴンをマスク済み PNG としてギャラリーに保存する。
export async function savePolygons(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  polygons: Array<{ id: number; points: [number, number][] }>,
): Promise<SaveResult> {
  const stamp = Date.now();
  let count = 0;

  for (let i = 0; i < polygons.length; i++) {
    const masked = cropAndMask(rgba, srcW, srcH, polygons[i].points);
    if (!masked) continue;

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
    if (!img) continue;

    const withMargin = addMarginToImage(img);
    img.dispose();
    const resized = resizeImage(withMargin, TARGET_SIZE);
    const bytes = resized.encodeToBytes();
    withMargin.dispose();
    if (resized !== withMargin) resized.dispose();

    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const tmpPath = `${RNFS.CachesDirectoryPath}/${name}`;
    await RNFS.writeFile(tmpPath, bytesToBase64(bytes), 'base64');
    await CameraRoll.saveAsset(`file://${tmpPath}`, { type: 'photo', album: ALBUM_NAME });
    await RNFS.unlink(tmpPath).catch(() => {});
    count++;
  }

  console.log(`[SAVED] ${count} polygons → album "${ALBUM_NAME}"`);
  return { count, album: ALBUM_NAME };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * SkImage の配列をリサイズしてアルバムに一括保存する。
 * auto/poly 両セルの統一書き出しパス。呼び出し側が dispose 責任を持つ。
 */
export async function saveSkImages(images: SkImage[]): Promise<SaveResult> {
  const stamp = Date.now();
  let count = 0;

  for (let i = 0; i < images.length; i++) {
    const resized = resizeImage(images[i], TARGET_SIZE);
    const bytes = resized.encodeToBytes();
    if (resized !== images[i]) resized.dispose();

    const name = `sticker_${String(i + 1).padStart(2, '0')}_${stamp}.png`;
    const tmpPath = `${RNFS.CachesDirectoryPath}/${name}`;
    await RNFS.writeFile(tmpPath, bytesToBase64(bytes), 'base64');
    await CameraRoll.saveAsset(`file://${tmpPath}`, { type: 'photo', album: ALBUM_NAME });
    await RNFS.unlink(tmpPath).catch(() => {});
    count++;
  }

  console.log(`[SAVED] ${count} images → album "${ALBUM_NAME}"`);
  return { count, album: ALBUM_NAME };
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
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, w, h),
    Skia.XYWHRect(mx, my, w, h),
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

  const scale = Math.min(size / w, size / h, 1); // 拡大はしない。500px超のみ縮小、500px以下は等倍のまま正方キャンバスに配置
  const dstW = w * scale;
  const dstH = h * scale;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, w, h),
    Skia.XYWHRect((size - dstW) / 2, (size - dstH) / 2, dstW, dstH),
    paint,
  );

  const result = surface.makeImageSnapshot();
  surface.dispose();
  return result;
}
