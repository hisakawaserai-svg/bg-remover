import React from 'react';
import { View, Text } from 'react-native';

interface Props {
  onClose: () => void;
}

export default function ComplexStickerTutorialScreen({ onClose }: Props) {
  return (
    <View>
      <Text>複雑な画像の分割方法</Text>
    </View>
  );
}