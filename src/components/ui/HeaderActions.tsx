import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors } from './theme';
import { AnimatedPressable } from './AnimatedPressable';

const ICON_SIZE = 24;
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

interface Props {
  /** 表示するアイコンの種類。省略すると非表示。 */
  showHome?:          boolean;
  showSettings?:      boolean;
  showOriginalImage?: boolean;
  /** 背景除去の方式を変えてやり直す（Visionが使える端末でのみ呼び出し側が true にする）。 */
  showChangeEngine?:  boolean;
  onHome?:            () => void;
  onSettings?:        () => void;
  onOriginalImage?:   () => void;
  onChangeEngine?:    () => void;
}

/**
 * ヘッダー右端に配置するアイコン群の共通コンポーネント。
 * home・settings・originalImage の表示/非表示と onPress を props で制御する。
 *
 * アイコン: MaterialIcons "home" / "settings" / "image"（元画像）に統一。
 * 色:       colors.accent (#007AFF)。
 * タッチ領域: hitSlop で 44pt 以上を確保。
 */
export default function HeaderActions({
  showHome,
  showSettings,
  showOriginalImage,
  showChangeEngine,
  onHome,
  onSettings,
  onOriginalImage,
  onChangeEngine,
}: Props) {
  if (!showHome && !showSettings && !showOriginalImage && !showChangeEngine) return null;

  return (
    <View style={styles.row}>
      {showChangeEngine && (
        <AnimatedPressable onPress={onChangeEngine!} style={styles.btn}>
          <Icon name="auto-awesome" size={ICON_SIZE} color={colors.accent} />
        </AnimatedPressable>
      )}
      {showOriginalImage && (
        <AnimatedPressable onPress={onOriginalImage!} style={styles.btn}>
          <Icon name="image" size={ICON_SIZE} color={colors.accent} />
        </AnimatedPressable>
      )}
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
