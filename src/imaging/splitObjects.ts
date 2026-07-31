import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import { t } from '../i18n';

// ── 調整パラメータ ──────────────────────────────────────────────────────────
export const ALPHA_TH = 10;
// 列分割のしきい値は段ごとに自動決定する。MIN_REAL_GAP はその保険:
// 内部gapの最大がこの値未満なら「実質すき間なし=1列」とみなす（誤分割防止）。
export const MIN_REAL_GAP = 6;
export const EMPTY_CELL_RATIO = 0.005;
// 隙間の相対差(比率)がこの値以上開いた場所を「本物の隙間とノイズの境目」とみなす。
// 0.3 = 30%。値が近い隙間同士(例: 144と136, 差5.6%)は同じグループとして両方採用する。
export const RELATIVE_GAP_THRESHOLD = 0.3;

/**
 * 「分割の細かさ」スライダー(tolerance 0〜100)を列検出のしきい値へ変換する。
 *
 * 列検出は MIN_REAL_GAP（これ未満の隙間は無視＝1列扱い）と
 * RELATIVE_GAP_THRESHOLD（本物の隙間とノイズを分ける相対差）で粗さが決まるので、
 * スライダーはこの2値を動かす形で効かせる。粗い側ほど「大きな隙間しか切らない」、
 * 細かい側ほど「小さな隙間でも切る」。
 *
 * スライダーの目盛り(粗い15 / 中30 / 細かい50)を通る折れ線で線形補間し、
 * 目盛りの外は同じ傾きのまま延長してからクランプする。
 * 【重要】tolerance=30（既定値・目盛り「中」）で既存定数と完全に一致させてある
 * （MIN_REAL_GAP=6, RELATIVE_GAP_THRESHOLD=0.3）。既定のままなら従来と同じ結果になる。
 */
export function toleranceToGapParams(
  tolerance: number,
): { minRealGap: number; relativeGapThreshold: number } {
  // 折れ線補間の共通処理。2値で増減の向きが逆なので、向きは各制御点側で表現する。
  const lerpFromPoints = (t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    // 中点(x1)はそのまま返す。ここを補間式に通すと浮動小数の誤差で 6 が 5.999... に
    // なり得るため、既定値(tolerance=30)で既存定数と完全一致させる保証を優先する。
    if (t === x1) return y1;
    // t < x1 側は (x0,y0)-(x1,y1) の傾き、t > x1 側は (x1,y1)-(x2,y2) の傾きを
    // そのまま外側にも延長する（範囲外でも段差なく繋がる）。
    return t < x1
      ? y1 + ((y1 - y0) / (x1 - x0)) * (t - x1)
      : y1 + ((y2 - y1) / (x2 - x1)) * (t - x1);
  };
  const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // 粗い15→10px, 中30→6px(=MIN_REAL_GAP), 細かい50→3px
  const minRealGap = clampNum(lerpFromPoints(tolerance, 15, 10, 30, 6, 50, 3), 2, 14);
  // 粗い15→0.15, 中30→0.30(=RELATIVE_GAP_THRESHOLD), 細かい50→0.45
  //
  // 【向きに注意】minRealGap とは増減が逆になる。relativeGapThreshold は
  // 「隙間の大小差がこの値以上開いた所を本物とノイズの境目にする」しきい値なので、
  // 値を上げるほど境目が見つからず、結果として全ての隙間が採用されて列が増える。
  // つまり「粗い＝列を減らす」に揃えるには、粗い側で値を下げる必要がある。
  // (実測: 隙間20pxと12pxが混在する画像で 0.45→3列 / 0.30→2列 / 0.15→2列)
  const relativeGapThreshold = clampNum(lerpFromPoints(tolerance, 15, 0.15, 30, 0.3, 50, 0.45), 0.1, 0.6);

  return { minRealGap, relativeGapThreshold };
}

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

