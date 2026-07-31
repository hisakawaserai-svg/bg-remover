/**
 * Chip.tsx — メタ情報バッジ（小バッジ）
 *
 * 枚数・モード名・サイズ・状態などのメタ情報をコンパクトに表示する。
 * tone で色を切り替え、icon（ReactNode）を左に添えられる。
 *
 * tone:
 *   'default' — グレー（中立的な情報）
 *   'accent'  — 青（アクティブ・選択中）
 *   'danger'  — 赤（削除・警告）
 *
 * Usage:
 *   <Chip label="3枚" tone="accent" />
 *   <Chip label="手動モード" icon={<Icon name="edit" size={11} color={colors.accent} />} tone="accent" />
 *   <Chip label="削除" tone="danger" />
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from './theme';

type Tone = 'default' | 'accent' | 'danger';

interface Props {
  label: string;
  tone?: Tone;
  /** アイコンや小さいViewを左端に置ける */
  icon?: React.ReactNode;
}

// トーン別の配色定義
const TONE_STYLES: Record<Tone, { bg: string; text: string }> = {
  default: { bg: colors.fill,        text: colors.secondary },
  accent:  { bg: colors.accentMuted, text: colors.accent    },
  danger:  { bg: colors.dangerMuted, text: colors.danger    },
};

export default function Chip({ label, tone = 'default', icon }: Props) {
  const { bg, text } = TONE_STYLES[tone];

  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      {/* 英語はラベルが長くなる。折り返さず1行に収め、
          収まらない時は隣のテキストではなくチップ側が縮むようにする。 */}
      <Text style={[styles.label, { color: text }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection:  'row',
    alignItems:     'center',
    alignSelf:      'flex-start', // テキスト幅に収縮
    borderRadius:   radius.pill,
    paddingVertical:   spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    // チップは縮めない。状態を表す短い語なので削られると意味が失われる。
    // 幅が足りない時は、隣のタイトル側を折り返して吸収させる
    // （App.tsx の sessionCardLabel は numberOfLines={2}）。
    flexShrink: 0,
  },
  icon: {
    // アイコンが small size でも tap area に干渉しないよう独立配置
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.caption2,
  },
});
