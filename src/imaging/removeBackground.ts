import { Skia, ColorType, AlphaType, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';
import { t } from '../i18n';

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

// ── 「文字の穴を透過する」（上級者向けオプション）のパラメータ ──────────────────
//
// 穴かどうかは単一の条件では決められない。「白いから背景」と決めつけると
// 白いシマエナガを消し、「太いから被写体」と決めつけると太いロゴの穴を残す。
// そこで 色・輪郭・形状 の特徴量を出してスコアにし、合計で判定する。
//
//   文字の穴 : 内部が均一（分散が低い）／周囲が濃い線でぐるりと閉じている
//   白い鳥   : 羽の陰影とアンチエイリアスで内部がざらつく（分散が高い）／
//              周囲の一部は陰影へなだらかに繋がり、強い輪郭で閉じていない
//
/**
 * 輪郭の強さは「穴の内部の平均輝度と、囲んでいる画素の輝度差」で測る。
 * この値以上なら「はっきりした輪郭」とみなす。
 *
 * Sobel 勾配そのものを使わない理由: 1px幅の線は左右/上下が対称になるため
 * 中心でも隣でも勾配が打ち消し合って 0 になり、細い文字の輪郭を取り逃す。
 * そこで打ち消しの起きないコントラストを主に使い、Sobel（sobelAt）は
 * 補助として併用して、両者の強いほうを輪郭の強さとする。
 */
export const EDGE_STRONG_TH = 40;
/** 輪郭強度スコアの基準値。このコントラストで満点になる。 */
export const EDGE_REF = 90;
/** 内部の輝度分散スコアの基準値。これ以上ばらついていたら分散点は0。 */
export const VAR_REF = 45;
/** 太さスコアの基準。短辺に対する割合（この太さで0点になる）。 */
export const HOLE_THICKNESS_REF_RATIO = 0.02;
export const HOLE_MIN_THICKNESS_PX = 4;
export const HOLE_MAX_THICKNESS_PX = 32;
/** 各特徴量の重み。合計 1.0。 */
export const HOLE_W_CLOSURE = 0.25;   // 輪郭の閉じ具合
export const HOLE_W_EDGE = 0.10;      // 輪郭の平均強度
export const HOLE_W_VARIANCE = 0.30;  // 内部の色分散（均一なほど穴らしい）
export const HOLE_W_THICKNESS = 0.25; // 細いほど穴らしい
export const HOLE_W_COLOR = 0.10;     // 背景色との近さ
/** このスコア以上なら穴として抜く。 */
export const HOLE_SCORE_TH = 0.70;
/**
 * 面積の上限（画像全体に対する割合）。スコアとは別の最終防衛線。
 * 万一スコアが誤っても、一度に広範囲が消えることだけは防ぐ。
 */
export const HOLE_MAX_AREA_RATIO = 0.05;

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

/**
 * 読み込み＋背景除去をまとめて行う従来の入口。
 * 編集履歴を持たない経路（合体ブロックの再処理など）から使う。
 */
export async function removeBackground(
  fileUri: string,
  tolerance: number = TOLERANCE,
  feather: boolean = true,
  fillHoles: boolean = false,
): Promise<RemoveBgResult> {
  const img = await loadImagePixels(fileUri);
  removeBackgroundInPlace(img.rgba, img.width, img.height, tolerance, feather, fillHoles);
  return img;
}

/**
 * 元画像を読み込んでピクセル配列にする（背景除去はしない）。
 *
 * 背景除去を「取り消せる1つの操作」として扱えるようにするため、読み込みと
 * 除去を分けてある。呼び出し側はここで得た素の画素を基準として保持しておき、
 * 除去やスポイトを掛け直すことで任意の時点へ戻せる。
 */
export async function loadImagePixels(fileUri: string): Promise<RemoveBgResult> {
  // file:// のローカルファイルが存在しない場合、Skia.Data.fromURI は reject せず
  // ハングすることがある（→ 呼び出し側が 'processing' のまま無限ローディング）。
  // 事前に存在チェックして明示的に throw し、呼び出し側の catch で扱えるようにする。
  if (fileUri.startsWith('file://')) {
    const path = fileUri.slice('file://'.length);
    if (!(await RNFS.exists(path))) {
      throw new Error(t('errors.sourceMissing'));
    }
  }

  const data = await Skia.Data.fromURI(fileUri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    throw new Error(t('errors.decodeFailed'));
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
    // 既定のサンプリングはニアレストなので、縮小するとジャギーが乗ったまま
    // 以降の背景判定・書き出しに使われる。Linear を明示して補間させる。
    canvas.drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, origW, origH),
      Skia.XYWHRect(0, 0, newW, newH),
      FilterMode.Linear,
      MipmapMode.None,
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
    throw new Error(t('errors.pixelsFailed'));
  }

  const rgba = rawPixels instanceof Uint8Array
    ? rawPixels
    : new Uint8Array(rawPixels.buffer);

  return { rgba, width, height };
}