/**
 * 列数を自動推定する（列数ステッパーの初期値用）。
 *
 * calcColEdgesPerRow（cols 無し）で列数を求める。列は全幅共通に統一済みのため
 * 全段で同じ列数になり、実質その共通列数をそのまま返す。
 * （全幅共通化以前は段ごとに列数がブレたため最頻値を採っていた名残でロジックは mode のまま。
 *   同数で並んでも安全側に倒れるよう多い方を優先する。）
 * detectRowCount と対になる関数で、SetupScreen の列数ステッパー初期値に使う。
 */
export function detectColCount(
  rgba: Uint8Array,
  width: number,
  height: number,
  rows: number,
  // 「分割の細かさ」スライダー由来のしきい値（toleranceToGapParams の返り値）。
  // 省略時は既存定数＝従来の挙動そのまま。
  minRealGap: number = MIN_REAL_GAP,
  relativeGapThreshold: number = RELATIVE_GAP_THRESHOLD,
): number {
  // cols を渡さない＝従来の自動検出。ここで等分してしまうと推定にならない。
  const perRow = calcColEdgesPerRow(rgba, width, height, rows, undefined, minRealGap, relativeGapThreshold);
  const counts = perRow.map(({ edges }) => edges.length - 1);
  if (counts.length === 0) return 1;

  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);

  let best = 1;
  let bestFreq = -1;
  for (const [c, f] of freq) {
    if (f > bestFreq || (f === bestFreq && c > best)) {
      best = c;
      bestFreq = f;
    }
  }
  return Math.max(1, best);
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
  cols?: number, // 列数の手動指定。正の整数なら自動検出せず段の横幅を等分する
  // 列検出のしきい値（「分割の細かさ」スライダー由来）。省略時は既存定数＝従来の挙動。
  minRealGap: number = MIN_REAL_GAP,
  relativeGapThreshold: number = RELATIVE_GAP_THRESHOLD,
): RowColEdges[] {
  const bandH = height / rows;
  const result: RowColEdges[] = [];

  // 列数が手動指定されているか判定。0/NaN/undefined は「自動」扱い（後方互換）。
  const useFixedCols = typeof cols === 'number' && Number.isInteger(cols) && cols > 0;

  // 行の帯(bandTop/bandBot)を先に確定する。行ロジック(rowBoundaries)はここでは一切変えない。
  const bands: Array<{ bandTop: number; bandBot: number }> = [];
  for (let r = 0; r < rows; r++) {
    bands.push({ bandTop: Math.round(r * bandH), bandBot: Math.round((r + 1) * bandH) });
  }

  // 全幅共通の縦線 x配列を1セット決める。横線(行)が全幅共通なのと同じモデルに列も揃える。
  let commonEdges: number[];
  if (useFixedCols) {
    // 手動指定: 段の横幅(0..width)を cols 等分する（不変）。
    // calcRowBoundaries が height を rows 等分するのと同じ考え方。
    // findColEdges の返り値と同形式 [0, x1, ..., width] に揃える（下流が形式依存のため）。
    commonEdges = [0];
    for (let c = 1; c < cols!; c++) {
      commonEdges.push(Math.round((c * width) / cols!));
    }
    commonEdges.push(width);
  } else {
    // 自動: 「段ごとに列検出 → 結果を集約して全幅共通の縦線にする」（方向A）。
    // 全段を縦に重ねた OR 投影で1回検出すると、段間の水平ズレで列間corridorが塞がり
    // 列が1に縮退する回帰が出た。段ごとに検出すれば段内ではcorridorが保たれて堅い。
    // しきい値は段内検出(findColEdges)の既存の自動決定ロジックをそのまま使う（新規定数なし）。
    const perBandEdges = bands.map(({ bandTop, bandBot }, r) => {
      const colFg = new Uint8Array(width);
      for (let y = bandTop; y < bandBot; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
          if (colFg[x] === 0 && rgba[(rowBase + x) * 4 + 3] > ALPHA_TH) {
            colFg[x] = 1;
          }
        }
      }
      return findColEdges(colFg, width, r, minRealGap, relativeGapThreshold);
    });
    commonEdges = aggregateColEdges(perBandEdges, width);
  }

  // 全段に同一の全幅共通 x を適用する。各段が独立した配列を持てるよう複製する
  // （後段のドラッグ編集で段別に触っても他段へ影響しないための安全策。値はどの段も同一）。
  for (const { bandTop, bandBot } of bands) {
    result.push({ bandTop, bandBot, edges: commonEdges.slice() });
  }

  return result;
}

