import React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const SPRING = { damping: 10, mass: 0.5, stiffness: 200 };

// Pressable 自体をアニメーション対応にすることで、style がそのままレイアウトに使われ
// Animated.View ラッパー不要 → flex/flexDirection/gap など全ての layout prop が正しく動く
const AnimPressable = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 押下時の縮小率。アイコン系は 0.8(デフォルト)、横長ボタンは 0.96 程度を推奨 */
  pressedScale?: number;
};

export const AnimatedPressable = ({
  children,
  onPress,
  disabled = false,
  style,
  pressedScale = 0.8,
}: AnimatedPressableProps) => {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.5 : opacity.value,
  }));

  return (
    <AnimPressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => {
        if (disabled) return;
        scale.value   = withSpring(pressedScale, SPRING);
        opacity.value = withSpring(0.5, SPRING);
      }}
      onPressOut={() => {
        if (disabled) return;
        scale.value   = withSpring(1, SPRING);
        opacity.value = withSpring(1, SPRING);
      }}
      style={[style, animStyle]}
    >
      {children}
    </AnimPressable>
  );
};
