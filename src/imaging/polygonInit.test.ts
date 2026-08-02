/**
 * 初期ポリゴンの膨張の単体テスト。
 *
 * 「一回り大きい」＝ 元の bbox を必ず含み、かつ背景を大量に取り込まない、
 * という2点を数値で固定する。
 */
import {
  initialRectFromBBox,
  INIT_PAD_RATIO,
  INIT_PAD_MIN_PX,
} from './polygonInit';

const bboxOf = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX, minY, maxX, maxY, area: (maxX - minX + 1) * (maxY - minY + 1),
});

describe('initialRectFromBBox', () => {
  it('元の bbox を完全に含む（欠けにくくなる）', () => {
    const bbox = bboxOf(100, 100, 200, 260);
    const pts = initialRectFromBBox(bbox, 1000, 1000);
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);

    expect(Math.min(...xs)).toBeLessThan(bbox.minX);
    expect(Math.min(...ys)).toBeLessThan(bbox.minY);
    expect(Math.max(...xs)).toBeGreaterThan(bbox.maxX);
    expect(Math.max(...ys)).toBeGreaterThan(bbox.maxY);
  });

  it('余白は対象の短辺の数%程度に収まる（背景を大量に取り込まない）', () => {
    const bbox = bboxOf(100, 100, 200, 260); // 101x161
    const pts = initialRectFromBBox(bbox, 1000, 1000);
    const pad = bbox.minX - Math.min(...pts.map(p => p[0]));

    // 短辺 101px に対して 4% ≒ 4px。
    expect(pad).toBe(Math.round(101 * INIT_PAD_RATIO));
    // 面積が倍増するようなことは起きない。
    const grownW = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    const grownH = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
    expect(grownW * grownH).toBeLessThan(bbox.area * 1.3);
  });

  it('画像サイズに応じてスケールする', () => {
    const bbox = bboxOf(10, 10, 14, 14); // 5x5 の極小 bbox
    const small = initialRectFromBBox(bbox, 200, 200);
    const large = initialRectFromBBox(bbox, 4000, 4000);

    const padSmall = bbox.minX - small[0][0];
    const padLarge = bbox.minX - large[0][0];
    // 極小 bbox では対象基準の余白がほぼ 0 になるので、画像基準の下限が効く。
    expect(padLarge).toBeGreaterThan(padSmall);
  });

  it('小さい画像でも余白が 0 にならない', () => {
    const bbox = bboxOf(5, 5, 8, 8);
    const pts = initialRectFromBBox(bbox, 40, 40);
    expect(bbox.minX - pts[0][0]).toBeGreaterThanOrEqual(INIT_PAD_MIN_PX);
  });

  it('画像の外へはみ出さない', () => {
    const bbox = bboxOf(0, 0, 99, 99);
    const pts = initialRectFromBBox(bbox, 100, 100);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(99);
      expect(y).toBeLessThanOrEqual(99);
    }
  });

  it('4頂点の四角形を左上→右上→右下→左下の順で返す', () => {
    const pts = initialRectFromBBox(bboxOf(50, 60, 150, 160), 500, 500);
    expect(pts).toHaveLength(4);
    const [tl, tr, br, bl] = pts;
    expect(tl[1]).toBe(tr[1]);   // 上辺
    expect(bl[1]).toBe(br[1]);   // 下辺
    expect(tl[0]).toBe(bl[0]);   // 左辺
    expect(tr[0]).toBe(br[0]);   // 右辺
  });
});
