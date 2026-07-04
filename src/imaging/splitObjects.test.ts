/**
 * splitRowsThenColsWithLines の回帰テスト。
 * 目的:
 *  1. 境界線データを足しても、従来 splitRowsThenCols のカット結果(bboxes)が完全一致すること。
 *  2. 取り出した行境界・列境界が、実際の切り出し位置と一致していること。
 */

// Skia は native 依存のためテストでは使わない部分だけスタブする。
jest.mock('@shopify/react-native-skia', () => ({
  Skia: {},
  ColorType: {},
  AlphaType: {},
}));

import {
  splitRowsThenCols,
  splitRowsThenColsWithLines,
  splitByBoundaries,
  calcRowBoundaries,
  calcColEdgesPerRow,
  detectColCount,
  trimToForeground,
  EMPTY_CELL_RATIO,
} from './splitObjects';

const fillRect = (
  rgba: Uint8Array, width: number,
  x0: number, y0: number, x1: number, y1: number,
) => {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      rgba[(y * width + x) * 4 + 3] = 255; // alpha のみ立てれば前景判定される
    }
  }
};

// 2行 × 2列に整列した合成シート（列間に全高の縦すき間 [16,24) ができる）。
function makeAlignedSheet() {
  const width = 40;
  const height = 40;
  const rgba = new Uint8Array(width * height * 4);
  fillRect(rgba, width, 2, 2, 16, 16);
  fillRect(rgba, width, 24, 2, 38, 16);
  fillRect(rgba, width, 2, 24, 16, 38);
  fillRect(rgba, width, 24, 24, 38, 38);
  return { rgba, width, height };
}

// 下段の列が左にズレた“千鳥”シート。段ごと検出だと段で x が変わるが、
// 全幅共通化後は上下段とも全高で連続する縦すき間 [18,22) を共通縦線として使う。
function makeStaggeredSheet() {
  const width = 40;
  const height = 40;
  const rgba = new Uint8Array(width * height * 4);
  // 上段: [2,18) と [22,38)
  fillRect(rgba, width, 2, 2, 18, 16);
  fillRect(rgba, width, 22, 2, 38, 16);
  // 下段: 少し内側に寄せるが、縦すき間 [18,22) は上段と重なる位置に保つ
  fillRect(rgba, width, 4, 24, 18, 38);
  fillRect(rgba, width, 22, 24, 36, 38);
  return { rgba, width, height };
}

test('境界線を返しても bboxes は splitRowsThenCols と完全一致', () => {
  const { rgba, width, height } = makeAlignedSheet();
  const rows = 2;

  const viaLegacy = splitRowsThenCols(rgba, width, height, rows);
  const withLines = splitRowsThenColsWithLines(rgba, width, height, rows);

  expect(withLines.bboxes).toEqual(viaLegacy);
  expect(viaLegacy.length).toBe(4); // 2x2 に格子分割
});

test('splitByBoundaries: 等分値を渡すと固定列の splitRowsThenCols と完全一致（回帰なし）', () => {
  const { rgba, width, height } = makeAlignedSheet();
  const rows = 2;
  const cols = 2;
  // SetupScreen が未編集で渡す境界＝等分値（calcRowBoundaries 相当）。
  const rowYsImg = calcRowBoundaries(height, rows);
  const colXsImg = calcRowBoundaries(width, cols);

  const viaBoundaries = splitByBoundaries(rgba, width, height, rowYsImg, colXsImg);
  const viaLegacy = splitRowsThenCols(rgba, width, height, rows, cols);

  expect(viaBoundaries).toEqual(viaLegacy);
  expect(viaBoundaries.length).toBe(4);
});

test('splitByBoundaries: 線を動かすと切り出し位置も追従する', () => {
  const { rgba, width, height } = makeAlignedSheet();
  // 縦線を右へずらす（左セルを広く・右セルを狭く）。切り出し左端がその x に一致するはず。
  const movedX = 28;
  const bboxes = splitByBoundaries(rgba, width, height, calcRowBoundaries(height, 2), [movedX]);
  // 右上セル（前景 [24,38)×[2,16)）は縦線 28 の右側だけを見るので minX>=28 になる。
  const topRightRightOfLine = bboxes.find(b => b.minX >= movedX && b.maxY < 20);
  expect(topRightRightOfLine).toBeTruthy();
});

test('行境界 y は等分割式(calcRowBoundaries)と一致し全幅共通', () => {
  const { rgba, width, height } = makeAlignedSheet();
  const rows = 2;
  const { lines } = splitRowsThenColsWithLines(rgba, width, height, rows);

  expect(lines.rowBoundaries).toEqual(calcRowBoundaries(height, rows));
});

test('列境界は段共通の単一 x配列で、全段の縦線位置が一致する', () => {
  const { rgba, width, height } = makeAlignedSheet();
  const rows = 2;
  const { lines } = splitRowsThenColsWithLines(rgba, width, height, rows);

  // colBoundaries は number[]（段ごとではない単一配列）
  expect(Array.isArray(lines.colBoundaries)).toBe(true);
  expect(lines.colBoundaries.length).toBe(1); // 2列 → 内部縦線は1本

  // calcColEdgesPerRow の全段が同じ内側 edges（= 全幅共通）を持つことを確認
  const perRow = calcColEdgesPerRow(rgba, width, height, rows);
  for (const band of perRow) {
    expect(band.edges.slice(1, -1)).toEqual(lines.colBoundaries);
  }
});