/**
 * 段ごとの列エッジ群を、全幅共通の単一縦線セット [0, ...共通縦線, width] に集約する（方向A）。
 * edgesPerBand: 各段の findColEdges 結果 [0, x1, ..., width]。
 */
function aggregateColEdges(edgesPerBand: number[][], width: number): number[] {
  // 各段の「内部縦線（端 0/width を除く切り目）」を取り出す。本数 = その段の列数 - 1。
  const innerPerBand = edgesPerBand.map(e => e.slice(1, -1));
  const lineCounts = innerPerBand.map(inner => inner.length);

  // (a) 共通の内部縦線本数を最頻値(mode)で決める。
  //     段ごとに歪み等で本数がブレても、最も多くの段が支持した割り方に揃えるため mode を使う。
  //     タイ（同頻度）時は本数が多い側を採用する: スタンプ用途では割りすぎは後で合体で
  //     復旧できるが、割り足りないと2枚が1枚に結合して詰むため、多い側に倒すのが安全。
  const freq = new Map<number, number>();
  for (const c of lineCounts) freq.set(c, (freq.get(c) ?? 0) + 1);
  let targetLines = 0;
  let bestFreq = -1;
  for (const [c, f] of freq) {
    if (f > bestFreq || (f === bestFreq && c > targetLines)) {
      targetLines = c;
      bestFreq = f;
    }
  }

  console.log(`[split] per-band lineCounts: [${lineCounts.join(', ')}] → common cols=${targetLines + 1}`);

  // 内部縦線0本（全段が「1列」を支持）→ 縦線なし＝端のみ。
  if (targetLines === 0) return [0, width];

  // (b) 共通の縦線位置を決める。
  //     対象は採用本数 targetLines に一致した段だけ（本数が違う段は左からn本目の対応が
  //     取れないため位置集約から除外。ただし(a)の本数集計には参加済み）。
  const matched = innerPerBand.filter(inner => inner.length === targetLines);

  const common: number[] = [];
  for (let k = 0; k < targetLines; k++) {
    // 左から k 本目の縦線 x を対象段から集める。
    const xs = matched.map(inner => inner[k]).sort((a, b) => a - b);
    // 平均でなく中央値を採る: 歪んだ段や外れ値の x に引っ張られにくく、
    // 多数の段がほぼ揃えた位置にロバストに合わせられるため。
    common.push(median(xs));
  }

  console.log(`[split] aggregated common col x: [${common.join(', ')}]`);
  return [0, ...common, width];
}

/** ソート済み配列の中央値（偶数個は中央2値の平均を整数化）。位置集約のロバスト統計用。 */
function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 分割で実際に使った境界線データ。
 * 次段階の「自動検出した分割線を指で動かして直す」編集UIの入力にするための“線データ”。
 *
 * - rowBoundaries: 行(段)の境界 y のリスト（画像座標系）。全幅共通＝列に依らず1本の横線。
 *     端（0 と height）は含めない。切り出しに使った各段の上端そのものを並べる。
 * - colBoundaries: 列の境界 x のリスト（画像座標系）。列も全幅共通に統一したため、
 *     段に依らず1本の縦線として単一 x配列で持つ（rowBoundaries と対称なモデル）。
 *     端（0 と width）は含めない。次段階のドラッグUIが共通縦線を前提にするための形。
 */
export interface SplitLines {
  rowBoundaries: number[];
  colBoundaries: number[];
}

