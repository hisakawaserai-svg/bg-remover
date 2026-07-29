import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';

// ── 調整パラメータ ──────────────────────────────────────────────────────────
export const TOLERANCE = 30;
export const MAX_BG_COLORS = 2;
export const EDGE_SAMPLE_STEP = 4;

// ── 皮むきパス（枠付きシート対策）のパラメータ ────────────────────────────────
/** 追加で剥がす最大回数。入れ子の枠が2重までなら足りる。 */
export const MAX_PEEL_PASSES = 2;
/** 内側の境界をこの割合以上、単一の色が占めているときだけ剥がす。 */
export const PEEL_DOMINANT_RATIO = 0.7;
/** 画像全体に対してこの割合以上消えるときだけ採用（フチだけ剥ぐ動作を防ぐ）。 */
export const PEEL_MIN_CLEAR_RATIO = 0.05;
/** 残っている前景のこの割合を超えて消すなら、背景ではなく被写体とみなして中止。 */
export const PEEL_MAX_CLEAR_RATIO = 0.9;

// ── 輪郭フェザリングのパラメータ ──────────────────────────────────────────────
/** 本体色と背景色のチャンネル差がこれ未満だと混合比の推定が不安定なので使わない。 */
export const FEATHER_MIN_CONTRAST = 20;
/** 推定 alpha がこれ以上なら元から本体の色とみなして触らない。 */
export const FEATHER_OPAQUE_TH = 0.92;
/** 推定 alpha がこれ以下ならほぼ背景とみなして完全に抜く。 */
export const FEATHER_CLEAR_TH = 0.06;
/** F（本体色）を探す近傍。斜めも見ることで細い輪郭でも拾えるようにする。 */
const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

export interface RemoveBgResult {
  rgba: Uint8Array;
  width: number;
  height: number;
}

interface BgColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

export async function removeBackground(
  fileUri: string,
  tolerance: number = TOLERANCE,
  feather: boolean = true,
): Promise<RemoveBgResult> {
  // file:// のローカルファイルが存在しない場合、Skia.Data.fromURI は reject せず
  // ハングすることがある（→ 呼び出し側が 'processing' のまま無限ローディング）。
  // 事前に存在チェックして明示的に throw し、呼び出し側の catch で扱えるようにする。
  if (fileUri.startsWith('file://')) {
    const path = fileUri.slice('file://'.length);
    if (!(await RNFS.exists(path))) {
      throw new Error('元画像が見つかりません。もう一度画像を選び直してください。');
    }
  }

  const data = await Skia.Data.fromURI(fileUri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    throw new Error('画像のデコードに失敗しました');
  }

  // OOM対策: 長辺が上限(2500px)を超える場合のみ縮小する。
  // removeBackground はピクセル数分のバッファ(rgba/visited/queue)を複数確保するため、
  // 巨大画像だとメモリを圧迫する。通常のイラストシート(~1000px前後)は対象外で
  // 実質何も変わらない。縦横比は維持し、単純な縮小のみ(パディングや正方化はしない)。
  const MAX_DIMENSION = 2500;
  let processedImage = image;
  const origW = image.width();
  const origH = image.height();
  if (origW > MAX_DIMENSION || origH > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(origW, origH);
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);
    const surface = Skia.Surface.Make(newW, newH)!;
    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(0, 0, origW, origH),
      Skia.XYWHRect(0, 0, newW, newH),
      paint,
    );
    processedImage = surface.makeImageSnapshot();
    surface.dispose();
    image.dispose();
    console.log(`[removeBg] resized ${origW}x${origH} → ${newW}x${newH} (OOM対策)`);
  }

  const width = processedImage.width();
  const height = processedImage.height();
  const pixelCount = width * height;

  const rawPixels = processedImage.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!rawPixels) {
    throw new Error('ピクセルデータの取得に失敗しました');
  }

  const rgba = rawPixels instanceof Uint8Array
    ? rawPixels
    : new Uint8Array(rawPixels.buffer);

  const bgColors = estimateBgColors(rgba, width, height, tolerance);

  const visited = new Uint8Array(pixelCount);
  const seeds = [
    0,
    width - 1,
    (height - 1) * width,
    (height - 1) * width + width - 1,
  ];

  for (const seed of seeds) {
    if (visited[seed]) continue;
    floodFill(rgba, visited, width, height, seed, bgColors, tolerance);
  }

  // 枠などで堰き止められて内側の背景に届いていない場合に、もう一段剥がす。
  // 条件を満たさなければ即座に打ち切るので、通常のシートでは何も起きない。
  for (let pass = 0; pass < MAX_PEEL_PASSES; pass++) {
    const peeled = peelOnce(rgba, visited, width, height, tolerance);
    if (peeled === 0) break;
    console.log(
      `[removeBg] peel pass ${pass + 1}: +${peeled}px ` +
      `(${((peeled / pixelCount) * 100).toFixed(1)}%)`,
    );
  }

  // 輪郭を半透明化するのは alpha を落とす前（境界画素の元の色が必要なため）。
  if (feather) {
    const softened = featherEdges(rgba, visited, width, height, bgColors);
    console.log(`[removeBg] feather: ${softened}px`);
  }

  let clearedCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (visited[i]) {
      rgba[i * 4 + 3] = 0;
      clearedCount++;
    }
  }

  // 診断: 背景として透過(alpha=0)にした画素の割合。
  // ここが極端に小さい(数%以下)場合は背景推定/floodFillが効いておらず、
  // 全前景が1つの塊になる → splitConnected ではなく透過側の問題。
  const clearedRatio = clearedCount / pixelCount;
  console.log(
    `[removeBg] cleared=${clearedCount}/${pixelCount} ` +
    `(${(clearedRatio * 100).toFixed(1)}%), bgColors=${bgColors.length}, ` +
    `tol=${tolerance}, image=${width}x${height}`,
  );
  if (clearedRatio < 0.05) {
    console.warn(
      '[removeBg] 透過された背景がごくわずかです。背景色推定が外れているか、' +
      '背景がスタンプで囲まれ画像端と繋がっていない可能性があります。',
    );
  }

  return { rgba, width, height };
}

