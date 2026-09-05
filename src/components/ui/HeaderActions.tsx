import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors } from './theme';
import { AnimatedPressable } from './AnimatedPressable';

const ICON_SIZE = 24;

interface Props {
  /** 元画像。分割設定など、本文に置くと画像の邪魔になる画面だけ出す。 */
  showOriginal?: boolean;
  /** この画面の使い方。設定の左に置く。 */
  showHelp?:     boolean;
  showSettings?: boolean;
  onOriginal?:   () => void;
  onHelp?:       () => void;
  onSettings?:   () => void;
}

/**
 * ヘッダー右端。並びは左から「元画像 → ？ → 設定」。
 * 方式変更は分割設定の左下 FAB。ホームは戻る側。
 */
export default function HeaderActions({
  showOriginal,
  showHelp,
  showSettings,
  onOriginal,
  onHelp,
  onSettings,
}: Props) {
  if (!showOriginal && !showHelp && !showSettings) return null;

  return (
    <View style={styles.row}>
      {showOriginal && (
        <AnimatedPressable onPress={onOriginal!} style={styles.btn}>
          <Icon name="image" size={ICON_SIZE} color={colors.accent} />
        </AnimatedPressable>
      )}
      {showHelp && (
        <AnimatedPressable onPress={onHelp!} style={styles.btn}>
          <Icon name="help-outline" size={ICON_SIZE} color={colors.accent} />
        </AnimatedPressable>
      )}
      {showSettings && (
        <AnimatedPressable onPress={onSettings!} style={styles.btn}>
          <Icon name="settings" size={ICON_SIZE} color={colors.accent} />
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  btn: {
    padding: 4,
  },
});