/**
 * 読み込み済みの画素に対して背景除去を行う（破壊的）。
 * 四隅からのフラッドフィル → 皮むき → 穴埋め(任意) → フェザリング → alpha を落とす、の順。
 *
 * fillHoles は「文字の穴を透過する」オプション。既定 false。
 * 背景色と同じ色の被写体（白背景の上の白い鳥など）を消す可能性があるため、
 * 通常の除去では使わず、ユーザーが明示的に有効にしたときだけ通す。
 */
export function removeBackgroundInPlace(
  rgba: Uint8Array,
  width: number,
  height: number,
  tolerance: number = TOLERANCE,
  feather: boolean = true,
  fillHoles: boolean = false,
): void {
  const pixelCount = width * height;
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

  // 文字の内側のように、画像端と繋がっていない「細い」閉じた背景を拾う（任意）。
  // 皮むきの後に置くことで、皮むき側の「境界色の偏り」判定に影響を与えない。
  if (fillHoles) {
    const holes = fillEnclosedHoles(rgba, visited, width, height, bgColors, tolerance);
    console.log(`[removeBg] holes: +${holes}px`);
  }

  // 輪郭を半透明化するのは alpha を落とす前（境界画素の元の色が必要なため）。
  // 穴埋めの後に呼ぶので、穴の内側の縁も同じようにフェザリングされる。
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
 * 輝度マップ。穴埋めが ON のときだけ作る（O(画素数) の1パス）。
 */
function buildLuminance(rgba: Uint8Array, n: number): Uint8Array {
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // ITU-R BT.601 の輝度。整数演算で済ませる。
    lum[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  }
  return lum;
}

/**
 * 1画素ぶんの Sobel 勾配強度（|gx|+|gy|）。
 *
 * 画像全体を先に計算すると実測で 260ms 掛かるが、実際に必要なのは
 * 穴候補を囲むリングの画素だけで、これは全体のごく一部にすぎない。
 * そのため配列を持たず、必要になった画素だけその場で求める。
 */
function sobelAt(lum: Uint8Array, i: number, x: number, y: number, w: number, h: number): number {
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
  const tl = lum[i - w - 1], tc = lum[i - w], tr = lum[i - w + 1];
  const ml = lum[i - 1],                      mr = lum[i + 1];
  const bl = lum[i + w - 1], bc = lum[i + w], br = lum[i + w + 1];
  const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
  const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
  return Math.abs(gx) + Math.abs(gy);
}

/**
 * 成分の「太さ」＝最大内接半径を測る（マンハッタン距離）。
 *
 * bbox を1px ぶん外へ広げた作業領域を作り、成分外の画素を距離0として
 * 2パスの距離変換をかける。返るのは成分内の最大距離で、
 * 「その形の中に収まる最大の円（菱形）の半径」にあたる。
 *
 * 文字の内側や線の隙間は細いので小さく、鳥の体のような塊は大きくなる。
 * 面積では区別できない両者を、この値なら分けられる。
 */
function componentThickness(
  component: Int32Array,
  size: number,
  w: number,
): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < size; i++) {
    const idx = component[i];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // 外周1pxを「成分外」として確保するため、bbox を上下左右に1広げる。
  const bw = maxX - minX + 3;
  const bh = maxY - minY + 3;
  const dist = new Int32Array(bw * bh); // 0 = 成分外
  const INSIDE = bw + bh; // 距離の上限として十分大きい値
  for (let i = 0; i < size; i++) {
    const idx = component[i];
    const x = idx % w;
    const y = (idx - x) / w;
    dist[(y - minY + 1) * bw + (x - minX + 1)] = INSIDE;
  }

  // 前向きパス: 上と左から伝播。
  for (let y = 1; y < bh; y++) {
    for (let x = 1; x < bw; x++) {
      const i = y * bw + x;
      if (dist[i] === 0) continue;
      const up = dist[i - bw] + 1;
      const left = dist[i - 1] + 1;
      const m = up < left ? up : left;
      if (m < dist[i]) dist[i] = m;
    }
  }
  // 後ろ向きパス: 下と右から伝播。
  let best = 0;
  for (let y = bh - 2; y >= 0; y--) {
    for (let x = bw - 2; x >= 0; x--) {
      const i = y * bw + x;
      if (dist[i] === 0) continue;
      const down = dist[i + bw] + 1;
      const right = dist[i + 1] + 1;
      const m = down < right ? down : right;
      if (m < dist[i]) dist[i] = m;
      if (dist[i] > best) best = dist[i];
    }
  }
  return best;
}

