/**
 * OnboardingScreen.tsx — 全体オンボーディング(SVG版) ①器(ナビ骨組み)
 *
 * 4ステップを横スワイプ + 下部ボタンで切り替えるコンテナ。
 * 今回は中身を仮プレースホルダー(テキスト+色違い矩形)とし、
 * 各ステップの SVG/アニメは後のステップで STEPS 配列の render を差し替える。
 *
 * ナビゲーション:
 *   下部固定 [戻る]  ●●●●(ドット)  [次へ/はじめる]
 *   - currentIndex===0 では「戻る」を非表示
 *   - 最終ステップでは「次へ」→「はじめる」になり onComplete を呼ぶ
 *   - 横スワイプ(pagingEnabled ScrollView)とボタンの双方で切り替え可能
 *
 * 初回ゲートへの接続は後のステップで行う(今回は未接続)。
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
  withTiming,
  withRepeat,
  Easing,
  SharedValue,
} from 'react-native-reanimated';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen from './ui/Screen';
import { colors, spacing, radius } from './ui/theme';
import OnboardingStep1 from './onboarding/OnboardingStep1';
import OnboardingStep2 from './onboarding/OnboardingStep2';
import OnboardingStep3 from './onboarding/OnboardingStep3';
import OnboardingStep4 from './onboarding/OnboardingStep4';

// ステップが active になるときに translateY で滑り込ませる量(transform のみ)。
const SLIDE_Y = 28;

// 各ステップのアニメ1ループ長(ms)。プログレスバーをそのステップの再生に同期させる。
// 各 OnboardingStepN の CYCLE_MS と対応(ズレたらここを合わせる)。
const STEP_DURATIONS = [12000, 13000, 11000, 11000];

/**
 * ProgressSegment — 動画(ストーリーズ)風プログレスバーの1ステップ分。
 * done=済(満タン) / active=再生中(progress に追従して 0→1 ループ) / それ以外=空。
 * 伸びは scaleX(transformOrigin:left)のみ＝白化回避。
 */
function ProgressSegment({ progress, active, done }: {
  progress: SharedValue<number>; active: boolean; done: boolean;
}) {
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: done ? 1 : active ? progress.value : 0 }],
  }));
  return (
    <View style={s.segTrack}>
      <Animated.View style={[s.segFill, fillStyle]} />
    </View>
  );
}

/**
 * StepFrame — 各ステップを収める中央配置の共通コンテナ。
 * フレーム自身のサイズは shared.frame(幅=固定px / 高さ=aspectRatio)が決める。
 * ここはページ全体を満たして中身を中央寄せするだけ(width/height はアニメで変えない)。
 * 表示切替は translateY/opacity のみ(白化回避)。active になった瞬間にスライドイン。
 */
function StepFrame({ active, children }: { active: boolean; children: React.ReactNode }) {
  const t = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(active ? 1 : 0, { duration: 350, easing: Easing.out(Easing.cubic) });
  }, [active, t]);
  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * t.value,
    transform: [{ translateY: (1 - t.value) * SLIDE_Y }],
  }));
  return <Animated.View style={[s.frameBox, animStyle]}>{children}</Animated.View>;
}

// ── ステップ定義 ───────────────────────────────────────────────────────────────
// 後で render に各 SVG コンポーネントを差し込めるよう、配列要素で持つ。
interface StepDef {
  key:    string;
  /** 仮プレースホルダーの矩形色(後で render 側で自由に置き換える) */
  tint:   string;
  /** active = 今表示中か。非表示ステップはアニメを止めて頭出しさせる。 */
  render: (active: boolean) => React.ReactNode;
}

function Placeholder({ label, tint }: { label: string; tint: string }) {
  return (
    <View style={s.placeholderWrap}>
      <View style={[s.placeholderRect, { backgroundColor: tint }]} />
      <Text style={s.placeholderTxt}>{label}</Text>
    </View>
  );
}

