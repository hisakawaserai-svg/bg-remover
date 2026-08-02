/**
 * removeBackgroundInPlace の単体テスト。
 *
 * 主眼は「文字の内側のように閉じた背景が抜けること」と、
 * 「それによって被写体まで消えないこと」の両立を固定すること。
 */
import { removeBackgroundInPlace, HOLE_MAX_AREA_RATIO } from './removeBackground';

const W = 60;
const H = 60;

const BG: [number, number, number] = [255, 255, 255];
const LINE: [number, number, number] = [0, 0, 0];

/** 全面を背景色で塗った RGBA バッファを作る。 */
function makeCanvas(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function setPixel(rgba: Uint8Array, x: number, y: number, c: [number, number, number]) {
  const off = (y * W + x) * 4;
  rgba[off] = c[0];
  rgba[off + 1] = c[1];
  rgba[off + 2] = c[2];
  rgba[off + 3] = 255;
}

/** 塗りつぶした矩形。 */
function fillRect(
  rgba: Uint8Array,
  x0: number, y0: number, x1: number, y1: number,
  c: [number, number, number],
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) setPixel(rgba, x, y, c);
  }
}

/** 輪郭だけの矩形（「ロ」の字のような閉じた線）。 */
function strokeRect(
  rgba: Uint8Array,
  x0: number, y0: number, x1: number, y1: number,
  c: [number, number, number],
) {
  for (let x = x0; x <= x1; x++) {
    setPixel(rgba, x, y0, c);
    setPixel(rgba, x, y1, c);
  }
  for (let y = y0; y <= y1; y++) {
    setPixel(rgba, x0, y, c);
    setPixel(rgba, x1, y, c);
  }
}

const alphaAt = (rgba: Uint8Array, x: number, y: number) => rgba[(y * W + x) * 4 + 3];

describe('removeBackgroundInPlace', () => {
  it('外側の背景を抜き、線そのものは残す', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 20, 20, 32, 32, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 0, 0)).toBe(0);      // 外側の背景
    expect(alphaAt(rgba, 20, 30)).toBe(255);  // 枠線
  });

  it('閉じた線の内側に残る背景を抜く（「ロ」の内側）', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 20, 20, 32, 32, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    // 内側は画像端と繋がっていないので、従来は 255 のまま残っていた箇所。
    expect(alphaAt(rgba, 30, 30)).toBe(0);
    expect(alphaAt(rgba, 21, 21)).toBe(0);
  });

  it('細い線が作る小さな隙間も抜ける', () => {
    const rgba = makeCanvas();
    // 「あ」のような、2px の隙間しか持たない極小の閉領域。
    strokeRect(rgba, 10, 10, 13, 13, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 11, 11)).toBe(0);
    expect(alphaAt(rgba, 12, 12)).toBe(0);
  });

  it('背景色と一致しない内側は残す（誤除去しない）', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 20, 20, 32, 32, LINE);
    // 枠の内側を灰色で塗る＝背景色ではないので抜いてはいけない。
    fillRect(rgba, 21, 21, 31, 31, [128, 128, 128]);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 30, 30)).toBe(255);
  });

  it('上限を超える大きな閉領域は抜かない（被写体の可能性があるため）', () => {
    const rgba = makeCanvas();
    // 画像の大半を占める枠。内側の面積は HOLE_MAX_AREA_RATIO を大きく超える。
    strokeRect(rgba, 5, 5, 54, 54, LINE);
    const innerArea = 48 * 48;
    expect(innerArea).toBeGreaterThan(W * H * HOLE_MAX_AREA_RATIO);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 30, 30)).toBe(255);
  });

  it('複数の穴をそれぞれ独立に処理する', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 5, 5, 12, 12, LINE);   // 小さい穴 → 抜ける
    strokeRect(rgba, 20, 20, 27, 27, LINE); // 同上
    fillRect(rgba, 40, 40, 50, 50, [200, 30, 30]); // 塗りの被写体 → 残る

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 8, 8)).toBe(0);
    expect(alphaAt(rgba, 23, 23)).toBe(0);
    expect(alphaAt(rgba, 45, 45)).toBe(255);
  });
});
