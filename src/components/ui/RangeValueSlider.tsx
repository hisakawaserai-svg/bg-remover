/**
 * RangeValueSlider — 「大きく現在値を表示 + 両端ラベル付きの連続スライダー」の共通実装
 *
 * LoupeMagnifySlider（倍率, ×12〜×64）と LoupeSizeSlider（サイズ, 80〜220px）が
 * 見た目・挙動（プリセットへの丸め込み無し、1刻み、現在値をリアルタイム表示）を
 * 完全に共有しているため、ここに一本化した。差分は範囲と値の書式(formatValue)だけ。
 */

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useT } from '../../i18n';
import { colors, spacing, typography } from './theme';

// つまみの物理半径ぶん、トラック両端は内側にオフセットして動く。
// ToleranceSlider の THUMB_INSET と同じ考え方（既定値マーカーの位置合わせに使う）。
const THUMB_INSET = Platform.OS === 'android' ? 16 : 12;

interface Props {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** 値の表示書式。既定はそのままの数値文字列。 */
  formatValue?: (v: number) => string;
  label?: string;
  sub?: string;
  /** 行先頭の MaterialIcons 名。設定画面の他の行と揃える。 */
  leadingIcon?: string;
  /** 既定値。指定するとトラック上にマーカーを表示し、値と一致する時は現在値の隣に明示する。 */
  defaultValue?: number;
}

export default function RangeValueSlider({
  value,
  onChange,
  min,
  max,
  formatValue = String,
  label,
  sub,
  leadingIcon,
  defaultValue,
}: Props) {
  const { t } = useT();
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  const defaultPct =
    defaultValue == null ? null : ((defaultValue - min) / (max - min)) * 100;
  const isDefault = defaultValue != null && clamped === defaultValue;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <View style={styles.titleLead}>
          {!!leadingIcon && (
            <Icon name={leadingIcon} size={22} color={colors.secondary} style={styles.leadingIcon} />
          )}
          <View style={styles.titleLeft}>
            {!!label && <Text style={styles.label}>{label}</Text>}
            {!!sub && <Text style={styles.hint}>{sub}</Text>}
          </View>
        </View>
        <Text style={styles.currentValue}>
          {formatValue(clamped)}
          {isDefault && <Text style={styles.defaultTag}>  {t('common.default')}</Text>}
        </Text>
      </View>

      <View style={styles.sliderRow}>
        <Text style={styles.edgeLabel}>{formatValue(min)}</Text>
        <View style={styles.sliderArea}>
          <Slider
            style={styles.slider}
            minimumValue={min}
            maximumValue={max}
            step={1}
            value={clamped}
            onValueChange={v => onChange(Math.round(v))}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.fill}
            thumbTintColor={colors.accent}
          />
          {defaultPct != null && (
            <View style={styles.tickLayer} pointerEvents="none">
              <View style={[styles.defaultTick, { left: `${defaultPct}%` }]} />
            </View>
          )}
        </View>
        <Text style={[styles.edgeLabel, styles.edgeLabelRight]}>{formatValue(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
  },
  titleLead: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: spacing.sm,
  },
  leadingIcon: { marginRight: 10 },
  titleLeft: { flex: 1 },
  label: { fontSize: 16, color: colors.label },
  hint: { fontSize: 12, color: colors.secondary, marginTop: 2 },
  currentValue: {
    ...typography.title,
    color: colors.accent,
  },
  defaultTag: {
    ...typography.caption,
    color: colors.secondary,
    fontWeight: '600',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderArea: {
    flex: 1,
    position: 'relative',
  },
  edgeLabel: {
    ...typography.caption,
    color: colors.secondary,
    width: 36,
  },
  edgeLabelRight: {
    textAlign: 'right',
  },
  slider: {
    width: '100%',
    height: 36,
  },
  // 既定値マーカー。つまみの可動域(THUMB_INSET分の内側)に合わせて配置する。
  tickLayer: {
    position: 'absolute',
    top: 0,
    left: THUMB_INSET,
    right: THUMB_INSET,
    bottom: 0,
    justifyContent: 'center',
  },
  defaultTick: {
    position: 'absolute',
    width: 2,
    height: 10,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.secondary,
    opacity: 0.5,
  },
});
