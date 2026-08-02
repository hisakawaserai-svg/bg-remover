/**
 * restoreBrush.ts — 消えすぎた部分を元画像から復元するブラシ。
 *
 * 【なぜ alpha だけ戻すのか】
 * 背景除去は alpha を 0 にするだけで、RGB は元の色を残している
 * （フェザリングが掛かった境界画素だけは RGB も書き換わる）。
 * なので「元に戻す」に必要なのは alpha だけで、RGB は現在の透過結果の
 * ものをそのまま使ってよい。RGB まで元画像で上書きすると、せっかく
 * フェザリングで背景色を差し引いた境界がまた白フチに戻ってしまう。
 *
 * 【なぜ元画像が要るのか】
 * 現在の透過結果には「そこが元々どれだけ不透明だったか」が残っていない
 * （消えた画素は一律 alpha=0）。元画像の alpha を参照して初めて復元できる。
 */

/** ブラシの1ストローク。点の列と半径（画像px）で表す。 */
export interface RestoreStroke {
  points: Array<[number, number]>;
  radius: number;
}

/**
 * ストロークがなぞった範囲の alpha を元画像の値に戻す（破壊的）。
 *
 * offsetX/offsetY は、rgba が元画像の一部を切り出したものである場合に、
 * その左上が元画像のどこかを示す（セル編集で使う）。
 * ストロークの座標は元画像の座標系で渡すこと。操作列は常に元画像1枚に
 * 対する記録なので、そこに合わせておけば切り出し方が変わっても再現できる。
 *
 * 返り値は実際に alpha を書き換えた画素数。
 */
export function applyRestoreStroke(
  rgba: Uint8Array,
  baseRgba: Uint8Array,
  width: number,
  height: number,
  baseWidth: number,
  baseHeight: number,
  stroke: RestoreStroke,
  offsetX = 0,
  offsetY = 0,
): number {
  const r = Math.max(0.5, stroke.radius);
  const rSq = r * r;
  let changed = 0;

  // 指のタッチイベントは速く動かすと数十px飛ぶ。来た点だけを塗ると跡が点線に
  // なるので、必ず間を埋めてから塗る。記録側ではなくここで埋めることで、
  // 操作列を再生した時も同じ結果になる。
  const points = densifyStroke(stroke.points, r);

  for (const [gx, gy] of points) {
    // 元画像座標 → このバッファ内の座標。
    const cx = gx - offsetX;
    const cy = gy - offsetY;

    // 半径が 1px 未満だと、円の判定だけでは1画素も掛からないことがある
    // （中心が画素の境目に落ちた場合）。細いブラシで「なぞっても何も起きない」
    // のを防ぐため、中心の画素だけは必ず対象にする。
    const ccx = Math.round(cx);
    const ccy = Math.round(cy);
    if (ccx >= 0 && ccy >= 0 && ccx < width && ccy < height) {
      const bx0 = ccx + offsetX;
      const by0 = ccy + offsetY;
      if (bx0 >= 0 && by0 >= 0 && bx0 < baseWidth && by0 < baseHeight) {
        const d0 = (ccy * width + ccx) * 4 + 3;
        const s0 = (by0 * baseWidth + bx0) * 4 + 3;
        if (rgba[d0] < baseRgba[s0]) { rgba[d0] = baseRgba[s0]; changed++; }
      }
    }

    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > rSq) continue;

        // 元画像側の座標。切り出しの外を指すことは無いはずだが、
        // 丸め誤差や不正な bbox で範囲外を読まないよう必ず確認する。
        const bx = x + offsetX;
        const by = y + offsetY;
        if (bx < 0 || by < 0 || bx >= baseWidth || by >= baseHeight) continue;

        const dst = (y * width + x) * 4 + 3;
        const src = (by * baseWidth + bx) * 4 + 3;
        // 元より濃くはしない。すでに元と同じかそれ以上なら触らないことで、
        // 同じ場所を何度なぞっても結果が変わらない（冪等）。
        if (rgba[dst] >= baseRgba[src]) continue;
        rgba[dst] = baseRgba[src];
        changed++;
      }
    }
  }
  return changed;
}

/**
 * 2点間を半径に応じた間隔で補間する。
 *
 * タッチイベントは指の速さによっては数十px飛ぶので、来た点だけを塗ると
 * ブラシの跡が点線になる。間を埋めてから記録する。
 */
export function densifyStroke(
  points: Array<[number, number]>,
  radius: number,
): Array<[number, number]> {
  if (points.length <= 1) return points.slice();
  const step = Math.max(1, radius * 0.5);
  const out: Array<[number, number]> = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(dist / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
    out.push([x1, y1]);
  }
  return out;
}
