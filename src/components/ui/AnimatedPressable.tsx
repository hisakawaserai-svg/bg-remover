import React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const SPRING = { damping: 10, mass: 0.5, stiffness: 200 };

type AnimatedPressableProps = {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const AnimatedPressable = ({
  children,
  onPress,
  disabled = false,
  style,
}: AnimatedPressableProps) => {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.5 : opacity.value,
  }));

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => {
        if (disabled) return;
        scale.value   = withSpring(0.8, SPRING);
        opacity.value = withSpring(0.5, SPRING);
      }}
      onPressOut={() => {
        if (disabled) return;
        scale.value   = withSpring(1, SPRING);
        opacity.value = withSpring(1, SPRING);
      }}
    >
      <Animated.View style={[style, animStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};
