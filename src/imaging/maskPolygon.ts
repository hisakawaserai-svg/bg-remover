/**
 * ポリゴン外の画素の alpha を 0 にするマスク処理。
 * cropToImage で bbox を切り出した後の RGBA バッファに適用する想定。
 * 座標は「バッファ内の座標系」（切り出し後の相対座標）で渡すこと。
 */
export function maskOutsidePolygon(
  rgba: Uint8Array,       // 入力 RGBA バッファ（変更しない）
  width: number,          // バッファの幅 (px)
  height: number,         // バッファの高さ (px)
  points: [number, number][],  // ポリゴン頂点（バッファ座標系）
): Uint8Array {
  // 1) 入力バッファをコピー（元データを破壊しない）
  const out = new Uint8Array(rgba);

  // 2) 全画素を走査してポリゴン外を透明化
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // ピクセル中心(+0.5)で判定→端部ピクセルの誤判定を減らす
      if (!pointInPolygon(x + 0.5, y + 0.5, points)) {
        // 3) ポリゴン外: alpha チャンネルのみ 0 に（RGB は残す）
        out[(y * width + x) * 4 + 3] = 0;
      }
    }
  }

  return out;
}

/** どのポリゴンにも囲まれていない不透明領域の bbox（画像座標系）。*/
export interface UncoveredRegion { x: number; y: number; w: number; h: number }

/**
 * 「どのポリゴンにも囲まれていない、絵柄が残っている領域」を探して bbox で返す。
 *
 * ポリゴン編集で囲い漏れがあると、その部分は保存されず黙って消える。
 * プレビューへ進む前に気づけるようにするための検出。
 *
 * alphaThreshold / minAreaPx はノイズ除外のための暫定値。
 * 輪郭のアンチエイリアスや1〜2pxのゴミを拾うと警告が出っぱなしになるので閾値を設けている。
 * 実機で誤検出（囲えているのに警告が出る）や見逃しが多ければ、呼び出し側から
 * opts で調整できるようにしてある。
 */
export function findUncoveredRegions(
  rgba: Uint8Array,
  width: number,
  height: number,
  polygons: { points: [number, number][] }[],
  opts?: { alphaThreshold?: number; minAreaPx?: number },
): UncoveredRegion[] {
  const alphaThreshold = opts?.alphaThreshold ?? 10;
  // 既定は画像面積の 0.03%（最低 40px）。画像サイズに比例させることで、
  // 大きい画像でも小さい画像でも「無視していいゴミ」の感覚を揃える。
  const minAreaPx = opts?.minAreaPx ?? Math.max(40, Math.round(width * height * 0.0003));

  // 1) 各ポリゴンの内側に covered フラグを立てる。
  //    画像全体をポリゴンごとに走査すると O(ポリゴン数 × 全画素) になるので、
  //    そのポリゴンの bbox の中だけを見る。
  const covered = new Uint8Array(width * height);
  for (const poly of polygons) {
    const pts = poly.points;
    if (pts.length < 3) continue; // 面を持たない（点/線）ものは塗りつぶし対象外
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(width - 1, Math.ceil(maxX));
    const y1 = Math.min(height - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const base = y * width;
      for (let x = x0; x <= x1; x++) {
        // maskOutsidePolygon と同じくピクセル中心(+0.5)で判定して端の誤差を減らす
        if (covered[base + x] === 0 && pointInPolygon(x + 0.5, y + 0.5, pts)) {
          covered[base + x] = 1;
        }
      }
    }
  }

  // 2) 「不透明 かつ 未 covered」を uncovered マスクとして立てる（画像全体を1回だけ走査）。
  const uncovered = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (covered[i] === 0 && rgba[i * 4 + 3] > alphaThreshold) uncovered[i] = 1;
  }

  // 3) 4連結の連結成分ラベリングで塊ごとに分け、bbox と面積を求める。
  //    再帰は巨大領域でスタックが溢れるので、明示的なスタックで回す。
  const regions: UncoveredRegion[] = [];
  const stack = new Int32Array(width * height); // 最悪でも全画素ぶんで足りる
  for (let start = 0; start < uncovered.length; start++) {
    if (uncovered[start] !== 1) continue;

    let sp = 0;
    stack[sp++] = start;
    uncovered[start] = 2; // 2 = 訪問済み
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0          && uncovered[idx - 1]     === 1) { uncovered[idx - 1]     = 2; stack[sp++] = idx - 1; }
      if (x < width - 1  && uncovered[idx + 1]     === 1) { uncovered[idx + 1]     = 2; stack[sp++] = idx + 1; }
      if (y > 0          && uncovered[idx - width] === 1) { uncovered[idx - width] = 2; stack[sp++] = idx - width; }
      if (y < height - 1 && uncovered[idx + width] === 1) { uncovered[idx + width] = 2; stack[sp++] = idx + width; }
    }

    // 4) 小さすぎる塊はノイズとして捨てる。
    if (area >= minAreaPx) {
      regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }

  return regions;
}

// レイキャスティング法による点内判定（偶奇規則）。
// 点 (px, py) から +x 方向に半直線を伸ばし、ポリゴン辺との交点数が
// 奇数なら内側、偶数なら外側と判定する。計算量 O(n)。
// 複数ファイルから共通利用するため export する(index.ts, PreviewScreen.tsx から参照)。
export function pointInPolygon(px: number, py: number, points: [number, number][]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    // 辺 j→i が水平線 y=py を跨ぎ、かつ交点が px より右にあれば反転
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