/**
 * 閉じた背景（穴）の除去。「文字の穴を透過する」オプションが ON のときだけ呼ばれる。
 *
 * 四隅からのフラッドフィルは、背景が線で囲まれていると内側へ入れない。
 * 「あ」「ロ」やロゴの内側、細い線が作る隙間がこれにあたり、そこだけ背景色が残る。
 * 皮むきパスは画像の5%以上が消えるときしか発動しないため、この手の領域には届かない。
 *
 * 残っている画素を連結成分に分け、まず前提条件（背景色に一致・画像端に接しない・
 * 面積上限以下）で絞り、残った候補を 色/輪郭/形状 の5つの特徴量でスコアリングして
 * 判定する。単一の条件で決めないのが要点で、どれか1つが外れても他が支える。
 *
 *   closure   輪郭の閉じ具合。候補を囲む画素のうち、はっきりした輪郭の割合。
 *             文字の穴は濃い線でぐるりと閉じている。鳥の白い部分は陰影へ
 *             なだらかに繋がる箇所があり、閉じ切らない。
 *   edge      輪郭の平均強度。線が濃いほど「囲まれている」確信が強い。
 *   variance  内部の輝度分散。文字の穴は真っ白で均一、鳥は羽の陰影と
 *             アンチエイリアスでばらつく。この特徴量が白同士の区別に効く。
 *   thickness 形状の細さ。文字の穴や隙間は細い。
 *   color     背景色との近さ。
 *
 * 返り値は新たに透過した画素数。
 */
