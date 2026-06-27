/**
 * ToleranceSlider — 連続値＋ソフトスナップの「分割の強さ」スライダー
 *
 * tolerance(0〜100連続) を読み書きする共通 UI。
 * 値の状態は外（呼び出し側）が持つ。useSettings を内部で直接叩かないことで
 * SetupScreen / SettingsScreen 双方で使い回せる。
 *
 * ソフトスナップ:
 *   スライド中(onChange)は生の値をそのまま反映 → 間の任意値に置ける。
 *   指を離した時(onComplete)だけ、弱/中/強の近傍(±snapRadius)なら寄せる。
 *   スナップ時はつまみを reanimated でアニメ移動し、目盛りを強調する。
 */

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import {
  useSharedValue,
  withTiming,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import { colors, radius, shadow, spacing, typography } from './theme';

// 弱/中/強のスナップ点。値とラベルを1箇所で対応管理する（将来ズレないように）。
interface Snap {
  value: number;
  label: string;
}
const SNAPS: Snap[] = [
  { value: 15, label: '弱' },
  { value: 30, label: '中' },
  { value: 50, label: '強' },
];

// Slider のつまみ半径ぶん、トラック両端は内側にオフセットしてつまみが移動する。
// 目盛り・ラベル・つまみすべてを同じ変換 x = INSET + 比率 *(幅 - 2*INSET) に揃えるため、
// このインセットを目盛り/ラベル帯の左右パディングとして使う（中心 v=50 で誤差ゼロ）。
// 値は実機のつまみ半径に合わせる: Android は標準つまみが大きめ（実測で左ズレ→半径>12）。
// ズレが残る場合はこの定数だけ微調整すれば全点に一貫して効く。
const THUMB_INSET = Platform.OS === 'android' ? 16 : 12;

interface Props {
  value: number;
  onChange: (v: number) => void;
  onComplete?: (v: number) => void;
  /** スナップ点（値＋ラベル）。デフォルト 弱15/中30/強50 */
  snaps?: Snap[];
  /** スナップの吸い付き半径（tolerance 単位）。デフォルト 5 */
  snapRadius?: number;
  min?: number;
  max?: number;
  /** ラベル行（タイトル＋ヒント）を表示するか。デフォルト true */
  showLabel?: boolean;
  /** カード装飾（背景・影・パディング）を外して素のスライダーだけ描く。
   *  既にカード内に置く場合（設定画面など）に二重カードを避けるため。 */
  bare?: boolean;
}

export default function ToleranceSlider({
  value,
  onChange,
  onComplete,
  snaps = SNAPS,
  snapRadius = 5,
  min = 0,
  max = 100,
  showLabel = true,
  bare = false,
}: Props) {
  // つまみ位置の表示用。スナップ時はここをアニメで動かす（親の値とは別管理）。
  const [displayValue, setDisplayValue] = useState(value);
  // 直近で吸い付いたスナップ値（目盛り強調用）。null = 吸い付いていない。
  const [activeSnap, setActiveSnap] = useState<number | null>(null);

  // つまみアニメ用 SharedValue。worklet で補間し displayValue へ反映する。
  const anim = useSharedValue(value);

  // 外部から value が変わった場合（リセット等）は表示も追従する。
  useEffect(() => {
    setDisplayValue(value);
    anim.value = value;
  }, [value, anim]);

  // anim の変化を JS 側 state に橋渡し（アニメ中の各フレームでつまみを動かす）。
  useAnimatedReaction(
    () => anim.value,
    v => {
      runOnJS(setDisplayValue)(v);
    },
  );

  const handleValueChange = (v: number) => {
    // スライド中は生値そのまま。吸い付き強調も解除。
    setActiveSnap(null);
    setDisplayValue(v);
    anim.value = v;
    onChange(v);
  };

  const handleComplete = (v: number) => {
    // 弱/中/強の近傍なら寄せる。近傍が無ければ任意値のまま確定。
    const near = snaps.find(s => Math.abs(v - s.value) <= snapRadius);
    const final = near ? near.value : v;

    if (near) {
      // つまみをスナップ点へアニメ移動（瞬間移動にしない）。
      anim.value = v; // 念のため現在位置から開始
      anim.value = withTiming(final, { duration: 150 });
      setActiveSnap(final);
      // 触覚フィードバックは見送り（Android の VIBRATE 権限が無くクラッシュするため）。
      // 吸い付きは withTiming のアニメ＋目盛り強調の視覚のみで表現する。
    } else {
      setActiveSnap(null);
      setDisplayValue(final);
      anim.value = final;
    }

    onChange(final);
    onComplete?.(final);
  };

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <View style={bare ? styles.wrapBare : styles.wrap}>
      {showLabel && (
        <View style={styles.titleRow}>
          <Text style={styles.label}>分割の強さ</Text>
          <Text style={styles.hint}>合体するなら上げる</Text>
        </View>
      )}

      <View style={styles.sliderArea}>
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={1}
          value={displayValue}
          onValueChange={handleValueChange}
          onSlidingComplete={handleComplete}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.fill}
          thumbTintColor={colors.accent}
        />
        {/* スナップ点の目盛り（実値の比率位置）。タッチは透過。 */}
        <View style={styles.tickLayer} pointerEvents="none">
          {snaps.map(s => (
            <View
              key={s.value}
              style={[
                styles.tick,
                { left: `${pct(s.value)}%` },
                activeSnap === s.value && styles.tickActive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* ラベルもスナップ点の実値の比率位置に置く（吸い付く点の真下）。 */}
      <View style={styles.labelLayer}>
        {snaps.map(s => (
          <Text
            key={s.value}
            style={[
              styles.stepLabel,
              { left: `${pct(s.value)}%` },
              activeSnap === s.value && styles.stepLabelActive,
            ]}
          >
            {s.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    ...shadow.xs,
  },
  // カード装飾なし版（既存 Card の内側に置くとき用）。横パディングのみ揃える。
  wrapBare: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.secondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: {
    ...typography.caption,
    color: colors.secondary,
  },
  sliderArea: {
    position: 'relative',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  // 目盛り/ラベルは左右に THUMB_INSET ぶん詰めた帯の中で % 配置する。
  // これでつまみと同じ「INSET + 比率 *(幅 - 2*INSET)」変換になり位置が一致する。
  tickLayer: {
    position: 'absolute',
    top: 0,
    left: THUMB_INSET,
    right: THUMB_INSET,
    bottom: 0,
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 10,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.secondary,
    opacity: 0.4,
  },
  tickActive: {
    backgroundColor: colors.accent,
    opacity: 1,
    height: 14,
  },
  labelLayer: {
    position: 'relative',
    height: 16,
    marginHorizontal: THUMB_INSET,
    marginTop: -spacing.xs,
  },
  stepLabel: {
    ...typography.caption,
    position: 'absolute',
    color: colors.secondary,
    transform: [{ translateX: -8 }], // ラベル幅の半分ぶん左へ寄せて中央合わせ
    textAlign: 'center',
    minWidth: 16,
  },
  stepLabelActive: {
    color: colors.accent,
    fontWeight: '700',
  },
});