const STEPS: StepDef[] = [
  { key: 'step1', tint: '#D6E6FF', render: active => <OnboardingStep1 active={active} /> },
  { key: 'step2', tint: '#D9F2E3', render: active => <OnboardingStep2 active={active} /> },
  { key: 'step3', tint: '#FFE7D6', render: active => <OnboardingStep3 active={active} /> },
  { key: 'step4', tint: '#EADBFF', render: active => <OnboardingStep4 active={active} /> },
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  /** 最終ステップで「はじめる」を押したとき。今回は呼ぶだけ(接続は後) */
  onComplete?: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function OnboardingScreen({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageW, setPageW] = useState(Dimensions.get('window').width);
  const scrollRef = useRef<ScrollView>(null);

  const isFirst = currentIndex === 0;
  const isLast  = currentIndex === STEPS.length - 1;

  // 動画風プログレス: 表示中ステップだけ 0→1 をループ。ステップが変わると頭出しし直す。
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: STEP_DURATIONS[currentIndex] ?? 12000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [currentIndex, progress]);

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, index));
    setCurrentIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * pageW, animated: true });
  };

  const handleNext = () => {
    if (isLast) { onComplete?.(); return; }
    goTo(currentIndex + 1);
  };

  // 自動進行防止: currentIndex を進めてよいのは「ユーザーが指でスワイプした」momentum のみ。
  // goTo の programmatic scrollTo や、レイアウト/コンテンツ変化で発火する非ユーザー momentum
  // では index を変えない(= 勝手に次ステップへ進まない)。
  const userDragging = useRef(false);
  const onDragBegin = () => { userDragging.current = true; };
  // スワイプ完了時だけ currentIndex を同期(ドット追従)
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!userDragging.current) return; // ユーザー操作以外の momentum は無視
    userDragging.current = false;
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageW);
    if (idx !== currentIndex) setCurrentIndex(idx);
  };

  const footer = (
    <View style={s.footer}>
      {/* 戻る: 先頭では非表示(レイアウト維持のため透明プレースホルダーを置く) */}
      {isFirst ? (
        <View style={s.navBtn} />
      ) : (
        <AnimatedPressable style={s.navBtn} onPress={() => goTo(currentIndex - 1)} pressedScale={0.96}>
          <Text style={s.navBackTxt}>戻る</Text>
        </AnimatedPressable>
      )}

      {/* 現在のステップが分かるドットインジケーター(上部プログレスバーとは別に常設) */}
      <View style={s.dots}>
        {STEPS.map((step, i) => (
          <View key={step.key} style={[s.dot, i === currentIndex && s.dotActive]} />
        ))}
      </View>

      {/* 次へ / はじめる */}
      <AnimatedPressable style={[s.navBtn, s.nextBtn]} onPress={handleNext} pressedScale={0.96}>
        <Text style={s.nextTxt}>{isLast ? 'はじめる' : '次へ'}</Text>
      </AnimatedPressable>
    </View>
  );

  return (
    <Screen footer={footer} scrollable={false} bg={colors.bg}>
      <View
        style={s.fill}
        onLayout={e => setPageW(e.nativeEvent.layout.width)}
      >
        {/* 動画風プログレスバー(ステップごとに独立した1セグメント) */}
        <View style={s.progressRow}>
          {STEPS.map((step, i) => (
            <ProgressSegment
              key={step.key}
              progress={progress}
              active={i === currentIndex}
              done={i < currentIndex}
            />
          ))}
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={onDragBegin}
          onMomentumScrollEnd={onMomentumEnd}
          scrollEventThrottle={16}
        >
          {STEPS.map((step, i) => {
            const isActive = i === currentIndex;
            return (
              <View key={step.key} style={[s.page, { width: pageW }]}>
                {/* 固定サイズ・中央配置の共通フレーム。中身(BirdMascot/SpeechBubble含む)は
                    フレームとの相対位置を保ったまま、フレームごと translateY で移動する。 */}
                <StepFrame active={isActive}>
                  {step.render(isActive)}
                </StepFrame>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Screen>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  fill: { flex: 1 },

  // 動画風プログレスバー
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  segTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E3E3E8',
    overflow: 'hidden',
  },
  segFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: colors.accent,
    borderRadius: 2,
    transformOrigin: 'left', // 左から右へ伸ばす(scaleX のみ=白化回避)
  },
  footerSpacer: { flex: 1 },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ページ全体を満たす中央寄せコンテナ(フレーム自身の寸法は shared.frame が決める)
  frameBox: {
    flex: 1,
    alignSelf: 'stretch',
  },

  // 仮プレースホルダー
  placeholderWrap: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  placeholderRect: {
    width: 220,
    height: 220,
    borderRadius: radius.lg,
  },
  placeholderTxt: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.label,
  },

  // フッターナビ
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  navBtn: {
    minWidth: 72,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackTxt: {
    fontSize: 16,
    color: colors.secondary,
  },
  nextBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  nextTxt: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },

  // ドット
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E3E3E8',
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 20,
  },
});
