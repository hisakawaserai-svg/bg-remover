/**
 * rebuildCellFromOriginal の単体テスト。
 *
 * 最重要の確認事項は「一度透過した画像を再処理していないこと」。
 * 透過済みバッファから作り直すと、消えた画素は二度と戻らないため、
 * 許容値を下げても結果が改善しない。元画像から作り直せていれば改善する。
 */
import { rebuildCellFromOriginal, cropFromOriginal, isBBoxInside } from './rebuildCell';
import { removeBackgroundInPlace } from './removeBackground';
import type { EditStep } from '../session/types';

const W = 120;
const H = 60;

/** 左右2セル。左は白背景＋灰色の四角、右は白背景＋うっすい灰色の四角。 */
function makeSheet(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
  }
  const put = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * W + x) * 4;
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
      }
    }
  };
  put(15, 15, 45, 45, 60);    // 左セル: はっきりした濃さ
  put(75, 15, 105, 45, 215);  // 右セル: 背景(255)との差が 40 しかない薄い絵
  return rgba;
}

const LEFT = { minX: 0, minY: 0, maxX: 59, maxY: 59 };
const RIGHT = { minX: 60, minY: 0, maxX: 119, maxY: 59 };

const alphaAt = (r: Uint8Array, w: number, x: number, y: number) => r[(y * w + x) * 4 + 3];

describe('cropFromOriginal', () => {
  it('bbox のサイズどおりに切り出す', () => {
    const cell = cropFromOriginal(makeSheet(), W, RIGHT);
    expect(cell.width).toBe(60);
    expect(cell.height).toBe(60);
    // 右セルの絵は元画像 x=75 → セル内 x=15。
    expect(cell.rgba[(15 * 60 + 15) * 4]).toBe(215);
  });

  it('isBBoxInside は画像内を通し、はみ出し・反転を弾く', () => {
    expect(isBBoxInside(LEFT, W, H)).toBe(true);
    expect(isBBoxInside(RIGHT, W, H)).toBe(true);
    expect(isBBoxInside({ minX: 0, minY: 0, maxX: W, maxY: 0 }, W, H)).toBe(false);   // 右へはみ出し
    expect(isBBoxInside({ minX: 0, minY: 0, maxX: 0, maxY: H }, W, H)).toBe(false);   // 下へはみ出し
    expect(isBBoxInside({ minX: -1, minY: 0, maxX: 5, maxY: 5 }, W, H)).toBe(false);  // 負値
    expect(isBBoxInside({ minX: 5, minY: 5, maxX: 4, maxY: 9 }, W, H)).toBe(false);   // min > max
  });
});

describe('rebuildCellFromOriginal', () => {
  it('元画像から作り直すので、許容値を下げれば消えすぎが直る', () => {
    const base = makeSheet();

    // 許容値 50: 背景(255)との差が 40 の薄い絵まで巻き込んで消してしまう。
    const strong = rebuildCellFromOriginal(base, W, H, RIGHT, { tolerance: 50, feather: false });
    expect(alphaAt(strong.rgba, strong.width, 15, 15)).toBe(0); // 絵が消えている

    // 許容値 20 で作り直すと、同じ絵が残る。
    // 元画像から作り直していなければ、消えた画素は戻らずここは 0 のままになる。
    const weak = rebuildCellFromOriginal(base, W, H, RIGHT, { tolerance: 20, feather: false });
    expect(alphaAt(weak.rgba, weak.width, 15, 15)).toBe(255);
    expect(alphaAt(weak.rgba, weak.width, 1, 1)).toBe(0); // 背景は抜けている
  });

  it('【重要】透過済みバッファから作り直すと直らない（禁止の根拠）', () => {
    // 一度強めに透過した画像を「元画像」として渡してしまった場合の再現。
    const alreadyKeyed = makeSheet();
    removeBackgroundInPlace(alreadyKeyed, W, H, 50, false);

    const weak = rebuildCellFromOriginal(alreadyKeyed, W, H, RIGHT, { tolerance: 20, feather: false });

    // 許容値を下げても、消えた画素は戻らない。
    expect(alphaAt(weak.rgba, weak.width, 15, 15)).toBe(0);
  });

  it('元画像を破壊しない（再適用を何度でもやり直せる）', () => {
    const base = makeSheet();
    const before = Uint8Array.from(base);

    rebuildCellFromOriginal(base, W, H, RIGHT, { tolerance: 50, feather: false });
    rebuildCellFromOriginal(base, W, H, LEFT, { tolerance: 10, feather: false });

    expect(Array.from(base)).toEqual(Array.from(before));
  });

  it('セル内のスポイトは掛け直し、セル外のスポイトは無視する', () => {
    const base = makeSheet();
    const steps: EditStep[] = [
      { kind: 'autoBg', tolerance: 30, feather: false },
      // 左セルの絵(元画像 30,30)を狙ったスポイト。右セルには関係ない。
      { kind: 'eyedrop', x: 30, y: 30, tolerance: 30, feather: false },
      // 右セルの絵(元画像 90,30 → セル内 30,30)を狙ったスポイト。
      { kind: 'eyedrop', x: 90, y: 30, tolerance: 30, feather: false },
    ];

    const right = rebuildCellFromOriginal(base, W, H, RIGHT, {
      tolerance: 20, feather: false, steps,
    });

    // 右セル内のスポイトは効いて絵が消える。
    expect(alphaAt(right.rgba, right.width, 30, 30)).toBe(0);

    // 左セルを作り直すと、そちらのスポイトが効く。
    const left = rebuildCellFromOriginal(base, W, H, LEFT, {
      tolerance: 20, feather: false, steps,
    });
    expect(alphaAt(left.rgba, left.width, 30, 30)).toBe(0);
  });

  it('セル外のスポイトでセル内の色を巻き込まない', () => {
    const base = makeSheet();
    // 左セルの絵を狙ったスポイトだけを持つ操作列。
    const steps: EditStep[] = [
      { kind: 'eyedrop', x: 30, y: 30, tolerance: 30, feather: false },
    ];
    const right = rebuildCellFromOriginal(base, W, H, RIGHT, {
      tolerance: 20, feather: false, steps,
    });
    // 右セルの絵は残っていること（クランプして端から消していたら 0 になる）。
    expect(alphaAt(right.rgba, right.width, 30, 30)).toBe(255);
  });
});