function sampleEdgeColors(
  rgba: Uint8Array,
  w: number,
  h: number,
): Array<[number, number, number]> {
  const colors: Array<[number, number, number]> = [];

  for (let x = 0; x < w; x += EDGE_SAMPLE_STEP) {
    const topOff = x * 4;
    colors.push([rgba[topOff], rgba[topOff + 1], rgba[topOff + 2]]);
    const botOff = ((h - 1) * w + x) * 4;
    colors.push([rgba[botOff], rgba[botOff + 1], rgba[botOff + 2]]);
  }

  for (let y = EDGE_SAMPLE_STEP; y < h - 1; y += EDGE_SAMPLE_STEP) {
    const leftOff = y * w * 4;
    colors.push([rgba[leftOff], rgba[leftOff + 1], rgba[leftOff + 2]]);
    const rightOff = (y * w + w - 1) * 4;
    colors.push([rgba[rightOff], rgba[rightOff + 1], rgba[rightOff + 2]]);
  }

  return colors;
}

/**
 * 色のリストを tol 以内の近さでまとめ、多い順に並べて返す。
 * 端サンプルの背景色推定と、皮むきパスの境界色推定で共用する。
 */
function clusterColors(
  samples: Array<[number, number, number]>,
  tol: number,
): BgColor[] {
  const clusters: BgColor[] = [];

  for (const [r, g, b] of samples) {
    let matched = false;
    for (const c of clusters) {
      if (
        Math.abs(r - c.r) <= tol &&
        Math.abs(g - c.g) <= tol &&
        Math.abs(b - c.b) <= tol
      ) {
        c.r = Math.round((c.r * c.count + r) / (c.count + 1));
        c.g = Math.round((c.g * c.count + g) / (c.count + 1));
        c.b = Math.round((c.b * c.count + b) / (c.count + 1));
        c.count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ r, g, b, count: 1 });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

function estimateBgColors(
  rgba: Uint8Array,
  w: number,
  h: number,
  tol: number,
): BgColor[] {
  const clusters = clusterColors(sampleEdgeColors(rgba, w, h), tol);

  if (clusters.length <= 1) {
    return clusters.slice(0, 1);
  }

  const total = clusters.reduce((s, c) => s + c.count, 0);
  const ratio = clusters[1].count / total;
  if (ratio < 0.15) {
    return [clusters[0]];
  }

  return clusters.slice(0, MAX_BG_COLORS);
}

function matchesBg(
  rgba: Uint8Array,
  off: number,
  bgColors: BgColor[],
  tol: number,
): boolean {
  const r = rgba[off];
  const g = rgba[off + 1];
  const b = rgba[off + 2];
  for (const bg of bgColors) {
    if (
      Math.abs(r - bg.r) <= tol &&
      Math.abs(g - bg.g) <= tol &&
      Math.abs(b - bg.b) <= tol
    ) {
      return true;
    }
  }
  return false;
}

function floodFill(
  rgba: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  startIdx: number,
  bgColors: BgColor[],
  tol: number,
): void {
  if (!matchesBg(rgba, startIdx * 4, bgColors, tol)) return;

  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];

    for (const ni of neighbors) {
      if (ni < 0 || visited[ni]) continue;
      if (matchesBg(rgba, ni * 4, bgColors, tol)) {
        visited[ni] = 1;
        queue[tail++] = ni;
      }
    }
  }
}

