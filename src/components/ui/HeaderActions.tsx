import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors } from './theme';
import { AnimatedPressable } from './AnimatedPressable';

const ICON_SIZE = 24;
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

interface Props {
  /** 表示するアイコンの種類。省略すると非表示。 */
  showHome?:     boolean;
  showSettings?: boolean;
  onHome?:     () => void;
  onSettings?: () => void;
}

/**
 * ヘッダー右端に配置するアイコン群の共通コンポーネント。
 * home・settings の表示/非表示と onPress を props で制御する。
 *
 * アイコン: MaterialIcons "home" / "settings"（歯車）に統一。
 * 色:       colors.accent (#007AFF)。
 * タッチ領域: hitSlop で 44pt 以上を確保。
 */
export default function HeaderActions({
  showHome,
  showSettings,
  onHome,
  onSettings,
}: Props) {
  if (!showHome && !showSettings) return null;

  return (
    <View style={styles.row}>
      {showHome && (
        <AnimatedPressable onPress={onHome!} style={styles.btn}>
          <Icon name="home" size={ICON_SIZE} color={colors.accent} />
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
