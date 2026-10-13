/**
 * OnboardingStepBg.tsx — オンボーディング「背景を消す」のステップ
 *
 * 器(OnboardingScreen)の STEPS[1] に差し込む中身。
 * 実画面(RemoveBgScreen)を簡略に再現し、次の流れをループアニメで見せる。
 *   1) 元の画像(他のステップと同じ暗い地色＋day/night の2体)の背景が消えて市松模様になる
 *   2) 「元の画像を見る」で見比べる(押して戻す)
 *   3) 下地を月(黒)に変える → 市松では紛れていた「消えすぎた所」が黒い穴として見つかる
 *   4) 強さを人物優先へ2回に分けて動かす → 消し直し → 穴が半分 → 全部埋まる
 *   5) 「分割へ進む」を押す
 * 1〜3 は画面の上側の操作なので上スロットで話し、4〜5 は下側なので下スロットへ移る
 * (OnboardingStep2 と同じ「フレーム位置でグルーピング」作法)。
 *
 * 「消えすぎた所」は実際に画像を処理せず、夜の鳥の白い体に小さな丸を重ねて表す。
 * 市松のときは市松に紛れる灰色、黒のときは黒で描くので、黒にしたときだけ目立つ。
 * 欠けが埋まるのは、その丸を消すだけで表せる。
 *
 * アニメ作法・白化対策は OnboardingStep2 と同じ(1つの phase で時間窓、transform/opacity のみ)。
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from './BirdMascot';
import SpeechBubble from './SpeechBubble';
import TouchIndicator from './TouchIndicator';
import CheckerboardBg from '../ui/CheckerboardBg';
import { REMOVAL_EDGE_ICONS } from '../ui/ToleranceSlider';
import { shared, norm, easeIO, fadeHold, jumpY, SPEAK_FADE, FRAME_SLIDE, FRAME_W } from './shared';
import { useT } from '../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
// 5拍あるので Step2(16000ms)より長い。OnboardingScreen の STEP_DURATIONS と合わせる。
export const STEP_BG_CYCLE_MS = 26000;

const BIRD = 92;
// 元の画像の背景色。1枚目(画像を選ぶ)のサムネと2枚目以降(分割設定)の画像と同じ暗い地色に
// そろえ、ガイド全体で「同じ1枚の画像」を扱っているように見せる。
const ORIGINAL_BG = '#1C1C1E';
// 市松に紛れる穴の色(市松の濃い方と薄い方の間)。
const HOLE_ON_CHECKER = '#EDEDED';
const HOLE_ON_BLACK = '#1C1C1E';

// ── タイムライン(喋り→間→操作) ─────────────────────────────────────────────
// 1) 背景が消える
const BG_FADE: [number, number] = [0.05, 0.11];
// 2) 「元の画像を見る」を押す → 戻す
const BEFORE_TAP: [number, number] = [0.19, 0.22];
const AFTER_TAP: [number, number] = [0.27, 0.30];
// 3) 下地ボタン → 月を選ぶ
const BACKDROP_TAP: [number, number] = [0.35, 0.38];
const MOON_TAP: [number, number] = [0.41, 0.44];
const PICKER_SHOW: [number, number] = [0.37, 0.46];
const BLACK_ON = 0.43;
// 4) 「うまく消えていないときは」を開く → スライダーを2回動かす → そのたびに消し直す
const DISCLOSURE_TAP: [number, number] = [0.55, 0.58];
const STRENGTH_SHOW = 0.57;
const NUDGE1: [number, number] = [0.60, 0.63];
const REDO1: [number, number] = [0.63, 0.66];
const NUDGE2: [number, number] = [0.68, 0.71];
const REDO2: [number, number] = [0.71, 0.74];
// 5) 「分割へ進む」を押す
const NEXT_PRESS: [number, number] = [0.92, 0.97];

// スライダーのつまみの位置(左端=人物優先 0 / 右端=背景優先 1)。標準 → 少し → もう少し。
const THUMB_START = 0.5;
const THUMB_MID = 0.38;
const THUMB_END = 0.26;

// 穴(消えすぎた所)。夜の鳥(100基準)の白い体の左下。白いので市松の白に紛れ、黒の下地で目立つ。
const HOLES = [
  { cx: 30, cy: 66, r: 8 },
  { cx: 38, cy: 78, r: 6 },
  { cx: 28, cy: 52, r: 4.5 },
];

export default function OnboardingStepBg({ active = true }: { active?: boolean }) {
  const { t } = useT();
  const phase = useSharedValue(0);
  // スライダーのトラック幅。つまみの移動量(px)と塗りの伸び(scaleX)に使う。
  const trackW = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, { duration: STEP_BG_CYCLE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
      undefined,
      // withRepeat 側にも指定する(OnboardingStep2 参照。無いと1周で止まる)。
      ReduceMotion.Never,
    );
    return () => cancelAnimation(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── 画像の見え方 ───────────────────────────────────────────────────────────
  // 「元の画像」を出している度合い。最初は元の画像 → 消える → 見比べの間だけ戻る。
  const originalAmt = (p: number) => {
    'worklet';
    if (p < BG_FADE[0]) return 1;
    if (p < BG_FADE[1]) return 1 - easeIO(norm(p, BG_FADE[0], BG_FADE[1]));
    if (p < BEFORE_TAP[1]) return 0;
    if (p < BEFORE_TAP[1] + 0.02) return norm(p, BEFORE_TAP[1], BEFORE_TAP[1] + 0.02);
    if (p < AFTER_TAP[1]) return 1;
    if (p < AFTER_TAP[1] + 0.02) return 1 - norm(p, AFTER_TAP[1], AFTER_TAP[1] + 0.02);
    return 0;
  };
  const blackAmt = (p: number) => {
    'worklet';
    if (p < BLACK_ON) return 0;
    if (p < BLACK_ON + 0.02) return norm(p, BLACK_ON, BLACK_ON + 0.02);
    if (p < 0.985) return 1;
    return 1 - norm(p, 0.985, 1);
  };
  // 穴の残り具合。消し直しのたびに半分 → なし。
  const holeAmt = (p: number) => {
    'worklet';
    if (p < REDO1[1]) return 1;
    if (p < REDO1[1] + 0.01) return 1 - 0.5 * norm(p, REDO1[1], REDO1[1] + 0.01);
    if (p < REDO2[1]) return 0.5;
    if (p < REDO2[1] + 0.01) return 0.5 - 0.5 * norm(p, REDO2[1], REDO2[1] + 0.01);
    return 0;
  };

  const originalStyle = useAnimatedStyle(() => ({ opacity: originalAmt(phase.value) }));
  const blackStyle = useAnimatedStyle(() => ({ opacity: blackAmt(phase.value) }));
  // 穴は元の画像では見えない(消える前なので)。市松用と黒用を下地に合わせて出し分ける。
  const holeCheckerStyle = useAnimatedStyle(() => {
    const p = phase.value;
    return { opacity: (1 - originalAmt(p)) * (1 - blackAmt(p)) * holeAmt(p) };
  });
  const holeBlackStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const h = holeAmt(p);
    return { opacity: (1 - originalAmt(p)) * blackAmt(p) * (h > 0 ? 1 : 0), transform: [{ scale: h }] };
  });

  // 「消した後 / 元の画像」の表示と、ボタンの文言の入れ替え
  const afterTxtStyle = useAnimatedStyle(() => ({ opacity: originalAmt(phase.value) > 0.5 ? 0 : 1 }));
  const beforeTxtStyle = useAnimatedStyle(() => ({ opacity: originalAmt(phase.value) > 0.5 ? 1 : 0 }));

  // 下地の選択肢(ボタンの左に出る)
  const pickerStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, PICKER_SHOW[0], PICKER_SHOW[1], 0.01),
  }));
  // 下地ボタンのアイコン: 市松 → 月
  const checkerIconStyle = useAnimatedStyle(() => ({ opacity: phase.value < BLACK_ON || phase.value > 0.985 ? 1 : 0 }));
  const moonIconStyle = useAnimatedStyle(() => ({ opacity: phase.value < BLACK_ON || phase.value > 0.985 ? 0 : 1 }));

  // 強さのパネル(開いた後だけ見せる。高さは最初から確保しておき、透明度だけ変える)
  const strengthStyle = useAnimatedStyle(() => ({
    opacity: phase.value < STRENGTH_SHOW ? 0 : phase.value < STRENGTH_SHOW + 0.015 ? norm(phase.value, STRENGTH_SHOW, STRENGTH_SHOW + 0.015) : 1,
  }));
  const thumbPos = (p: number) => {
    'worklet';
    if (p < NUDGE1[0]) return THUMB_START;
    if (p < NUDGE1[1]) return THUMB_START + (THUMB_MID - THUMB_START) * easeIO(norm(p, NUDGE1[0], NUDGE1[1]));
    if (p < NUDGE2[0]) return THUMB_MID;
    if (p < NUDGE2[1]) return THUMB_MID + (THUMB_END - THUMB_MID) * easeIO(norm(p, NUDGE2[0], NUDGE2[1]));
    return THUMB_END;
  };
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trackW.value * thumbPos(phase.value) }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: thumbPos(phase.value) }],
  }));
  // 消し直し中の半透明ローディング
  const redoStyle = useAnimatedStyle(() => {
    const p = phase.value;
    return { opacity: Math.max(fadeHold(p, REDO1[0], REDO1[1], 0.005), fadeHold(p, REDO2[0], REDO2[1], 0.005)) };
  });

  // 「分割へ進む」押下で軽く縮む
  const ctaStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const mid = (NEXT_PRESS[0] + NEXT_PRESS[1]) / 2;
    let scale = 1;
    if (p >= NEXT_PRESS[0] && p < mid) scale = 1 - norm(p, NEXT_PRESS[0], mid) * 0.05;
    else if (p >= mid && p < NEXT_PRESS[1]) scale = 0.95 + norm(p, mid, NEXT_PRESS[1]) * 0.05;
    return { transform: [{ scale }] };
  });

  // ── 話し手(1〜3 上 / 4〜5 下) ──────────────────────────────────────────────
  const m1 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.01, 0.16, 0.02), transform: [{ translateY: jumpY(phase.value, 0.03) }] }));
  const b1 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.03, 0.15, SPEAK_FADE) }));
  const m2 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.15, 0.32, 0.02), transform: [{ translateY: jumpY(phase.value, 0.16) }] }));
  const b2 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.16, 0.31, SPEAK_FADE) }));
  const m3 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.31, 0.50, 0.02), transform: [{ translateY: jumpY(phase.value, 0.32) }] }));
  const b3 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.32, 0.49, SPEAK_FADE) }));
  const m4 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.51, 0.77, 0.02), transform: [{ translateY: jumpY(phase.value, 0.53) }] }));
  const b4 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.53, 0.76, SPEAK_FADE) }));
  const m5 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.76, 0.99, 0.02), transform: [{ translateY: jumpY(phase.value, 0.78) }] }));
  const b5 = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.78, 0.92, SPEAK_FADE) }));

  // フレームのスライド: 1〜3(上の操作)=下へ(+) / 4〜5(下の操作)=上へ(-)
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.01)      y = 0;
    else if (p < 0.05) y = easeIO(norm(p, 0.01, 0.05));
    else if (p < 0.49) y = 1;
    else if (p < 0.53) y = 1 - 2 * easeIO(norm(p, 0.49, 0.53));
    else if (p < 0.97) y = -1;
    else               y = -1 + easeIO(norm(p, 0.97, 1));
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      <View style={shared.captionTop}>
        <SpeechBubble stepNumber={1} text={t('onboarding.stepBg.removed')} direction="left" mascotStyle={m1} bubbleStyle={b1} />
      </View>
      <View style={shared.captionTop}>
        <SpeechBubble stepNumber={2} text={t('onboarding.stepBg.compare')} direction="left" mascotStyle={m2} bubbleStyle={b2} />
      </View>
      <View style={shared.captionTop}>
        <SpeechBubble stepNumber={3} text={t('onboarding.stepBg.backdrop')} direction="left" mascotStyle={m3} bubbleStyle={b3} />
      </View>

      <Animated.View style={[shared.frame, frameStyle]}>
        {/* ヘッダー(戻る / 背景を消す / 設定) */}
        <View style={s.header}>
          <Text style={s.headerSide}>{t('common.back')}</Text>
          <Text style={s.headerTitle}>{t('removeBg.title')}</Text>
          <Icon name="settings" size={18} color="#007AFF" />
        </View>

        <View style={s.body}>
          <View style={s.headlineRow}>
            <Icon name="check-circle" size={20} color="#007AFF" />
            <Text style={s.headline}>{t('removeBg.headline')}</Text>
          </View>

          {/* 状態(消した後 / 元の画像) + 「元の画像を見る」 + 下地ボタン */}
          <View style={s.statusRow}>
            <View style={s.statusLabel}>
              <Animated.Text style={[s.statusTxt, afterTxtStyle]}>{t('removeBg.after')}</Animated.Text>
              <Animated.Text style={[s.statusTxt, s.overlayTxt, beforeTxtStyle]}>{t('removeBg.before')}</Animated.Text>
            </View>
            <View style={s.beforeBtn}>
              <Icon name="visibility" size={16} color="#000" />
              <View>
                <Animated.Text style={[s.beforeBtnTxt, afterTxtStyle]}>{t('removeBg.showBefore')}</Animated.Text>
                <Animated.Text style={[s.beforeBtnTxt, s.overlayTxt, beforeTxtStyle]}>{t('removeBg.showAfter')}</Animated.Text>
              </View>
              <TouchIndicator progress={phase} window={BEFORE_TAP} />
              <TouchIndicator progress={phase} window={AFTER_TAP} />
            </View>
            <View style={s.bgBtn}>
              <Animated.View style={[s.iconLayer, checkerIconStyle]}><Icon name="grid-on" size={18} color="#FFF" /></Animated.View>
              <Animated.View style={[s.iconLayer, moonIconStyle]}><Icon name="brightness-2" size={18} color="#FFF" /></Animated.View>
              <TouchIndicator progress={phase} window={BACKDROP_TAP} />
              {/* 選択肢はボタンの左に出す(画像には重ねない。実画面と同じ) */}
              <Animated.View style={[s.picker, pickerStyle]} pointerEvents="none">
                <View style={s.pickItem}><Icon name="grid-on" size={16} color="#FFF" /></View>
                <View style={s.pickItem}><Icon name="wb-sunny" size={16} color="#FFF" /></View>
                <View style={s.pickItem}>
                  <Icon name="brightness-2" size={16} color="#FFF" />
                  <TouchIndicator progress={phase} window={MOON_TAP} />
                </View>
              </Animated.View>
            </View>
          </View>

          {/* 画像(下地 → 元の画像の背景 → 鳥と穴) */}
          <View style={s.imageBox}>
            <CheckerboardBg mode="checker" tile={12} width={FRAME_W} height={600} />
            <Animated.View style={[s.fill, s.black, blackStyle]} />
            <Animated.View style={[s.fill, s.original, originalStyle]} />
            {/* 他のステップと同じ day/night の2体 */}
            <View style={s.birds}>
              <BirdMascot variant="day" size={BIRD} />
              <View>
                <BirdMascot variant="night" size={BIRD} />
                {HOLES.map((h, i) => (
                  <React.Fragment key={i}>
                    <Animated.View style={[s.hole, holeBox(h), { backgroundColor: HOLE_ON_CHECKER }, holeCheckerStyle]} />
                    <Animated.View style={[s.hole, holeBox(h), { backgroundColor: HOLE_ON_BLACK }, holeBlackStyle]} />
                  </React.Fragment>
                ))}
              </View>
            </View>
            {/* 消し直し中(実画面と同じ半透明のローディング) */}
            <Animated.View style={[s.fill, s.redo, redoStyle]} pointerEvents="none">
              <ActivityIndicator color="#007AFF" />
              <Text style={s.redoTxt}>{t('removeBg.reprocessing')}</Text>
            </Animated.View>
          </View>

          {/* うまく消えていないときは → 強さ */}
          <View style={s.card}>
            <View style={s.disclosureRow}>
              <Icon name="tune" size={18} color="#007AFF" />
              <Text style={s.disclosureTxt} numberOfLines={1}>{t('removeBg.disclosure')}</Text>
              <Icon name="expand-more" size={20} color="#8E8E93" />
              <TouchIndicator progress={phase} window={DISCLOSURE_TAP} />
            </View>
            <Animated.View style={[s.strength, strengthStyle]}>
              <Text style={s.strengthTitle}>{t('removeBg.tabStrength')}</Text>
              <StrengthTrack phase={phase} trackW={trackW} thumbStyle={thumbStyle} fillStyle={fillStyle} />
              <View style={s.edgeRow}>
                <View style={s.edge}>
                  <Icon name={REMOVAL_EDGE_ICONS[0]} size={14} color="#007AFF" />
                  <Text style={s.edgeTxt}>{t('granularity.personPriority')}</Text>
                </View>
                <View style={s.edge}>
                  <Text style={s.edgeTxt}>{t('granularity.backgroundPriority')}</Text>
                  <Icon name={REMOVAL_EDGE_ICONS[1]} size={14} color="#007AFF" />
                </View>
              </View>
            </Animated.View>
          </View>

          <Animated.View style={[s.cta, ctaStyle]}>
            <Text style={s.ctaTxt}>{t('removeBg.next')}</Text>
            <Icon name="chevron-right" size={18} color="#FFF" />
            <TouchIndicator progress={phase} window={NEXT_PRESS} />
          </Animated.View>
        </View>
      </Animated.View>

      <View style={shared.captionBottom}>
        <SpeechBubble stepNumber={4} text={t('onboarding.stepBg.strength')} direction="left" mascotStyle={m4} bubbleStyle={b4} />
      </View>
      <View style={shared.captionBottom}>
        <SpeechBubble stepNumber={5} text={t('onboarding.stepBg.next')} direction="left" mascotStyle={m5} bubbleStyle={b5} />
      </View>
    </View>
  );
}

