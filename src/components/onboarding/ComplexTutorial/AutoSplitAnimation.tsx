// AutoSplitAnimation.tsx

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';

export default function AutoSplitAnimation() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 1200,
    });
  }, []);

  const verticalStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scaleY: progress.value,
      },
    ],
  }));

  const horizontalStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: progress.value,
      },
    ],
  }));

  return (
    <View style={styles.container}>
      {/* スタンプシート */}
      <View style={styles.sheet}>

        {/* 横分割線 */}
        <Animated.View
          style={[
            styles.horizontalLine,
            horizontalStyle,
          ]}
        />

        {/* 縦分割線 */}
        <Animated.View
          style={[
            styles.verticalLine,
            verticalStyle,
          ]}
        />

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{
    height:220,
    justifyContent:'center',
    alignItems:'center',
  },

  sheet:{
    width:160,
    height:160,
    backgroundColor:'#DDD',
    borderRadius:16,
    overflow:'hidden',
  },

  horizontalLine:{
    position:'absolute',
    top:'50%',
    left:0,
    right:0,
    height:3,
    backgroundColor:'#007AFF',
    transformOrigin:'left',
  },

  verticalLine:{
    position:'absolute',
    left:'50%',
    top:0,
    bottom:0,
    width:3,
    backgroundColor:'#007AFF',
    transformOrigin:'top',
  },
});