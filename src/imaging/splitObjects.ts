import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';

// ── 調整パラメータ ──────────────────────────────────────────────────────────
export const ALPHA_TH = 10;
// 列分割のしきい値は段ごとに自動決定する。MIN_REAL_GAP はその保険:
// 内部gapの最大がこの値未満なら「実質すき間なし=1列」とみなす（誤分割防止）。
export const MIN_REAL_GAP = 6;
export const EMPTY_CELL_RATIO = 0.005;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

// 分割なしモード: 画像全体を1セルとして前景bboxにトリムして返す。
// 段組みでない単体イラスト用（段数で割ると1枚の絵が余白で割れるのを防ぐ）。
export function splitNone(
  rgba: Uint8Array,
  width: number,
  height: number,
): BBox[] {
  const bb = trimToForeground(rgba, width, 0, 0, width, height);
  return bb ? [bb] : [];
}

/**
 * 水平プロジェクションで行数を自動推定する。
 *
 * アルゴリズム:
 *   1. 各Y行に前景ピクセル(alpha > ALPHA_TH)があるか判定。
 *   2. 連続する空白ゾーン（前景なし）のうち、MIN_ROW_GAP px 以上のものをギャップとして採用。
 *   3. 行数 = ギャップ数 + 1（上端・下端の余白は除く）。
 *
 * ※列は行ごとに自動検出（splitRowsThenCols）するため、行数の推定のみをここで担う。
 */
const MIN_ROW_GAP = 8; // px: これ未満の空白は行の区切りとみなさない

export function detectRowCount(
  rgba: Uint8Array,
  width: number,
  height: number,
): number {
  // 各Y行に前景ピクセルがあるか（1 = あり、0 = なし）
  const rowHasFg = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = 0; x < width; x++) {
      if (rgba[(base + x) * 4 + 3] > ALPHA_TH) { rowHasFg[y] = 1; break; }
    }
  }

  // 連続空白ゾーンを列挙し、MIN_ROW_GAP 以上のものだけを行の区切りとする
  let gaps = 0;
  let gapLen = 0;
  let inFg = false; // 前景ゾーンに一度でも入ったか（上端余白をスキップするため）

  for (let y = 0; y < height; y++) {
    if (rowHasFg[y]) {
      if (gapLen >= MIN_ROW_GAP && inFg) gaps++; // 前景→空白→前景 の有効ギャップ
      gapLen = 0;
      inFg = true;
    } else {
      gapLen++;
    }
  }
  // 末尾の下端余白はカウント済みなので追加しない

  return Math.max(1, gaps + 1);
}

/**
 * 行ごとのバンド境界 y 座標を返す（0 と height 自体は含まない）。
 * splitRowsThenCols と同じ等分割式を使うため、線と実際の切り出し位置が必ず一致する。
 */
export function calcRowBoundaries(height: number, rows: number): number[] {
  const bandH = height / rows;
  const result: number[] = [];
  for (let r = 1; r < rows; r++) {
    result.push(Math.round(r * bandH));
  }
  return result;
}

export interface RowColEdges {
  bandTop: number;
  bandBot: number;
  /** findColEdges と同形式: [0, x1, x2, ..., width]。切り目は slice(1,-1) で得る。*/
  edges: number[];
}

/**
 * 各行バンドの列境界 x 座標を返す。計算内容は splitRowsThenCols と同一。
 * SetupScreen の列線プレビューはこの関数を呼ぶ（切り出しは行わない）。
 */
export function calcColEdgesPerRow(
  rgba: Uint8Array,
  width: number,
  height: number,
  rows: number,
): RowColEdges[] {
  const bandH = height / rows;
  const result: RowColEdges[] = [];

  for (let r = 0; r < rows; r++) {
    const bandTop = Math.round(r * bandH);
    const bandBot = Math.round((r + 1) * bandH);

    const colFg = new Uint8Array(width);
    for (let y = bandTop; y < bandBot; y++) {
      const rowBase = y * width;
      for (let x = 0; x < width; x++) {
        if (colFg[x] === 0 && rgba[(rowBase + x) * 4 + 3] > ALPHA_TH) {
          colFg[x] = 1;
        }
      }
    }

    result.push({ bandTop, bandBot, edges: findColEdges(colFg, width, r) });
  }

  return result;
}

