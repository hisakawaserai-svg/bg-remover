import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';

// ── 調整パラメータ ──────────────────────────────────────────────────────────
export const TOLERANCE = 30;
export const MAX_BG_COLORS = 2;
export const EDGE_SAMPLE_STEP = 4;

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

function estimateBgColors(
  rgba: Uint8Array,
  w: number,
  h: number,
  tol: number,
): BgColor[] {
  const samples = sampleEdgeColors(rgba, w, h);
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
