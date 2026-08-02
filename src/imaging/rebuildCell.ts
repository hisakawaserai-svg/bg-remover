/**
 * rebuildCell.ts — 分割後のセル1枚を、元画像から作り直す。
 *
 * 【なぜ元画像から作り直すのか】
 * 透過済みの画像を再処理してはいけない。背景除去は alpha を 0 にする破壊的な操作で、
 * 一度消した画素の色は復元できないため、そこから「弱く」掛け直しても消えたものは
 * 戻らない。強くする方向にしか動けず、「透過しすぎた」を直せない。
 * 元画像の該当セル領域を切り出して掛け直せば、強くも弱くも自由に調整できる。
 *
 * 【スポイトの扱い】
 * 操作列（EditStep）は元画像1枚に対する記録なので、セルを作り直したときも
 * そのセル範囲に掛かるスポイトは掛け直す必要がある。そうしないと、セルだけ
 * スポイトの結果が巻き戻って見える。座標をセル内に変換し、範囲外は捨てる。
 */
import { removeBackgroundInPlace, removeColorAt, TOLERANCE } from './removeBackground';
import type { EditStep } from '../session/types';
import type { RemoveBgResult } from './removeBackground';

export interface CellBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 元画像から矩形を切り出す（コピー）。 */
export function cropFromOriginal(
  baseRgba: Uint8Array,
  width: number,
  bbox: CellBBox,
): RemoveBgResult {
  const subW = bbox.maxX - bbox.minX + 1;
  const subH = bbox.maxY - bbox.minY + 1;
  const rgba = new Uint8Array(subW * subH * 4);
  for (let y = 0; y < subH; y++) {
    const srcOff = ((bbox.minY + y) * width + bbox.minX) * 4;
    rgba.set(baseRgba.subarray(srcOff, srcOff + subW * 4), y * subW * 4);
  }
  return { rgba, width: subW, height: subH };
}

export interface RebuildOptions {
  /** 背景除去の許容値。セルごとに変えられる（これが「透過強度」）。 */
  tolerance?: number;
  feather?: boolean;
  fillHoles?: boolean;
  /**
   * 元画像に対する操作列。autoBg は tolerance で置き換えるので無視し、
   * eyedrop だけをセル座標へ移して掛け直す。
   */
  steps?: EditStep[];
}

/**
 * セル1枚を元画像から作り直す。
 *
 * baseRgba は「背景除去前の元画像」であること。透過済みのバッファを渡すと
 * この関数の意味がなくなる（消えた画素は戻らない）。
 */
export function rebuildCellFromOriginal(
  baseRgba: Uint8Array,
  width: number,
  height: number,
  bbox: CellBBox,
  opts: RebuildOptions = {},
): RemoveBgResult {
  const {
    tolerance = TOLERANCE,
    feather = true,
    fillHoles = false,
    steps = [],
  } = opts;

  const cell = cropFromOriginal(baseRgba, width, bbox);

  // 切り出してから掛けるので、背景色の推定もセル内の端から行われる。
  // シート全体で推定するより、そのセルの実際の背景に素直に追従する。
  removeBackgroundInPlace(cell.rgba, cell.width, cell.height, tolerance, feather, fillHoles);

  // スポイトを掛け直す。autoBg は上で tolerance 指定のものに置き換えたので飛ばす。
  for (const s of steps) {
    if (s.kind !== 'eyedrop') continue;
    const x = s.x - bbox.minX;
    const y = s.y - bbox.minY;
    // セルの外を狙ったスポイトは、このセルには関係ないので捨てる。
    // クランプすると端の色を巻き込んで消してしまうため、範囲外は必ず捨てる。
    if (x < 0 || y < 0 || x >= cell.width || y >= cell.height) continue;
    removeColorAt(cell.rgba, cell.width, cell.height, x, y, s.tolerance, s.feather);
  }

  return cell;
}

// height は現状使っていないが、呼び出し側が bbox の妥当性を検証できるよう受け取る。
export function isBBoxInside(bbox: CellBBox, width: number, height: number): boolean {
  return bbox.minX >= 0 && bbox.minY >= 0
    && bbox.maxX < width && bbox.maxY < height
    && bbox.minX <= bbox.maxX && bbox.minY <= bbox.maxY;
}
