/**
 * ComplexStickerTutorialScreen.tsx
 *
 * 複雑な画像を分割する方法のチュートリアル器。
 *
 * 役割:
 * - 横スワイプで手順確認
 * - 上部プログレス表示
 * - 下部ナビゲーション
 * - 各STEPコンポーネントを差し替えて利用
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
} from 'react-native-reanimated';

import Screen from './ui/Screen';
import { AnimatedPressable } from './ui/AnimatedPressable';
import { colors, spacing, radius } from './ui/theme';

import ComplexStep1, { CYCLE_MS as STEP1_MS } from './onboarding/ComplexTutorial/AutoSplitAnimation';
import ComplexStep2, { CYCLE_MS as STEP2_MS } from './onboarding/ComplexTutorial/MergeCellsAnimation';
import ComplexStep3, { CYCLE_MS as STEP3_MS } from './onboarding/ComplexTutorial/FinishAnimation';
import { useT } from '../i18n';


// render は「今そのページが表示中か(active)」を受け取る。
// 表示中のステップだけアニメを回す（全ページ同時に回すと無駄に重く、
// ページを開いた時に途中から始まって見える）。
// durationMs は各ステップのループ長。上部プログレスバーをこの長さで進める。
const STEPS = [
  {
    key: 'step1',
    durationMs: STEP1_MS,
    render: (active: boolean) => <ComplexStep1 active={active} />,
  },
  {
    key: 'step2',
    durationMs: STEP2_MS,
    render: (active: boolean) => <ComplexStep2 active={active} />,
  },
  {
    key: 'step3',
    durationMs: STEP3_MS,
    render: (active: boolean) => <ComplexStep3 active={active} />,
  },
];


/**
 * 上部プログレスバーの1本ぶん。
 * 表示中のステップだけ、そのステップのループ長に合わせて左から伸びる。
 * 済んだステップは満タン、これからのステップは空。
 *
 * Android白化対策として width ではなく scaleX + transformOrigin:'left' で伸ばす
 * （このプロジェクトの分割線アニメと同じ手法）。
 */
function ProgressBar({
  index,
  currentIndex,
  progress,
}: {
  index: number;
  currentIndex: number;
  progress: SharedValue<number>;
}) {
  const fillStyle = useAnimatedStyle(() => {
    const v = index < currentIndex ? 1 : index > currentIndex ? 0 : progress.value;
    return { transform: [{ scaleX: v }] };
  });

  return (
    <View style={styles.progress}>
      <Animated.View style={[styles.progressFill, fillStyle]} />
    </View>
  );
}


interface Props {
  onClose: () => void;
}