/** 切り出し結果(bboxes)と、その切り出しに使った境界線(lines)をまとめて返す。 */
export interface SplitResult {
  bboxes: BBox[];
  lines: SplitLines;
}

/**
 * 後方互換ラッパ: 従来通りカット結果(BBox[])だけを返す。
 * 境界線データも必要な呼び出し側は splitRowsThenColsWithLines を使う。
 * カット結果は splitRowsThenColsWithLines と完全に同一（同じ loop の bboxes をそのまま返す）。
 */
export function splitRowsThenCols(
  rgba: Uint8Array,
  width: number,
  height: number,
  rows: number,
  cols?: number, // 列数の手動指定。calcColEdgesPerRow にそのまま渡すだけ
): BBox[] {
  return splitRowsThenColsWithLines(rgba, width, height, rows, cols).bboxes;
}

/**
 * splitRowsThenCols と同じ切り出しを行い、結果に加えて「検出した境界線」も返す。
 * 切り出しロジック（順序・しきい値・EMPTY_CELL_RATIO 判定）は一切変えていないため、
 * bboxes は従来の splitRowsThenCols と完全に一致する（回帰なし）。
 */
export function splitRowsThenColsWithLines(
  rgba: Uint8Array,
  width: number,
  height: number,
  rows: number,
  cols?: number, // 列数の手動指定。calcColEdgesPerRow にそのまま渡すだけ
): SplitResult {
  const bboxes: BBox[] = [];
  // 「先に行で切ってから各段で列」の順序は不変。cols は列の決め方だけを変える。
  const perRow = calcColEdgesPerRow(rgba, width, height, rows, cols);

  // 【重要】切り出しは「先に行(段)で切ってから、各段の中で共通縦線 x ごとに切る」順序を維持。
  // 列の x は全幅共通(calcColEdgesPerRow)だが、ここで段ごとに分けて切るのは変えない。
  // 画像全体を縦に一括で切ると、段境界をまたいで縦すき間が繋がらない限り割れない
  // （3×3 が縦3枚になるバグ）。共通 x を各段に適用しても、この段ごと切りなら綺麗に格子化する。
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

  // 行境界 y: 切り出しに実際に使った各段の上端 bandTop をそのまま採用する。
  // 先頭の段(index 0)の上端は画像端(0)なので端として除外し、段1以降の上端だけを横線とする。
  // calcRowBoundaries の等分割式と同値だが、ここでは「実際に切った位置」を出すことで
  // 線データと切り出し位置のズレを構造的に防ぐ（全幅共通なので number[] で持つ）。
  const rowBoundaries = perRow.slice(1).map(band => band.bandTop);

  // 列境界 x: 列は全幅共通に統一済みで全段の edges が同一なので、先頭段の内側 edges を
  // そのまま全幅共通の縦線として採用する（端 0/width は slice(1,-1) で除外）。
  // perRow が空（rows<1 は来ない想定だが防御）の場合は縦線なし。
  const colBoundaries = perRow.length > 0 ? perRow[0].edges.slice(1, -1) : [];

  console.log(`[split] total cells: ${bboxes.length}`);
  console.log(`[split] common row y: [${rowBoundaries.join(', ')}], common col x: [${colBoundaries.join(', ')}]`);
  return { bboxes, lines: { rowBoundaries, colBoundaries } };
}

/**
 * 明示した境界線（画像座標系）でカットする。
 * SetupScreen でユーザーがドラッグ/◀▶ボタンで動かした横線・縦線を、そのまま切り出しに
 * 反映するための入口。線データ = 切り出し位置になるので、プレビューと結果が必ず一致する。
 *
 * - rowYsImg: 内部の横線 y（端 0/height は含めない・昇順）
 * - colXsImg: 内部の縦線 x（端 0/width は含めない・昇順、全幅共通）
 *
 * 切り出しロジック（先に行(段)で切ってから各段を共通縦線で切る順序・trimToForeground・
 * EMPTY_CELL_RATIO 判定）は splitRowsThenColsWithLines と完全に同一。
 * 境界を等分値（calcRowBoundaries 相当）で渡せば従来の等分割割りと一致する（回帰なし）。
 */
