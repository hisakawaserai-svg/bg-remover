/**
 * removeBackgroundInPlace の単体テスト。
 *
 * 主眼は2つ:
 *   - 既定（fillHoles=false）では従来どおりの安全な挙動であること
 *   - fillHoles=true でも「背景色と同じ色の被写体」を消さないこと
 *     （白背景の上の白い鳥。面積では区別できず、太さで弾く）
 */
import { removeBackgroundInPlace, HOLE_MAX_AREA_RATIO } from './removeBackground';

const W = 200;
const H = 200;

const BG: [number, number, number] = [255, 255, 255];
const LINE: [number, number, number] = [60, 60, 60];

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
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const off = (y * W + x) * 4;
  rgba[off] = c[0];
  rgba[off + 1] = c[1];
  rgba[off + 2] = c[2];
  rgba[off + 3] = 255;
}

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

/**
 * 白い鳥の体を模した円。輪郭線に加えて、内部に羽の陰影と
 * アンチエイリアスのゆらぎを入れる（実画像の白い被写体に近づけるため）。
 * これが無いと内部が完全に均一になり、文字の穴と区別できない。
 */
function strokeCircle(
  rgba: Uint8Array,
  cx: number, cy: number, rad: number,
  c: [number, number, number],
) {
  for (let y = cy - rad - 2; y <= cy + rad + 2; y++) {
    for (let x = cx - rad - 2; x <= cx + rad + 2; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad - 1.5 && d <= rad) {
        setPixel(rgba, x, y, c);
      } else if (d <= rad - 1.5) {
        // 下側ほど暗い陰影 + 細かいゆらぎ。背景(255)からのズレは tolerance 内に収める。
        const shade = Math.round(((y - (cy - rad)) / (2 * rad)) * 26);
        const jitter = ((x * 7 + y * 13) % 21) - 10;
        const v = Math.max(0, Math.min(255, 255 - shade + jitter));
        setPixel(rgba, x, y, [v, v, v]);
      }
    }
  }
}

const alphaAt = (rgba: Uint8Array, x: number, y: number) => rgba[(y * W + x) * 4 + 3];

describe('removeBackgroundInPlace（既定 / fillHoles=false）', () => {
  it('外側の背景を抜き、線そのものは残す', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 60, 60, 100, 100, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 0, 0)).toBe(0);      // 外側の背景
    expect(alphaAt(rgba, 60, 80)).toBe(255);  // 枠線
  });

  it('閉じた線の内側は既定では手を付けない（従来どおり）', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 60, 60, 100, 100, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false);

    expect(alphaAt(rgba, 80, 80)).toBe(255);
  });
});

describe('removeBackgroundInPlace（fillHoles=true）', () => {
  it('白い被写体を消さない（シマエナガ回帰テスト）', () => {
    const rgba = makeCanvas();
    // 白背景の上の、輪郭線を持つ白い丸＝背景と同色の被写体。
    // 面積は画像の約5%で面積上限を下回るため、太さ判定だけが頼りになる。
    strokeCircle(rgba, 100, 100, 25, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 100, 100)).toBe(255); // 体の中心が残ること
    expect(alphaAt(rgba, 100, 90)).toBe(255);
    expect(alphaAt(rgba, 0, 0)).toBe(0);       // 外側の背景は抜ける
  });

  it('大きい白い被写体も消さない', () => {
    const rgba = makeCanvas();
    strokeCircle(rgba, 100, 100, 45, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 100, 100)).toBe(255);
  });

  it('細い隙間は抜ける（文字の内側）', () => {
    const rgba = makeCanvas();
    // 「ロ」のような、内側が2px幅しかない閉領域。
    strokeRect(rgba, 40, 40, 45, 45, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 42, 42)).toBe(0);
    expect(alphaAt(rgba, 43, 43)).toBe(0);
  });

  it('細長い隙間は面積があっても抜ける', () => {
    const rgba = makeCanvas();
    // 横に長いスリット（内側 1px x 100px）。太さは細いので対象になる。
    strokeRect(rgba, 30, 100, 130, 102, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 80, 101)).toBe(0);
  });

  it('内部がざらついた太い閉領域は残す（分散が効く）', () => {
    const rgba = makeCanvas();
    // 濃い枠に囲まれた太い領域だが、内部に陰影のゆらぎがある＝被写体。
    strokeRect(rgba, 60, 60, 89, 89, LINE);
    for (let y = 61; y <= 88; y++) {
      for (let x = 61; x <= 88; x++) {
        const v = 255 - (((x * 7 + y * 13) % 25) + Math.round((y - 61) / 3));
        setPixel(rgba, x, y, [v, v, v]);
      }
    }
    expect(28 * 28).toBeLessThan(W * H * HOLE_MAX_AREA_RATIO);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 75, 75)).toBe(255);
  });

  it('内部が均一で濃い線に囲まれた太めの穴は抜ける（ロゴのO）', () => {
    const rgba = makeCanvas();
    // 上のテストと同じ大きさ・同じ枠だが、内部は真っ白で均一。
    strokeRect(rgba, 60, 60, 89, 89, LINE);
    strokeRect(rgba, 61, 61, 88, 88, LINE);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 75, 75)).toBe(0);
  });

  it('背景色と一致しない内側は残す', () => {
    const rgba = makeCanvas();
    strokeRect(rgba, 60, 60, 66, 66, LINE);
    fillRect(rgba, 61, 61, 65, 65, [128, 128, 128]);

    removeBackgroundInPlace(rgba, W, H, 30, false, true);

    expect(alphaAt(rgba, 63, 63)).toBe(255);
  });

  it('白い被写体だけの画像では ON にしてもほぼ何も増えない', () => {
    const a = makeCanvas();
    const b = makeCanvas();
    strokeCircle(a, 100, 100, 25, LINE);
    strokeCircle(b, 100, 100, 25, LINE);

    removeBackgroundInPlace(a, W, H, 30, true, false);
    removeBackgroundInPlace(b, W, H, 30, true, true);

    // ON が余分に消した画素。アンチエイリアスの粒が数点混じるのは許容し、
    // 「体が食われていないこと」を面積比で固定する。
    let extra = 0;
    for (let i = 0; i < W * H; i++) {
      if (a[i * 4 + 3] > 0 && b[i * 4 + 3] === 0) extra++;
    }
    const bodyArea = Math.PI * 25 * 25;
    expect(extra / bodyArea).toBeLessThan(0.01);
  });
});