export default function ComplexStickerTutorialScreen({
  onClose,
}: Props) {
  const { t } = useT();

  const [currentIndex, setCurrentIndex] = useState(0);

  const [pageW, setPageW] = useState(
    Dimensions.get('window').width
  );

  const scrollRef = useRef<ScrollView>(null);

  // 上部プログレスバーの進行。表示中ステップのループ長に合わせて 0→1 を繰り返す。
  // ページが変わったら頭出しし直す（中のアニメも active 切り替えで頭から再生される）。
  const barProgress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(barProgress);
    barProgress.value = 0;
    barProgress.value = withRepeat(
      withTiming(1, {
        duration: STEPS[currentIndex].durationMs,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      }),
      -1,
      false,
      undefined,
      // 【重要】withRepeat 自身にも指定が要る。withTiming 側だけだと
      // OSの「視差効果を減らす/アニメーションを減らす」でループが無効化され、
      // 1周しただけで止まる（説明用のアニメなので必ず動かす）。
      ReduceMotion.Never,
    );
    return () => cancelAnimation(barProgress);
  }, [currentIndex, barProgress]);

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEPS.length - 1;


  const goTo = (index:number) => {

    const next = Math.max(
      0,
      Math.min(STEPS.length - 1,index)
    );

    setCurrentIndex(next);

    scrollRef.current?.scrollTo({
      x: next * pageW,
      animated:true,
    });
  };


  const onMomentumEnd = (
    e:NativeSyntheticEvent<NativeScrollEvent>
  )=>{

    const index = Math.round(
      e.nativeEvent.contentOffset.x / pageW
    );

    setCurrentIndex(index);
  };


  const footer = (
    <View style={styles.footer}>


      {
        isFirst ?

        <AnimatedPressable
          style={styles.navBtn}
          onPress={onClose}
        >
          <Text style={styles.backTxt}>
            {t('common.back')}
          </Text>
        </AnimatedPressable>

        :

        <AnimatedPressable
          style={styles.navBtn}
          onPress={()=>goTo(currentIndex-1)}
        >
          <Text style={styles.backTxt}>
            {t('common.back')}
          </Text>
        </AnimatedPressable>

      }


      <View style={styles.dots}>
        {
          STEPS.map((_,i)=>(
            <View
              key={i}
              style={[
                styles.dot,
                i===currentIndex && styles.activeDot
              ]}
            />
          ))
        }
      </View>


      <AnimatedPressable
        style={styles.nextBtn}
        onPress={()=>{
          if(isLast){
            onClose();
          }else{
            goTo(currentIndex+1);
          }
        }}
      >

        <Text style={styles.nextTxt}>
          {isLast ? t('common.done') : t('common.next')}
        </Text>

      </AnimatedPressable>


    </View>
  );



  return (

    <Screen
      footer={footer}
      scrollable={false}
      bg={colors.bg}
    >

      <View
        style={styles.fill}
        onLayout={
          e=>setPageW(
            e.nativeEvent.layout.width
          )
        }
      >


        {/* プログレス */}
        <View style={styles.progressRow}>

          {
            STEPS.map((_,i)=>(
              <ProgressBar
                key={i}
                index={i}
                currentIndex={currentIndex}
                progress={barProgress}
              />
            ))
          }

        </View>



        <ScrollView

          ref={scrollRef}

          horizontal
          pagingEnabled

          showsHorizontalScrollIndicator={false}

          onMomentumScrollEnd={
            onMomentumEnd
          }

        >

          {
            STEPS.map((step,i)=>(

              <View
                key={step.key}
                style={[
                  styles.page,
                  {
                    width:pageW
                  }
                ]}
              >

                {step.render(i === currentIndex)}

              </View>

            ))
          }

        </ScrollView>


      </View>


    </Screen>

  );

}



const styles = StyleSheet.create({

fill:{
  flex:1,
},


progressRow:{
  flexDirection:'row',
  gap:4,
  paddingHorizontal:spacing.xl,
  paddingVertical:spacing.sm,
},


progress:{
  flex:1,
  height:4,
  borderRadius:2,
  backgroundColor:'#E3E3E8',
  overflow:'hidden',
},


// 中身は scaleX で伸ばすので、原点を左端に固定する。
progressFill:{
  width:'100%',
  height:4,
  borderRadius:2,
  backgroundColor:colors.accent,
  transformOrigin:'left',
},


page:{
  flex:1,
  justifyContent:'center',
  alignItems:'center',
},


footer:{
  flexDirection:'row',
  alignItems:'center',
  justifyContent:'space-between',
  paddingHorizontal:spacing.xl,
  paddingBottom:spacing.lg,
},


navBtn:{
  minWidth:72,
  paddingVertical:spacing.sm,
},


backTxt:{
  color:colors.secondary,
},


nextBtn:{
  backgroundColor:colors.accent,
  borderRadius:radius.md,
  paddingHorizontal:spacing.lg,
  paddingVertical:spacing.sm,
},


nextTxt:{
  color:'#FFF',
  fontWeight:'600',
},


dots:{
  flexDirection:'row',
  gap:spacing.sm,
},


dot:{
  width:8,
  height:8,
  borderRadius:4,
  backgroundColor:'#DDD',
},


activeDot:{
  width:20,
  backgroundColor:colors.accent,
},


});