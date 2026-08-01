/**
 * splash/ease.ts — パターンの worklet から使う小さな数式ユーティリティ
 *
 * Reanimated の Easing はアニメーション定義用で、worklet 内で「経過msから値を
 * 直接引く」今回の方式には使えないため、必要なぶんだけ関数として持つ。
 * すべて worklet 指定なので UI スレッドから呼べる。
 */

/** 0..1 に丸める。 */
export function clamp01(v: number) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** from..to を 0..1 に正規化(範囲外はクランプ)。 */
export function phase(t: number, from: number, to: number) {
  'worklet';
  if (to <= from) {
    return t >= to ? 1 : 0;
  }
  return clamp01((t - from) / (to - from));
}

/** 線形補間。 */
export function mix(p: number, a: number, b: number) {
  'worklet';
  return a + (b - a) * p;
}

/** 減速(着地・停止に使う)。 */
export function easeOutCubic(p: number) {
  'worklet';
  const u = 1 - p;
  return 1 - u * u * u;
}

/** 加速(落下に使う)。 */
export function easeInQuad(p: number) {
  'worklet';
  return p * p;
}

/** 行って戻る山(0→1→0)。一拍のアクションに使う。 */
export function hump(p: number) {
  'worklet';
  return Math.sin(clamp01(p) * Math.PI);
}

/** 減衰する往復。バウンドや余韻に使う。 */
export function damped(p: number, cycles: number, decay: number) {
  'worklet';
  return Math.sin(clamp01(p) * Math.PI * 2 * cycles) * Math.exp(-decay * clamp01(p));
}
