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
 * （ActivityIndicator はネイティブ側で回るので、JS が止まっていても回り続ける。）
 *
 * overlay: 画面の上に半透明で重ねる使い方。画面を切り替えずに、その場で重い処理を
 * するとき（背景を消す画面で強さを変えて消し直すときなど）に使う。下の画面が
 * 透けて見えるので「今の画面のまま処理している」ことが分かり、タップも受け止める。
 * dark: 暗い画面（範囲の調整など）の上に重ねるとき用。白く光らせないよう黒で暗くする。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from './theme';

interface Props {
  /** 主メッセージ。例: 「画像を読み込んでいます...」 */
  message: string;
  /** 補足。例: 「少々お待ちください」 */
  sub?: string;
  /** true で画面の上に半透明で重ねる（呼び出し側は親の最後の子として置く）。 */
  overlay?: boolean;
  /** overlay と一緒に使う。暗い画面の上で、黒く透ける見た目にする。 */
  dark?: boolean;
}

export default function LoadingView({ message, sub, overlay = false, dark = false }: Props) {
  return (
    <View style={[styles.wrap, overlay && styles.overlay, overlay && dark && styles.overlayDark]}>
      <ActivityIndicator size="large" color={dark ? '#FFF' : colors.accent} />
      <Text style={[styles.msg, dark && styles.msgDark]}>{message}</Text>
      {sub ? <Text style={[styles.sub, dark && styles.subDark]}>{sub}</Text> : null}
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
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    backgroundColor: 'rgba(242,242,247,0.78)',
  },
  overlayDark: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  msgDark: { color: '#FFF' },
  subDark: { color: 'rgba(255,255,255,0.75)' },
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
