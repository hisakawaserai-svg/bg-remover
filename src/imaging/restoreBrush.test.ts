/**
 * 復元ブラシの単体テスト。
 *
 * 押さえたいのは3点:
 *   - 消えた部分が元に戻ること
 *   - なぞっていない透過部分は透明のままであること
 *   - RGB を書き換えないこと（フェザリングの結果を壊さない）
 */
import { applyRestoreStroke, densifyStroke } from './restoreBrush';
import { removeBackgroundInPlace } from './removeBackground';

const W = 60;
const H = 60;

/** 白背景に、背景とほぼ同じ明るさの白い被写体を置いたもの。 */
function makeBase(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
  }
  // 中央に「白い被写体」。背景との差が小さいので強めの透過だと消える。
  for (let y = 20; y < 40; y++) {
    for (let x = 20; x < 40; x++) {
      const o = (y * W + x) * 4;
      rgba[o] = 245; rgba[o + 1] = 245; rgba[o + 2] = 245; rgba[o + 3] = 255;
    }
  }
  return rgba;
}

const alphaAt = (r: Uint8Array, x: number, y: number) => r[(y * W + x) * 4 + 3];

describe('applyRestoreStroke', () => {
  it('消えすぎた部分をなぞると元に戻る', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    // 許容値を大きくして、白い被写体まで巻き込んで消す。
    removeBackgroundInPlace(cur, W, H, 40, false);
    expect(alphaAt(cur, 30, 30)).toBe(0); // 被写体が消えている

    const changed = applyRestoreStroke(
      cur, base, W, H, W, H, { points: [[30, 30]], radius: 5 },
    );

    expect(changed).toBeGreaterThan(0);
    expect(alphaAt(cur, 30, 30)).toBe(255);
  });

  it('なぞっていない透過部分は透明のまま', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    removeBackgroundInPlace(cur, W, H, 40, false);

    applyRestoreStroke(cur, base, W, H, W, H, { points: [[30, 30]], radius: 5 });

    // ブラシ半径の外（画像の隅の背景）は透明のまま。
    expect(alphaAt(cur, 1, 1)).toBe(0);
    expect(alphaAt(cur, 50, 50)).toBe(0);
  });

  it('RGB は書き換えない（フェザリングの結果を壊さない）', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    removeBackgroundInPlace(cur, W, H, 40, true);
    // 現在の RGB を控える。
    const rgbBefore = Array.from(cur).filter((_, i) => i % 4 !== 3);

    applyRestoreStroke(cur, base, W, H, W, H, { points: [[30, 30]], radius: 8 });

    const rgbAfter = Array.from(cur).filter((_, i) => i % 4 !== 3);
    expect(rgbAfter).toEqual(rgbBefore);
  });

  it('同じ場所を何度なぞっても結果が変わらない（冪等）', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    removeBackgroundInPlace(cur, W, H, 40, false);

    applyRestoreStroke(cur, base, W, H, W, H, { points: [[30, 30]], radius: 6 });
    const once = Array.from(cur);
    const changed2 = applyRestoreStroke(cur, base, W, H, W, H, { points: [[30, 30]], radius: 6 });

    expect(changed2).toBe(0);
    expect(Array.from(cur)).toEqual(once);
  });

  it('元画像より濃くはしない', () => {
    const base = makeBase();
    // 元画像側を半透明にしておく。
    for (let i = 0; i < W * H; i++) base[i * 4 + 3] = 100;
    const cur = Uint8Array.from(base);
    for (let i = 0; i < W * H; i++) cur[i * 4 + 3] = 0;

    applyRestoreStroke(cur, base, W, H, W, H, { points: [[30, 30]], radius: 4 });

    expect(alphaAt(cur, 30, 30)).toBe(100);
  });

  it('切り出したバッファでもオフセットぶんずれずに復元する', () => {
    const base = makeBase();
    // 元画像の (20,20)-(39,39) を切り出したものを想定。
    const subW = 20, subH = 20;
    const sub = new Uint8Array(subW * subH * 4);
    for (let y = 0; y < subH; y++) {
      const srcOff = ((20 + y) * W + 20) * 4;
      sub.set(base.subarray(srcOff, srcOff + subW * 4), y * subW * 4);
    }
    for (let i = 0; i < subW * subH; i++) sub[i * 4 + 3] = 0; // 全部消えた状態

    // 元画像座標 (25,25) を狙う → 切り出し内では (5,5)。
    applyRestoreStroke(sub, base, subW, subH, W, H,
      { points: [[25, 25]], radius: 2 }, 20, 20);

    expect(sub[(5 * subW + 5) * 4 + 3]).toBe(255);
    // 離れた場所は戻っていない。
    expect(sub[(15 * subW + 15) * 4 + 3]).toBe(0);
  });

  it('画像の外を指しても落ちない', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    expect(() => applyRestoreStroke(
      cur, base, W, H, W, H,
      { points: [[-10, -10], [W + 30, H + 30]], radius: 6 },
    )).not.toThrow();
  });
});

describe('densifyStroke', () => {
  it('離れた2点の間を埋める（跡が点線にならない）', () => {
    const dense = densifyStroke([[0, 0], [40, 0]], 6);
    expect(dense.length).toBeGreaterThan(2);
    // 隣り合う点の間隔が半径の半分以下に収まっている。
    for (let i = 1; i < dense.length; i++) {
      const d = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
      expect(d).toBeLessThanOrEqual(3.01);
    }
  });

  it('1点以下はそのまま返す', () => {
    expect(densifyStroke([], 5)).toEqual([]);
    expect(densifyStroke([[3, 4]], 5)).toEqual([[3, 4]]);
  });
});

/**
 * 操作列（EditStep）に載せた時の挙動。
 * applyEditSteps は「元画像 + 操作列」から現在の見た目を作り直す方式なので、
 * undo は「操作列を短くして掛け直す」だけで表現できる。
 */
describe('applyEditSteps での復元ブラシ', () => {
  const { applyEditSteps } = require('./index') as typeof import('./index');
  const steps = [
    { kind: 'autoBg' as const, tolerance: 40, feather: false },
    { kind: 'restore' as const, points: [[30, 30] as [number, number]], radius: 5 },
  ];

  it('autoBg で消えた部分が restore で戻る', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    applyEditSteps(cur, W, H, steps, base);
    expect(alphaAt(cur, 30, 30)).toBe(255);
    expect(alphaAt(cur, 1, 1)).toBe(0); // 背景は透明のまま
  });

  it('操作列から restore を外せば元の透過結果に戻る（undo 相当）', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    applyEditSteps(cur, W, H, steps.slice(0, 1), base);
    expect(alphaAt(cur, 30, 30)).toBe(0);
  });

  it('元画像が渡されない場合、restore は何もしない（安全側）', () => {
    const base = makeBase();
    const cur = Uint8Array.from(base);
    expect(() => applyEditSteps(cur, W, H, steps)).not.toThrow();
    expect(alphaAt(cur, 30, 30)).toBe(0);
  });
});
