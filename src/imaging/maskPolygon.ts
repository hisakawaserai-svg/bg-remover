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
