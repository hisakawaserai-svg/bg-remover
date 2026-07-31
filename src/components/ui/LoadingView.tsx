/**
 * LoadingView.tsx — 全画面のローディング表示
 *
 * 重い処理に入る前に「今なにを待っているのか」を出すための画面。
 * 特にポリゴン編集への遷移は、SkImage の生成と splitConnected(連結成分の走査)を
 * マウント時に同期で回すため、画像が大きいと数百ms〜数秒 JS スレッドが止まる。
 * その間なにも出ないと固まったように見えるので、先にこの画面を描いてから
 * 重い処理を始める（呼び出し側で1〜2フレーム遅らせてマウントする）。
 *
 * 注意: この表示自体は JS スレッドが止まれば当然アニメも止まる。
 * 「固まる時間をなくす」ものではなく「何を待っているか分かるようにする」もの。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from './theme';

interface Props {
  /** 主メッセージ。例: 「画像を読み込んでいます...」 */
  message: string;
  /** 補足。例: 「少々お待ちください」 */
  sub?: string;
}

export default function LoadingView({ message, sub }: Props) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.msg}>{message}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
    padding: spacing.xl,
  },
  msg: {
    ...typography.headline,
    color: colors.label,
    textAlign: 'center',
  },
  sub: {
    ...typography.caption,
    color: colors.secondary,
    textAlign: 'center',
  },
});