/**
 * 輪郭のフェザリング。透過した領域に接している1pxを半透明にして、貼り先の色に馴染ませる。
 *
 * アンチエイリアスの効いた絵では、キャラと背景の境目に「両者を混ぜた色」の画素が挟まる。
 * しきい値判定はこれを0%か100%かに丸めるしかないので、残せば白フチ、消せばギザギザになる。
 *
 * この関数は混合比そのものを推定して alpha に入れる。境界画素 P、背景色 B、
 * 隣接する不透明画素の色 F として α = |P-B| / |F-B|。さらに α が分かれば
 * 混入前の色は F = B + (P-B)/α で逆算できるので、RGB もそちらへ置き換える
 * （これをしないと、半透明にしても背景色が混ざったままで暗い背景に置いたとき白っぽく浮く）。
 *
 * |F-B| が小さい（背景と似た色の被写体）と割り算が不安定になるため、その画素は触らない。
 * 返り値は半透明化した画素数。
 */
function featherEdges(
  rgba: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  bgColors: BgColor[],
): number {
  // 境界画素は「透過済みに接している、まだ残っている画素」。
  const isBoundary = new Uint8Array(w * h);
  const boundary: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      if (
        (y > 0 && visited[idx - w]) ||
        (y < h - 1 && visited[idx + w]) ||
        (x > 0 && visited[idx - 1]) ||
        (x < w - 1 && visited[idx + 1])
      ) {
        isBoundary[idx] = 1;
        boundary.push(idx);
      }
    }
  }
  if (boundary.length === 0) return 0;

  // 書き換えは最後にまとめて行う。途中で書き換えると、隣の境界画素が
  // 「補正後の色」を F として読んでしまい誤差が連鎖する。
  const writes: Array<[number, number, number, number, number]> = []; // idx,r,g,b,a

  for (const idx of boundary) {
    const off = idx * 4;
    const pr = rgba[off], pg = rgba[off + 1], pb = rgba[off + 2];

    // 一番近い背景色を B とする。
    let bg = bgColors[0];
    let bestD = Infinity;
    for (const c of bgColors) {
      const d = Math.max(Math.abs(pr - c.r), Math.abs(pg - c.g), Math.abs(pb - c.b));
      if (d < bestD) { bestD = d; bg = c; }
    }

    // F は「透過済みでも境界でもない」隣接画素＝背景が混ざっていない本体の色。
    const y = (idx / w) | 0;
    const x = idx - y * w;
    let fOff = -1;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni] || isBoundary[ni]) continue;
      fOff = ni * 4;
      break;
    }
    if (fOff < 0) continue;

    const fr = rgba[fOff], fg = rgba[fOff + 1], fb = rgba[fOff + 2];

    // |F-B| が十分あるチャンネルだけで混合比を平均する。
    let sum = 0;
    let n = 0;
    const chans: Array<[number, number, number]> = [
      [pr, fr, bg.r], [pg, fg, bg.g], [pb, fb, bg.b],
    ];
    for (const [p, f, b] of chans) {
      const denom = f - b;
      if (Math.abs(denom) < FEATHER_MIN_CONTRAST) continue;
      sum += (p - b) / denom;
      n++;
    }
    if (n === 0) continue;

    const alpha = Math.min(1, Math.max(0, sum / n));
    // ほぼ不透明なら触らない（元から本体の色。誤差で薄くしてしまうのを防ぐ）。
    if (alpha >= FEATHER_OPAQUE_TH) continue;
    // ほぼ透明なら完全に抜く。
    if (alpha <= FEATHER_CLEAR_TH) {
      writes.push([idx, pr, pg, pb, 0]);
      continue;
    }

    // 混入前の色を逆算して置き換える。
    const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    writes.push([
      idx,
      clamp255(bg.r + (pr - bg.r) / alpha),
      clamp255(bg.g + (pg - bg.g) / alpha),
      clamp255(bg.b + (pb - bg.b) / alpha),
      Math.round(alpha * rgba[off + 3]),
    ]);
  }

  for (const [idx, r, g, b, a] of writes) {
    const off = idx * 4;
    rgba[off] = r; rgba[off + 1] = g; rgba[off + 2] = b; rgba[off + 3] = a;
  }
  return writes.length;
}

