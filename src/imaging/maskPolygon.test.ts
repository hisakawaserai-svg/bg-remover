/**
 * findUncoveredRegions の単体テスト。
 * 「どのポリゴンにも囲まれていない絵柄」の検出と、ノイズ除外閾値の効き方を固定する。
 */
import { findUncoveredRegions } from './maskPolygon';

const W = 40, H = 40;
const make = (blocks: Array<[number, number, number, number]>) => {
  const rgba = new Uint8Array(W * H * 4);
  for (const [x0, y0, x1, y1] of blocks)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba[(y * W + x) * 4 + 3] = 255;
  return rgba;
};
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  ({ points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][] });

test('全部囲われていれば空配列', () => {
  const rgba = make([[2, 2, 12, 12]]);
  expect(findUncoveredRegions(rgba, W, H, [rect(1, 1, 13, 13)])).toEqual([]);
});

test('囲い漏れの塊を bbox で返す', () => {
  const rgba = make([[2, 2, 12, 12], [25, 25, 35, 35]]);
  const out = findUncoveredRegions(rgba, W, H, [rect(1, 1, 13, 13)]);
  expect(out).toEqual([{ x: 25, y: 25, w: 10, h: 10 }]);
});

test('小さすぎる塊(既定 minAreaPx=40 未満)はノイズとして無視', () => {
  const rgba = make([[25, 25, 30, 30]]); // 5x5 = 25px
  expect(findUncoveredRegions(rgba, W, H, [])).toEqual([]);
  // 閾値を下げれば拾える
  expect(findUncoveredRegions(rgba, W, H, [], { minAreaPx: 10 })).toEqual([{ x: 25, y: 25, w: 5, h: 5 }]);
});

test('離れた2つの塊は別領域として返る', () => {
  const rgba = make([[2, 2, 12, 12], [25, 25, 35, 35]]);
  expect(findUncoveredRegions(rgba, W, H, [])).toHaveLength(2);
});

test('ポリゴンが部分的にしか覆っていない場合、残りだけ返る', () => {
  const rgba = make([[2, 2, 32, 12]]); // 横長 30x10
  const out = findUncoveredRegions(rgba, W, H, [rect(0, 0, 16, 20)]);
  expect(out).toHaveLength(1);
  expect(out[0].x).toBeGreaterThanOrEqual(15);
  expect(out[0].w).toBeLessThanOrEqual(18);
});
