import { ALPHA_TH, trimToForeground } from './splitObjects';
import type { BBox } from './splitObjects';

// ── 調整パラメータ ──────────────────────────────────────────────────────────
// ALPHA_TH は splitObjects と揃える（前景判定の閾値）。
export { ALPHA_TH };
// MIN_AREA : これ未満の塊はノイズとして除外する。
export const MIN_AREA = 400;
// SMALL_RATIO : 全成分の最大面積に対し、この比率未満の塊を「断片(文字や絵の一部)」とみなす。
//               本体スタンプはこれ以上の面積を持つ前提。
export const SMALL_RATIO = 0.30;
// MERGE_GAP : 断片を本体に吸収する最大距離(px)の下限。
//             画像サイズに応じて max(width,height)/MERGE_GAP_DIVISOR と比較し、大きい方を採用する。
export const MERGE_GAP = 16;
export const MERGE_GAP_DIVISOR = 60;

// 画像サイズから実際の結合距離を求める。大きすぎると隣接スタンプ本体まで吸い寄せるので控えめに。
function resolveMergeGap(width: number, height: number): number {
  return Math.max(MERGE_GAP, Math.round(Math.max(width, height) / MERGE_GAP_DIVISOR));
}

// バラバラ配置モード: 連結成分ラベリングで不規則配置のスタンプを個別に切り出す。
export function splitConnected(
  rgba: Uint8Array,
  width: number,
  height: number,
): BBox[] {
  // 1) 4近傍BFSで連結成分ラベリング（再帰なし・キュー使用）。
  const raw = labelComponents(rgba, width, height);

  // 2) 小さすぎる塊はノイズ除外。
  const filtered = raw.filter(b => b.area >= MIN_AREA);

  // 3) 近接する塊を結合。結合距離は画像サイズから決める。
  const mergeGap = resolveMergeGap(width, height);
  const merged = mergeNearby(filtered, mergeGap);

  // 本体/断片の判定内訳（ログ用）。
  const maxArea = filtered.reduce((m, b) => Math.max(m, b.area), 0);
  const smallTh = maxArea * SMALL_RATIO;
  const fragmentCount = filtered.filter(b => b.area < smallTh).length;
  const bodyCount = filtered.length - fragmentCount;

  // 診断ログ（要求フォーマット）。
  console.log(
    `[connected] raw=${raw.length}, afterMinArea=${filtered.length}, ` +
    `afterMerge=${merged.length} (MERGE_GAP=${mergeGap}, image=${width}x${height})`,
  );
  console.log(
    `[connected] body=${bodyCount} fragment=${fragmentCount} (SMALL_RATIO=${SMALL_RATIO})`,
  );
  // 各塊の bbox と面積の概要（上位を抜粋）。
  console.log(
    '[connected] components: ' +
    filtered
      .slice(0, 20)
      .map(b => `(${b.minX},${b.minY})-(${b.maxX},${b.maxY}) a=${b.area}`)
      .join(' ') +
    (filtered.length > 20 ? ` …(+${filtered.length - 20})` : ''),
  );

  // 4) 結合bboxを最終的に前景でトリムし直して返す。
  const result: BBox[] = [];
  for (const b of merged) {
    const bb = trimToForeground(rgba, width, b.minX, b.minY, b.maxX + 1, b.maxY + 1);
    if (bb && bb.area >= MIN_AREA) {
      result.push(bb);
    }
  }
  console.log(`[connected] total cells: ${result.length}`);
  return result;
}

// 4近傍BFSによる連結成分ラベリング。各成分の bbox と面積を返す。
function labelComponents(rgba: Uint8Array, width: number, height: number): BBox[] {
  const total = width * height;
  const visited = new Uint8Array(total);
  // 訪問キュー（最大で画素数分）。配列インデックスで持つ。
  const queue = new Int32Array(total);
  const comps: BBox[] = [];

  for (let p = 0; p < total; p++) {
    if (visited[p]) continue;
    if (rgba[p * 4 + 3] <= ALPHA_TH) {
      visited[p] = 1;
      continue;
    }

    // BFS開始。
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = p;
    visited[p] = 1;

    let minX = width, minY = height, maxX = 0, maxY = 0, area = 0;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % width;
      const y = (idx / width) | 0;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      area++;

      // 上下左右の4近傍。
      if (x > 0) tryPush(idx - 1);
      if (x < width - 1) tryPush(idx + 1);
      if (y > 0) tryPush(idx - width);
      if (y < height - 1) tryPush(idx + width);
    }

    comps.push({ minX, minY, maxX, maxY, area });

    function tryPush(n: number) {
      if (!visited[n] && rgba[n * 4 + 3] > ALPHA_TH) {
        visited[n] = 1;
        queue[qTail++] = n;
      }
    }
  }

  return comps;
}

// 近接する塊を結合する。
//
// 重要: 結合は「小さい断片を近くの本体に吸収する時だけ」に限定する。
// 各成分を面積で「本体(大きい塊)」と「断片(文字や絵の一部)」に分け、
// 結合ペアは次を両方満たす場合のみ許可する:
//   (1) 少なくとも一方が断片であること（本体同士は絶対に結合しない）
//   (2) bbox間の隙間が mergeGap 以内であること
// これにより、隣接するスタンプ本体同士は(1)で弾かれて分離されたまま、
// 文字などの断片だけが近い本体に吸収される。
//
// なお bbox 判定は「元の連結成分の bbox 同士の隙間」で行う。結合済みの
// 大きな bbox を成長させて判定すると、広がった bbox が遠方の塊を巻き込む。
function mergeNearby(boxes: BBox[], mergeGap: number): BBox[] {
  const n = boxes.length;
  if (n === 0) return [];

  // 本体/断片の区別: 最大面積 × SMALL_RATIO 未満を断片とみなす。
  const maxArea = boxes.reduce((m, b) => Math.max(m, b.area), 0);
  const smallTh = maxArea * SMALL_RATIO;
  const isFragment = boxes.map(b => b.area < smallTh);

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // 元 bbox 同士の総当たり。「少なくとも一方が断片」かつ「gap 以内」のみ連結。
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!isFragment[i] && !isFragment[j]) continue; // 本体同士は結合しない。
      if (gapBetween(boxes[i], boxes[j]) <= mergeGap) {
        union(i, j);
      }
    }
  }

  // 連結成分ごとに bbox を合成。
  const groups = new Map<number, BBox>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const b = boxes[i];
    const g = groups.get(root);
    if (!g) {
      groups.set(root, { ...b });
    } else {
      g.minX = Math.min(g.minX, b.minX);
      g.minY = Math.min(g.minY, b.minY);
      g.maxX = Math.max(g.maxX, b.maxX);
      g.maxY = Math.max(g.maxY, b.maxY);
      g.area += b.area;
    }
  }

  return Array.from(groups.values());
}

// 2つのbbox間の隙間（px）。重なり/接触なら0。
function gapBetween(a: BBox, b: BBox): number {
  // x方向の隙間（負なら重なり→0扱い）。
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  // どちらかの軸で範囲が重なっていれば、もう一方の軸の距離が隙間。
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  // 斜めに離れている場合は対角距離。
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}
