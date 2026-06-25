// 色グループ編集（タップでまとめる / 分割 / 削除 / 書き出し）の純ロジック。
// React state からは BBox[] と「セルindex→groupId」を渡してここで計算する。
import { trimToForeground } from './imaging';
import type { BBox } from './imaging';

// ── セル ──────────────────────────────────────────────────────────────────
// 1セル = 元画像上の前景bbox。group が同じセルは同じ出力スタンプにまとまる。
export interface Cell {
  bbox: BBox;
  group: number;
}

// ── 色パレット ──────────────────────────────────────────────────────────────
// 隣接グループで別色になるよう greedy 彩色する。fill は半透明、border は実線。
export interface GroupColor {
  fill: string;       // 区画オーバーレイ（薄め＝元画像が透ける）
  fillStrong: string; // 選択中だけ一段濃くする塗り
  border: string;     // 区画の枠線（不透明・はっきり）
}

// スタンプ数が多くても足りるよう14色。隣接で被らないよう greedy 彩色する。
const PALETTE_RGB: Array<[number, number, number]> = [
  [244, 67, 54],   // red
  [33, 150, 243],  // blue
  [76, 175, 80],   // green
  [255, 152, 0],   // orange
  [156, 39, 176],  // purple
  [0, 188, 212],   // cyan
  [233, 30, 99],   // pink
  [121, 85, 72],   // brown
  [63, 81, 181],   // indigo
  [205, 220, 57],  // lime
  [255, 193, 7],   // amber
  [0, 150, 136],   // teal
  [103, 58, 183],  // deep purple
  [255, 87, 34],   // deep orange
];

export const PALETTE: GroupColor[] = PALETTE_RGB.map(([r, g, b]) => ({
  // 塗りは薄く（元画像を透かす）、情報は枠線と番号で伝える。
  fill: `rgba(${r}, ${g}, ${b}, 0.20)`,
  fillStrong: `rgba(${r}, ${g}, ${b}, 0.38)`,
  border: `rgb(${r}, ${g}, ${b})`,
}));

// 2つのbbox間の隙間(px)。重なり/接触なら0。
function gapBetween(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

// グループ → パレット番号を解決する。
//
// 【重要】色は一度決めたら固定する（操作のたびに全再計算しない）。
// 既存マップ prev に色を持つグループはそのまま据え置き、
// 色が無い新規グループにだけ、隣接グループと被らない色を貪欲に割り当てる。
// これにより「あるセルを操作すると無関係なセルの色まで変わる」現象を防ぐ。
// 返り値は新しい Map（prev は破壊しない）。存在しないグループは取り除く。
export function resolveGroupColors(
  cells: Cell[],
  prev: Map<number, number>,
): Map<number, number> {
  const present = new Set(cells.map(c => c.group));

  // 既存の割り当てのうち、まだ存在するグループだけ引き継ぐ。
  const colorOf = new Map<number, number>();
  for (const [g, c] of prev) {
    if (present.has(g)) colorOf.set(g, c);
  }
  if (cells.length === 0) return colorOf;

  // 隣接判定のしきい値: 平均セル寸法の 0.75 倍以内なら「隣接」とみなす。
  let dimSum = 0;
  for (const c of cells) {
    dimSum += (c.bbox.maxX - c.bbox.minX) + (c.bbox.maxY - c.bbox.minY);
  }
  const adjGap = (dimSum / (cells.length * 2)) * 0.75;

  // グループ間の隣接集合を作る。
  const adjacency = new Map<number, Set<number>>();
  const touch = (g: number) => {
    if (!adjacency.has(g)) adjacency.set(g, new Set());
    return adjacency.get(g)!;
  };
  for (let i = 0; i < cells.length; i++) {
    touch(cells[i].group);
    for (let j = i + 1; j < cells.length; j++) {
      const gi = cells[i].group;
      const gj = cells[j].group;
      if (gi === gj) continue;
      if (gapBetween(cells[i].bbox, cells[j].bbox) <= adjGap) {
        touch(gi).add(gj);
        touch(gj).add(gi);
      }
    }
  }

  // 色が未確定のグループだけ、隣接の使用色を避けて割り当てる（既存色は変えない）。
  const uncolored = Array.from(present).filter(g => !colorOf.has(g)).sort((a, b) => a - b);
  for (const g of uncolored) {
    const used = new Set<number>();
    for (const n of adjacency.get(g) ?? []) {
      const c = colorOf.get(n);
      if (c !== undefined) used.add(c);
    }
    let idx = 0;
    while (used.has(idx) && used.size < PALETTE.length) idx++;
    colorOf.set(g, idx % PALETTE.length);
  }
  return colorOf;
}

// セルを2等分し、各半分を前景bboxにトリムして返す（空なら捨てる）。
// direction='vertical' は左右に、'horizontal' は上下に切る。
export function splitCell(
  rgba: Uint8Array,
  width: number,
  bbox: BBox,
  direction: 'vertical' | 'horizontal',
): BBox[] {
  const { minX, minY, maxX, maxY } = bbox;
  const parts: Array<BBox | null> = [];

  if (direction === 'vertical') {
    const mid = Math.floor((minX + maxX) / 2);
    parts.push(trimToForeground(rgba, width, minX, minY, mid + 1, maxY + 1));
    parts.push(trimToForeground(rgba, width, mid + 1, minY, maxX + 1, maxY + 1));
  } else {
    const mid = Math.floor((minY + maxY) / 2);
    parts.push(trimToForeground(rgba, width, minX, minY, maxX + 1, mid + 1));
    parts.push(trimToForeground(rgba, width, minX, mid + 1, maxX + 1, maxY + 1));
  }

  return parts.filter((b): b is BBox => b !== null);
}

// グループごとに、属するセルの外接矩形を求め、前景bboxにトリムして1枚分のbboxにする。
// グループ数 = 出力スタンプ数。順序はグループidの昇順で安定させる。
export function buildGroupBBoxes(
  cells: Cell[],
  rgba: Uint8Array,
  width: number,
): BBox[] {
  // グループごとに外接矩形を集計。
  const unions = new Map<number, BBox>();
  for (const c of cells) {
    const u = unions.get(c.group);
    if (!u) {
      unions.set(c.group, { ...c.bbox });
    } else {
      u.minX = Math.min(u.minX, c.bbox.minX);
      u.minY = Math.min(u.minY, c.bbox.minY);
      u.maxX = Math.max(u.maxX, c.bbox.maxX);
      u.maxY = Math.max(u.maxY, c.bbox.maxY);
      u.area += c.bbox.area;
    }
  }

  const out: BBox[] = [];
  for (const g of Array.from(unions.keys()).sort((a, b) => a - b)) {
    const u = unions.get(g)!;
    // 出力前に必ず前景bboxへトリム（外接矩形の端の余白を落とす＝端切れ防止）。
    const bb = trimToForeground(rgba, width, u.minX, u.minY, u.maxX + 1, u.maxY + 1);
    if (bb) out.push(bb);
  }
  return out;
}
