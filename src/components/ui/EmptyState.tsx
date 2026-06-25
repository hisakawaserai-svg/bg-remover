/**
 * EmptyState.tsx — 空状態・未処理状態のプレースホルダー
 *
 * 画像未選択・処理結果ゼロ・エラー後などに表示する。
 * 中央寄せ・secondary色・余白たっぷりで「次に何をすべきか」を示す。
 *
 * icon には MaterialIcons の <Icon> や絵文字 <Text> など ReactNode を渡す。
 * action は省略可。渡す場合は <TouchableOpacity> を丸ごと渡す。
 *
 * Usage:
 *   <EmptyState
 *     icon={<Icon name="image-search" size={48} color={colors.separator} />}
 *     title="画像が選ばれていません"
 *     description="ギャラリーから画像を選択してください"
 *     action={<TouchableOpacity onPress={pick}><Text>選択する</Text></TouchableOpacity>}
 *   />
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, spacing, typography } from './theme';

interface Props {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** オプションのアクション（ボタン全体を ReactNode で渡す） */
  action?: React.ReactNode;
  style?: ViewStyle;
}

export default function EmptyState({ icon, title, description, action, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      {/* アイコンエリア: secondary色の大きめシンボル */}
      <View style={styles.iconWrap}>
        {icon}
      </View>

      {/* タイトル */}
      <Text style={styles.title}>{title}</Text>

      {/* 説明文 */}
      <Text style={styles.description}>{description}</Text>

      {/* アクション（省略可） */}
      {action ? <View style={styles.actionWrap}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical:   spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    // アイコンを少し大きめ余白で包んで視覚的な重心を作る
    marginBottom: spacing.sm,
    opacity: 0.45,
  },
  title: {
    ...typography.headline,
    color:     colors.label2,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color:      colors.secondary,
    textAlign:  'center',
    lineHeight: 22,
  },
  actionWrap: {
    marginTop: spacing.lg,
  },
});
