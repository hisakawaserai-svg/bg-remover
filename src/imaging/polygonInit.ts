/**
 * polygonInit.ts — 初期ポリゴンの生成。
 *
 * 自動検出した bbox をそのまま四角にすると、輪郭にぴったり張り付いた状態から
 * 編集が始まる。アンチエイリアスの薄い縁や、髪の毛のような細い部分は bbox 判定に
 * 乗らないことがあり、そのまま書き出すと端が欠ける。
 * 少し外側へ膨らませておけば、欠けを直す作業ではなく「余分を削る」作業から
 * 始められる。削るほうが、足りない部分を探して足すより気付きやすい。
 *
 * 膨らませるのは【自動生成の瞬間だけ】。ユーザーが頂点を動かした後の形や、
 * 保存済みのポリゴンには一切触らない（触ると、直したはずの形が開くたびに
 * 太っていくことになる）。
 */
import type { BBox } from './splitObjects';

/**
 * 対象の大きさに対する余白の割合。
 * 小さいスタンプには小さく、大きいスタンプには大きく付く。
 */
export const INIT_PAD_RATIO = 0.04;
/**
 * 画像の短辺に対する余白の下限の割合。
 * 極端に小さい bbox でも最低限の余裕を確保するために使う。
 */
export const INIT_PAD_MIN_RATIO = 0.004;
/** 余白の絶対的な下限(px)。小さい画像で 0 になるのを防ぐ。 */
export const INIT_PAD_MIN_PX = 2;

/**
 * bbox を少し外側へ広げた四角形の頂点を返す（画像の外へは出さない）。
 *
 * 余白は「対象の大きさ」と「画像の短辺」の両方から決める。
 * 対象基準だけだと極小の bbox でほぼ 0 になり、画像基準だけだと
 * 小さいスタンプに対して余白が大きすぎるため、両者の大きいほうを採る。
 */
export function initialRectFromBBox(
  bbox: BBox,
  imgW: number,
  imgH: number,
): Array<[number, number]> {
  const bw = bbox.maxX - bbox.minX + 1;
  const bh = bbox.maxY - bbox.minY + 1;

  const pad = Math.max(
    INIT_PAD_MIN_PX,
    Math.round(Math.min(imgW, imgH) * INIT_PAD_MIN_RATIO),
    Math.round(Math.min(bw, bh) * INIT_PAD_RATIO),
  );

  // 画像の外へはみ出させない。はみ出したポリゴンは切り出し時に
  // クランプされるので実害は小さいが、頂点を掴めなくなるため中に収める。
  const x0 = Math.max(0, bbox.minX - pad);
  const y0 = Math.max(0, bbox.minY - pad);
  const x1 = Math.min(imgW - 1, bbox.maxX + pad);
  const y1 = Math.min(imgH - 1, bbox.maxY + pad);

  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