function fillEnclosedHoles(
  rgba: Uint8Array,
  visited: Uint8Array,
  w: number,
  h: number,
  bgColors: BgColor[],
  tol: number,
): number {
  if (bgColors.length === 0) return 0;

  const pixelCount = w * h;
  const maxArea = Math.floor(pixelCount * HOLE_MAX_AREA_RATIO);
  if (maxArea < 1) return 0;

  const thicknessRef = Math.max(
    HOLE_MIN_THICKNESS_PX,
    Math.min(HOLE_MAX_THICKNESS_PX, Math.round(Math.min(w, h) * HOLE_THICKNESS_REF_RATIO)),
  );

  const lum = buildLuminance(rgba, pixelCount);

  // 背景色との一致を1度だけ判定して表にする。
  // BFS とリング走査で同じ画素を何度も判定するため、都度 matchesBg を呼ぶと
  // 画素数の数倍の色比較が走って目に見えて遅くなる。比較もインラインに展開する。
  const isBg = new Uint8Array(pixelCount);
  const nBg = bgColors.length;
  const bgR = new Int32Array(nBg), bgG = new Int32Array(nBg), bgB = new Int32Array(nBg);
  for (let c = 0; c < nBg; c++) { bgR[c] = bgColors[c].r; bgG[c] = bgColors[c].g; bgB[c] = bgColors[c].b; }
  for (let i = 0, off = 0; i < pixelCount; i++, off += 4) {
    const r = rgba[off], g = rgba[off + 1], b = rgba[off + 2];
    for (let c = 0; c < nBg; c++) {
      const dr = r - bgR[c], dg = g - bgG[c], db = b - bgB[c];
      if ((dr < 0 ? -dr : dr) <= tol && (dg < 0 ? -dg : dg) <= tol && (db < 0 ? -db : db) <= tol) {
        isBg[i] = 1;
        break;
      }
    }
  }

  // 一度見た画素は再訪しない。visited とは別に持つ（採用しなかった成分も
  // 「見た」として畳んでしまうことで、全体を O(画素数) に保つ）。
  const seen = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  // 上限を超えた成分はどのみち不採用なので、記録は maxArea 個までで足りる。
  const component = new Int32Array(maxArea);
  // 輪郭リングの重複計上を防ぐ印。世代番号方式にして、成分ごとの clear を省く。
  const ringStamp = new Int32Array(pixelCount);
  let generation = 0;
  let filled = 0;

  for (let start = 0; start < pixelCount; start++) {
    if (visited[start] || seen[start]) continue;
    // 背景色に一致しない画素は被写体。そこから成分を広げない。
    if (!isBg[start]) {
      seen[start] = 1;
      continue;
    }

    let head = 0;
    let tail = 0;
    let size = 0;
    let touchesEdge = false;
    seen[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const idx = queue[head++];
      if (size < maxArea) component[size] = idx;
      size++;

      const x = idx % w;
      const y = (idx - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;

      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const ni of neighbors) {
        if (ni < 0 || seen[ni] || visited[ni]) continue;
        // 背景色でない隣は成分の外（＝囲っている線）。seen は立てない。
        if (!isBg[ni]) continue;
        seen[ni] = 1;
        queue[tail++] = ni;
      }
    }

    // 前提条件。ここを外れたものはスコアを出すまでもない。
    if (touchesEdge || size > maxArea) continue;

    // ── 特徴量を集める ────────────────────────────────────────────────
    generation++;

    // (1) 内部の輝度分散。均一なほど「塗り残した背景」らしい。
    let sum = 0, sumSq = 0;
    for (let i = 0; i < size; i++) {
      const v = lum[component[i]];
      sum += v;
      sumSq += v * v;
    }
    const meanLum = sum / size;
    const variance = Math.max(0, sumSq / size - meanLum * meanLum);
    const sd = Math.sqrt(variance);

    // (2)(3) 候補を囲む画素（リング）の輪郭強度と、そのうち強い輪郭の割合。
    let ringCount = 0, ringStrong = 0, ringSum = 0;
    for (let i = 0; i < size; i++) {
      const idx = component[i];
      const x = idx % w;
      const y = (idx - x) / w;
      const around = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const ni of around) {
        if (ni < 0) continue;
        // 成分内（＝背景色に一致）の隣はリングではない。
        if (isBg[ni] && !visited[ni]) continue;
        if (ringStamp[ni] === generation) continue; // 同じ画素を二重に数えない
        ringStamp[ni] = generation;
        ringCount++;
        // 穴の内部の平均輝度との差＝コントラスト。細い線でも打ち消しが起きない。
        // Sobel 勾配は補助的に併用し、どちらか強いほうを採る（濃淡の差が小さくても
        // 質感の変化で囲まれている場合を拾うため）。
        const contrast = Math.abs(lum[ni] - meanLum);
        const nx = ni % w;
        const sobel = sobelAt(lum, ni, nx, (ni - nx) / w, w, h) >> 3; // スケールを合わせる
        const strength = contrast > sobel ? contrast : sobel;
        ringSum += strength;
        if (strength >= EDGE_STRONG_TH) ringStrong++;
      }
    }
    if (ringCount === 0) continue;
    const closure = ringStrong / ringCount;
    const edgeMean = ringSum / ringCount;

    // (4) 形状の細さ。
    const thickness = componentThickness(component, size, w);

    // (5) 背景色との近さ（成分の平均色で見る）。
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < size; i++) {
      const off = component[i] * 4;
      sr += rgba[off]; sg += rgba[off + 1]; sb += rgba[off + 2];
    }
    let colorDist = Infinity;
    for (const bg of bgColors) {
      const d = Math.max(
        Math.abs(sr / size - bg.r),
        Math.abs(sg / size - bg.g),
        Math.abs(sb / size - bg.b),
      );
      if (d < colorDist) colorDist = d;
    }

    // ── スコアリング ──────────────────────────────────────────────────
    const norm = (v: number, ref: number) => Math.min(1, Math.max(0, v / ref));
    const score =
      HOLE_W_CLOSURE * closure +
      HOLE_W_EDGE * norm(edgeMean, EDGE_REF) +
      HOLE_W_VARIANCE * (1 - norm(sd, VAR_REF)) +
      HOLE_W_THICKNESS * (1 - norm(thickness, thicknessRef)) +
      HOLE_W_COLOR * (1 - norm(colorDist, Math.max(1, tol)));

    if (score < HOLE_SCORE_TH) continue;

    for (let i = 0; i < size; i++) {
      visited[component[i]] = 1;
    }
    filled += size;
  }

  return filled;
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
