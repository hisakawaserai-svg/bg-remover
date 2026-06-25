/**
 * ScreenHeader.tsx — 画面タイトルヘッダー
 *
 * ツール系らしく「いま何の画面か」を大きなタイトルで一目示す。
 * subtitle で「N枚処理中」「ポリゴン編集中」などの状態を添える。
 * right に TouchableOpacity を渡せばヘッダーアクション（保存・設定）を置ける。
 *
 * Usage:
 *   <ScreenHeader title="切り出し" subtitle="3枚のポリゴン" />
 *   <ScreenHeader title="設定" right={<SaveButton />} />
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, spacing, typography } from './theme';

interface Props {
  title: string;
  subtitle?: string;
  /** ヘッダー右端に配置するアクション（ボタンやアイコン） */
  right?: React.ReactNode;
  style?: ViewStyle;
}

export default function ScreenHeader({ title, subtitle, right, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      {/* タイトル + サブテキストの縦並び */}
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* 右側アクション（省略可） */}
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // 下ボーダーで画面コンテンツと区切る（shadow より軽量）
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.card,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical:   spacing.md,
    gap:               spacing.sm,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    ...typography.largeTitle,
    color: colors.label,
  },
  subtitle: {
    ...typography.caption,
    color:     colors.secondary,
    marginTop: 2,
  },
  right: {
    // right コンテンツのタッチ領域を確保
    alignItems: 'flex-end',
  },
});