test('千鳥シートでも全段が同一の共通縦線で切られる（下段ズレ解消）', () => {
  const { rgba, width, height } = makeStaggeredSheet();
  const rows = 2;
  const perRow = calcColEdgesPerRow(rgba, width, height, rows);

  // 全段の edges が一致＝段ごとに x が変わらない
  const first = perRow[0].edges;
  for (const band of perRow) {
    expect(band.edges).toEqual(first);
  }
});

test('行×列の共通格子で切り直すと実カット bboxes に一致する', () => {
  const { rgba, width, height } = makeAlignedSheet();
  const rows = 2;
  const { bboxes, lines } = splitRowsThenColsWithLines(rgba, width, height, rows);

  // 全幅共通の y（端含む）と x（端含む）で素直な格子を組み、各セルを切り直す。
  const ys = [0, ...lines.rowBoundaries, height];
  const xs = [0, ...lines.colBoundaries, width];
  const reconstructed: typeof bboxes = [];
  for (let r = 0; r < ys.length - 1; r++) {
    const bandArea = (ys[r + 1] - ys[r]) * width;
    for (let c = 0; c < xs.length - 1; c++) {
      const bb = trimToForeground(rgba, width, xs[c], ys[r], xs[c + 1], ys[r + 1]);
      if (bb && bb.area / bandArea >= EMPTY_CELL_RATIO) reconstructed.push(bb);
    }
  }
  expect(reconstructed).toEqual(bboxes);
});

test('列数を手動指定すると従来どおり等分される（回帰なし）', () => {
  const { rgba, width, height } = makeStaggeredSheet();
  const rows = 2;
  const cols = 3;
  const perRow = calcColEdgesPerRow(rgba, width, height, rows, cols);

  // 各段とも 0..width を 3 等分した edges になる
  const expected = [0, Math.round(width / 3), Math.round((2 * width) / 3), width];
  for (const band of perRow) {
    expect(band.edges).toEqual(expected);
  }
});

// rows×cols のグリッドシート生成。jitter[r] は段ごとの水平ズレ(px)、charW はキャラ幅(px)。
// 列ピッチ pitch、各段の上下にマージンを取る。
function makeGridSheet(rows: number, cols: number, jitter: number[], charW: number) {
  const pitch = 30;
  const width = cols * pitch;
  const height = rows * pitch;
  const rgba = new Uint8Array(width * height * 4);
  const bandH = height / rows;
  for (let r = 0; r < rows; r++) {
    const top = Math.round(r * bandH) + 4;
    const bot = Math.round((r + 1) * bandH) - 4;
    for (let c = 0; c < cols; c++) {
      const cx = c * pitch + pitch / 2 + (jitter[r] ?? 0);
      const x0 = Math.max(0, Math.round(cx - charW / 2));
      const x1 = Math.min(width, Math.round(cx + charW / 2));
      fillRect(rgba, width, x0, top, x1, bot);
    }
  }
  return { rgba, width, height };
}

test('整列3×4シートは列4に検出され12分割される（回帰解消）', () => {
  // 段ズレなしの整列グリッド。マーモット整列シート相当。
  const { rgba, width, height } = makeGridSheet(3, 4, [0, 0, 0], 20);
  const rows = 3;

  const { bboxes, lines } = splitRowsThenColsWithLines(rgba, width, height, rows);

  // 共通縦線は3本（=4列）、横線は2本（=3段）
  expect(lines.colBoundaries.length).toBe(3);
  expect(lines.rowBoundaries.length).toBe(2);
  // 3段 × 4列 = 12個に格子分割
  expect(bboxes.length).toBe(12);
  // 列数推定(detectColCount 経由でステッパー初期値になる値)も 4 に戻る
  expect(detectColCount(rgba, width, height, rows)).toBe(4);
});

test('段ごとに水平ズレのある3×4シートでも列1に縮退しない（OR投影回帰の防止）', () => {
  // 段ごとに ±9px ズラす。全段OR投影だと縦corridorが塞がって列1に落ちていたケース。
  // 段ごと検出＋集約(方向A)なら各段でcorridorが保たれ、最頻列数4に集約される。
  const { rgba, width, height } = makeGridSheet(3, 4, [0, 9, -9], 20);
  const rows = 3;

  const perRow = calcColEdgesPerRow(rgba, width, height, rows);
  // 全段が同一の共通縦線を持つ（段ごとに x が変わらない）
  const first = perRow[0].edges;
  for (const band of perRow) {
    expect(band.edges).toEqual(first);
  }
  // 共通縦線は3本（=4列）。列1への縮退が起きていないこと。
  expect(first.length - 1).toBe(4);
  expect(detectColCount(rgba, width, height, rows)).toBe(4);
});