export function splitRowsThenCols(
  rgba: Uint8Array,
  width: number,
  height: number,
  rows: number,
): BBox[] {
  const bboxes: BBox[] = [];
  const perRow = calcColEdgesPerRow(rgba, width, height, rows);

  // 【重要】必ず「先に行(段)で切ってから、各段の中だけで列を探す」順序にする。
  // 列検出を画像全体で行うと、縦一直線の空白が無い限り列で切れない（3×3が3枚になるバグ）。
  for (const { bandTop, bandBot, edges: colEdges } of perRow) {
    const bandArea = (bandBot - bandTop) * width;
    for (let ci = 0; ci < colEdges.length - 1; ci++) {
      const bb = trimToForeground(
        rgba, width,
        colEdges[ci], bandTop, colEdges[ci + 1], bandBot,
      );
      if (bb && bb.area / bandArea >= EMPTY_CELL_RATIO) {
        bboxes.push(bb);
      }
    }
  }

  console.log(`[split] total cells: ${bboxes.length}`);
  return bboxes;
}

function findColEdges(colFg: Uint8Array, width: number, rowIdx: number): number[] {
  const gaps: Array<{ start: number; end: number; width: number }> = [];
  let i = 0;

  while (i < width) {
    if (colFg[i] === 0) {
      const start = i;
      while (i < width && colFg[i] === 0) i++;
      const gapW = i - start;
      gaps.push({ start, end: i, width: gapW });
    } else {
      i++;
    }
  }

  const gapWidths = gaps.map(g => g.width);
  if (gapWidths.length > 0) {
    console.log(`[split] row${rowIdx} col gaps: [${gapWidths.join(', ')}]`);
  }

  // 画像端のgapは列の切れ目ではないので除外し、内部gapだけで判断する。
  const innerGaps = gaps.filter(g => g.start !== 0 && g.end !== width);

  // しきい値を段ごとに自動決定: 内部gapの太さを降順ソートし、
  // 隣り合う値の差が最大の所を「スタンプ間」と「文字間/余白」の境目にする。
  // 例: [40,38,9,7,5] → 38と9の差(29)が最大 → 38以上を採用 → 2本切る → 3列。
  let threshold = Infinity;
  if (innerGaps.length > 0) {
    const sorted = innerGaps.map(g => g.width).sort((a, b) => b - a);
    const maxGap = sorted[0];

    if (maxGap < MIN_REAL_GAP) {
      // 内部gapが全てごく小さい → 実質すき間なし=1列扱い（誤分割防止）。
      threshold = Infinity;
    } else if (sorted.length === 1) {
      // 内部gapが1本だけ → そのまま切る。
      threshold = maxGap;
    } else {
      let bestDiff = -1;
      let boundaryLo = maxGap; // 境目より上(太い側)の最小値 = 採用しきい値
      for (let k = 0; k < sorted.length - 1; k++) {
        const diff = sorted[k] - sorted[k + 1];
        if (diff > bestDiff) {
          bestDiff = diff;
          boundaryLo = sorted[k];
        }
      }
      threshold = boundaryLo;
    }
  }

  console.log(`[split] row${rowIdx} auto threshold=${threshold}px (MIN_REAL_GAP=${MIN_REAL_GAP})`);

  const cutGaps = innerGaps.filter(g => g.width >= threshold);

  const edges: number[] = [0];
  for (const g of cutGaps) {
    edges.push(Math.round((g.start + g.end) / 2));
  }
  edges.push(width);

  console.log(`[split] row${rowIdx}: ${edges.length - 1} cols`);
  return edges;
}

export function trimToForeground(
  rgba: Uint8Array,
  srcW: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): BBox | null {
  let minX = right, maxX = left, minY = bottom, maxY = top;
  let area = 0;

  for (let y = top; y < bottom; y++) {
    const rowBase = y * srcW;
    for (let x = left; x < right; x++) {
      if (rgba[(rowBase + x) * 4 + 3] > ALPHA_TH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        area++;
      }
    }
  }

  if (area === 0) return null;
  return { minX, minY, maxX, maxY, area };
}

export function cropToImage(
  rgba: Uint8Array,
  srcW: number,
  bb: BBox,
): SkImage {
  const cropW = bb.maxX - bb.minX + 1;
  const cropH = bb.maxY - bb.minY + 1;
  const cropped = new Uint8Array(cropW * cropH * 4);

  for (let y = 0; y < cropH; y++) {
    const srcOffset = ((bb.minY + y) * srcW + bb.minX) * 4;
    const dstOffset = y * cropW * 4;
    cropped.set(rgba.subarray(srcOffset, srcOffset + cropW * 4), dstOffset);
  }

  const data = Skia.Data.fromBytes(cropped);
  const image = Skia.Image.MakeImage(
    {
      width: cropW,
      height: cropH,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    data,
    cropW * 4,
  );
  if (!image) {
    throw new Error('クロップ画像の生成に失敗しました');
  }
  return image;
}
