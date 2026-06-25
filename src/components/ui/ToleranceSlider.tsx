/**
 * ToleranceSlider — 3スナップ（弱/中/強）の許容値スライダー
 *
 * tolerance(15/30/50) を読み書きする共通 UI。
 * SetupScreen / ResultScreen で同一コンポーネントを使う。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { colors, radius, shadow, spacing, typography } from './theme';
import { useSettings } from '../../settings/SettingsContext';

const TOLERANCE_STEPS = [15, 30, 50] as const;
const STRENGTH_LABELS = ['弱', '中', '強'] as const;

function toleranceToSlider(t: number): number {
  if (t <= 15) return 0;
  if (t <= 30) return 1;
  return 2;
}

interface Props {
  /** ラベル行（タイトル＋ヒント）を表示するか。デフォルト true */
  showLabel?: boolean;
}

export default function ToleranceSlider({ showLabel = true }: Props) {
  const { settings, updateSettings } = useSettings();
  const sliderVal = toleranceToSlider(settings.tolerance);

  const handleComplete = (v: number) => {
    const tolerance = TOLERANCE_STEPS[Math.round(v)] ?? 30;
    void updateSettings({ tolerance });
  };

  return (
    <View style={styles.wrap}>
      {showLabel && (
        <View style={styles.titleRow}>
          <Text style={styles.label}>分割の強さ</Text>
          <Text style={styles.hint}>合体するなら上げる</Text>
        </View>
      )}
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={2}
        step={1}
        value={sliderVal}
        onSlidingComplete={handleComplete}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.fill}
        thumbTintColor={colors.accent}
      />
      <View style={styles.labelRow}>
        {STRENGTH_LABELS.map(l => (
          <Text key={l} style={styles.stepLabel}>{l}</Text>
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
  slider: {
    width: '100%',
    height: 40,
  },
  labelRow: {
    flexDirection: 'row',
    // Android の Slider は内側に ~10dp のパディングがあるため、
    // ラベル行を同じぶん内側に寄せてサム位置に合わせる
    paddingHorizontal: 10,
    marginTop: -spacing.xs,
  },
  stepLabel: {
    ...typography.caption,
    color: colors.secondary,
    flex: 1,
    textAlign: 'center',
  },
});
