/**
 * FadeInView — opacity 0→1 + translateY 12→0 のフェードインを子要素に適用する。
 *
 * 使い方:
 *   <FadeInView delay={100}>
 *     <MyCard />
 *   </FadeInView>
 *
 * stagger（順番登場）は、親から delay を 0, 100, 200... とずらして渡すだけで実現できる。
 * アニメロジックをここに集約することで、各画面は delay の数値を変えるだけでよい。
 *
 * useNativeDriver:true にしているため、JS スレッドを止めずに GPU で描画される。
 * opacity と transform のみ対応（layout 系プロパティは nativeDriver 非対応）。
 */

import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** アニメ開始までの遅延(ms)。stagger のために親から差をつけて渡す。デフォルト 0。 */
  delay?: number;
  /** フェードイン完了までの時間(ms)。デフォルト 400。 */
  duration?: number;
}

export default function FadeInView({ children, delay = 0, duration = 400 }: Props) {
  // アニメーション値: 0 = 透明・下、1 = 不透明・定位置
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // マウント時に1回だけ再生。delay 後にスタートする。
    Animated.timing(anim, {
      toValue:         1,
      duration,
      delay,
      useNativeDriver: true, // opacity と transform は GPU 側で処理できる
    }).start();
  // anim は ref なので deps に入れない（マウント時1回のみが意図）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{
          // 0→1 にかけて 12px 下から定位置へ滑らかに浮き上がる
          translateY: anim.interpolate({
            inputRange:  [0, 1],
            outputRange: [12, 0],
          }),
        }],
      }}
    >
      {children}
    </Animated.View>
  );
}