/**
 * 「皮むき」1回ぶん。すでに透過した領域の内側に接している色を新しい背景色とみなし、
 * もう一段フラッドフィルする。
 *
 * 枠付きのスタンプシートのように、背景が枠で堰き止められていて四隅からの
 * フラッドフィルが内側へ入れないケースを救うためのもの。1回目で枠が消えたあと、
 * 枠の内側に接している色（＝内側の背景）を拾って2回目を走らせる。
 *
 * 被写体そのものを消す暴走を防ぐため、次を全部満たしたときだけ適用する:
 *   - 内側の境界が単一の色でほぼ占められている
 *     （キャラの輪郭なら色がバラけるので発動しない）
 *   - 消える量が画像全体から見て十分大きい
 *     （アンチエイリアスのフチだけを薄く剥ぐような動作を防ぐ）
 *   - 消える量が残っている前景の大半を占めない
 *     （占めるなら背景ではなく被写体だと判断して中止）
 *
 * 返り値は新たに透過した画素数。0 なら visited は一切変更していない。
 */
function peelOnce(
  rgba: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  tol: number,
): number {
  const pixelCount = w * h;

  // 透過済み領域に4近傍で接している、まだ残っている画素＝内側の境界。
  const boundary: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      if (
        (y > 0 && visited[idx - w]) ||
        (y < h - 1 && visited[idx + w]) ||
        (x > 0 && visited[idx - 1]) ||
        (x < w - 1 && visited[idx + 1])
      ) {
        boundary.push(idx);
      }
    }
  }
  if (boundary.length === 0) return 0;

  const clusters = clusterColors(
    boundary.map(i => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] as [number, number, number]),
    tol,
  );
  const dominant = clusters[0];
  if (!dominant || dominant.count / boundary.length < PEEL_DOMINANT_RATIO) return 0;

  // いったん複製の上で塗ってみて、量を見てから採用を決める。
  const temp = visited.slice();
  for (const idx of boundary) {
    if (temp[idx]) continue;
    floodFill(rgba, temp, w, h, idx, [dominant], tol);
  }

  let newly = 0;
  let remaining = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (!visited[i]) {
      remaining++;
      if (temp[i]) newly++;
    }
  }
  if (newly === 0) return 0;
  if (newly / pixelCount < PEEL_MIN_CLEAR_RATIO) return 0;
  if (newly / remaining > PEEL_MAX_CLEAR_RATIO) return 0;

  visited.set(temp);
  return newly;
}

// タップ位置を画像内にクランプして画素インデックスを返す（スポイト系で共用）。
function clampedPixelIndex(width: number, height: number, x: number, y: number): number {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  return py * width + px;
}

/**
 * (x,y) の画素が既に透明かどうか。
 * 透過済みの場所は alpha=0 でも RGB は元の背景色のまま残っているため、
 * スポイトでタップするとフラッドフィル自体は普通に広がってしまう。
 * ただし alpha を 0 から 0 に書き換えるだけで見た目は一切変わらない＝空振り。
 * 呼び出し側がこれを検出して undo 履歴を積まないために使う。
 */
export function isTransparentAt(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return rgba[clampedPixelIndex(width, height, x, y) * 4 + 3] === 0;
}

// タップした1点の色を基準に、そこから隣接ピクセルへ伝播して同系色を透過する。
// removeBackground の四隅フラッドフィルと同じアルゴリズムを、任意の起点(x,y)に対して
// 1回だけ実行する版。スポイト機能(SetupScreen)から呼ばれる。
// rgba は破壊的に変更する(呼び出し側でコピーが必要ならコピーしてから渡すこと)。
export function removeColorAt(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
  feather: boolean = true,
): number {
  // 既に透明な場所は何をしても見た目が変わらないので即座に打ち切る（空振り）。
  if (isTransparentAt(rgba, width, height, x, y)) return 0;

  const seedIdx = clampedPixelIndex(width, height, x, y);
  const off = seedIdx * 4;
  const bgColor: BgColor = { r: rgba[off], g: rgba[off + 1], b: rgba[off + 2], count: 1 };

  const visited = new Uint8Array(width * height);
  floodFill(rgba, visited, width, height, seedIdx, [bgColor], tolerance);

  if (feather) featherEdges(rgba, visited, width, height, [bgColor]);

  let clearedCount = 0;
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    if (visited[i]) {
      rgba[i * 4 + 3] = 0;
      clearedCount++;
    }
  }
  return clearedCount;
}