export function splitByBoundaries(
  rgba: Uint8Array,
  width: number,
  height: number,
  rowYsImg: number[],
  colXsImg: number[],
): BBox[] {
  // 端を含む境界配列に整形する（findColEdges と同形式 [0, ...内側, 端]）。
  const rowBounds = [0, ...rowYsImg, height];
  const colEdges = [0, ...colXsImg, width];
  const bboxes: BBox[] = [];

  // 「先に行(段)で切ってから各段の中で共通縦線 x ごとに切る」順序を維持（縦一括切り禁止）。
  for (let ri = 0; ri < rowBounds.length - 1; ri++) {
    const bandTop = rowBounds[ri];
    const bandBot = rowBounds[ri + 1];
    const bandArea = (bandBot - bandTop) * width;
    if (bandArea <= 0) continue; // 線が重なって帯が潰れた場合の防御
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
  return bboxes;
}

function findColEdges(
  colFg: Uint8Array,
  width: number,
  rowIdx: number,
  // しきい値は「分割の細かさ」スライダーから可変にできるようにした。
  // 省略時は既存定数のままなので、呼び出し元を変えない限り従来と完全に同じ結果になる。
  minRealGap: number = MIN_REAL_GAP,
  relativeGapThreshold: number = RELATIVE_GAP_THRESHOLD,
): number[] {
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

  // しきい値を段ごとに自動決定: 内部gapの太さを降順ソートし、上から順に見て
  // 相対差(比率)が RELATIVE_GAP_THRESHOLD 以上に開いた最初の場所を
  // 「スタンプ間」と「文字間/余白」の境目にする。
  // 例: [40,38,9,7,5] → 40→38 は 5% で素通り、38→9 が 76% で開く
  //     → 38以上を採用 → 2本切る → 3列。
  let threshold = Infinity;
  if (innerGaps.length > 0) {
    const sorted = innerGaps.map(g => g.width).sort((a, b) => b - a);
    const maxGap = sorted[0];

    if (maxGap < minRealGap) {
      // 内部gapが全てごく小さい → 実質すき間なし=1列扱い（誤分割防止）。
      threshold = Infinity;
    } else if (sorted.length === 1) {
      // 内部gapが1本だけ → そのまま切る。
      threshold = maxGap;
    } else {
      // 絶対差ではなく相対差(比率)で「本物の隙間 vs ノイズ」を区切る。
      // 例: [144,136]のように隙間が2個しかない場合、絶対差(8)だけを見ると
      // 必ず「大きい方だけ採用」になってしまう(比較対象が1組しかないため)。
      // 相対差(8/144≈5.6%)まで見れば「ほぼ同じ大きさ=どちらも本物」と判定できる。
      // 上から順に見て、相対差が RELATIVE_GAP_THRESHOLD 以上に開いた最初の場所で区切る。
      // 最後まで大きく開かなければ、全ての内部gapを本物として扱う(デフォルトで全採用)。
      let boundaryLo = sorted[sorted.length - 1]; // デフォルト: 相対差が見つからなければ全部採用
      for (let k = 0; k < sorted.length - 1; k++) {
        const diff = sorted[k] - sorted[k + 1];
        const relDiff = diff / sorted[k]; // 上位側の値に対する相対差
        if (relDiff >= relativeGapThreshold) {
          boundaryLo = sorted[k];
          break; // 最初に見つかった大きな相対差の位置で区切る
        }
      }
      threshold = boundaryLo;
    }
  }

  console.log(`[split] row${rowIdx} auto threshold=${threshold}px (minRealGap=${minRealGap}, relGapTh=${relativeGapThreshold})`);

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
    throw new Error(t('errors.cropFailed'));
  }
  return image;
}
