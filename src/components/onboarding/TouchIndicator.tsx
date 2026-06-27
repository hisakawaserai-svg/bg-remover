/**
 * TouchIndicator.tsx — オンボーディング共通タッチ表現(View版)
 *
 * 手動チュートリアル(PolygonTutorialScreen)のタッチ表現を Skia 非依存で再実装。
 *   - リップル: 広がって消える半透明の円(scale + opacity)
 *   - タップ点: 小さい緑丸 + 白縁(指カーソル相当)
 * 「この瞬間にここを押した」が見えるよう、進行 SharedValue の時間窓で再生する。
 *
 * 配置: 親 View の中央に重なる(RN の position:absolute は親基準)。
 *   操作対象の要素の子として置けば、その要素の中心にタップ表現が出る。
 *
 * Android白化対策: transform(scale)/opacity のみ。width/height/border は静的。
 */
import React from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';

// 手動チュートリアル準拠の色・サイズ
const RIPPLE = 44; // リップル最大径(px) — 半径22は tutorial の tapR 上限と一致
const DOT = 16;    // タップ点の径(px) — tutorial FINGER_R(7)*2 相当

function norm(p: number, a: number, b: number) {
  'worklet';
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}
function easeIO(t: number) {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface Props {
  /** オンボの進行 SharedValue(0→1 ループ) */
  progress: SharedValue<number>;
  /** タップ再生の時間窓 [開始, 終了]。この間にリップルが広がる。 */
  window: [number, number];
  /** タップ点/リップルの色。既定は手動チュートリアルと同じ緑。 */
  color?: string;
  /** 中央からのオフセット位置(親中心が基準でない場合の微調整) */
  style?: StyleProp<ViewStyle>;
}

export default function TouchIndicator({
  progress,
  window,
  color = '#30D158',
  style,
}: Props) {
  const [a, b] = window;

  // リップル: window 全体で scale 0.3→1、opacity 0.35→0
  const rippleStyle = useAnimatedStyle(() => {
    const t = norm(progress.value, a, b);
    const visible = progress.value >= a && progress.value <= b;
    const scale = 0.3 + easeIO(t) * 0.7;
    return { opacity: visible ? (1 - t) * 0.35 : 0, transform: [{ scale }] };
  });

  // タップ点: window 頭で素早く出て、押し込み(scale)→末尾でフェードアウト
  const dotStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const inEnd = a + (b - a) * 0.25;
    let o = 0;
    if (p < a)          o = 0;
    else if (p < inEnd) o = norm(p, a, inEnd);
    else if (p < b)     o = 1;
    else                o = 1 - norm(p, b, b + 0.04);
    // 押し込み: 出現時に 0.85→1
    const press = p >= a && p < inEnd ? 0.85 + norm(p, a, inEnd) * 0.15 : 1;
    return { opacity: o, transform: [{ scale: press }] };
  });

  return (
    <View pointerEvents="none" style={[styles.center, style]}>
      <Animated.View style={[styles.ripple, { backgroundColor: color }, rippleStyle]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, dotStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: RIPPLE,
    height: RIPPLE,
    borderRadius: RIPPLE / 2,
  },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
});