function holeBox(h: { cx: number; cy: number; r: number }) {
  const k = BIRD / 100;
  return { left: (h.cx - h.r) * k, top: (h.cy - h.r) * k, width: h.r * 2 * k, height: h.r * 2 * k, borderRadius: h.r * k };
}

/** 強さのスライダー(見本)。つまみは2回目の調整のときにタップ表現を出す。 */
function StrengthTrack({
  phase,
  trackW,
  thumbStyle,
  fillStyle,
}: {
  phase: SharedValue<number>;
  trackW: SharedValue<number>;
  thumbStyle: object;
  fillStyle: object;
}) {
  return (
    <View style={s.track} onLayout={e => { trackW.value = e.nativeEvent.layout.width; }}>
      <Animated.View style={[s.trackFill, fillStyle]} />
      <Animated.View style={[s.thumb, thumbStyle]}>
        <TouchIndicator progress={phase} window={NUDGE1} />
        <TouchIndicator progress={phase} window={NUDGE2} />
      </Animated.View>
    </View>
  );
}

// ── スタイル(OnboardingStep2 と同じ値で見た目をそろえる) ───────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E3E3E8',
  },
  headerSide: { fontSize: 14, color: '#007AFF', minWidth: 40 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },

  body: { flex: 1, padding: 14, gap: 10 },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headline: { fontSize: 17, fontWeight: '700', color: '#000' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10 },
  statusLabel: { flex: 1 },
  statusTxt: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  overlayTxt: { position: 'absolute', left: 0, top: 0 },
  beforeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
  },
  beforeBtnTxt: { fontSize: 12, fontWeight: '600', color: '#000' },
  bgBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(30,30,30,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: { position: 'absolute' },
  picker: {
    position: 'absolute',
    right: '100%',
    marginRight: 6,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(30,30,30,0.85)',
  },
  pickItem: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },

  imageBox: {
    flex: 1,
    minHeight: 120,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  black: { backgroundColor: HOLE_ON_BLACK },
  original: { backgroundColor: ORIGINAL_BG },
  birds: { flexDirection: 'row', gap: 28 },
  hole: { position: 'absolute' },
  redo: {
    backgroundColor: 'rgba(242,242,247,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  redoTxt: { fontSize: 13, fontWeight: '600', color: '#000' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  disclosureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disclosureTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: '#000' },
  strength: { gap: 8 },
  strengthTitle: { fontSize: 13, fontWeight: '600', color: '#000' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 10,
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#007AFF',
    transformOrigin: 'left',
  },
  thumb: {
    position: 'absolute',
    left: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  edgeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  edge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  edgeTxt: { fontSize: 11, color: '#8E8E93' },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
  },
  ctaTxt: { fontSize: 15, fontWeight: '600', color: '#FFF' },
});
