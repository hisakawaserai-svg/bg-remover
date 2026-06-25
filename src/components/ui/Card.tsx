/**
 * Card.tsx — 汎用カードラッパー
 *
 * 白背景・radius16・subtle shadow・padding16 を標準として持つ。
 * ツール系画面の各セクション・設定行・サムネイルエリアで使い回す。
 *
 * Usage:
 *   <Card>...</Card>
 *   <Card style={{ marginTop: spacing.md }}>...</Card>
 *   <Card padding={spacing.sm}>...</Card>  ← padding を上書き可
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing } from './theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** デフォルト: spacing.lg (16px) */
  padding?: number;
}

export default function Card({ children, style, padding = spacing.lg }: Props) {
  return (
    <View style={[styles.card, { padding }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius:    radius.lg,
    // iOS 風 shadow（theme.shadow.sm を展開）
    ...shadow.sm,
    // Android: elevation だけで十分なので shadow 系は効かないが問題なし
  },
});
