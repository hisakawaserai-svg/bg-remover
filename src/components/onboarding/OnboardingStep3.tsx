/**
 * OnboardingStep3.tsx — オンボーディング ステップ3(分割結果)
 *
 * 器(OnboardingScreen)の STEPS[2] に差し込む中身。
 * 実画面(ResultScreen の通常モード)をそっくり再現し、
 *   A) 分かれたカット2枚が出現 → 確認案内(下キャプション)
 *   B) OKなら「保存する」をタップ(上キャプション + TouchIndicator + 押下)
 * をループアニメで見せる。合体操作は画面注記に任せ、説明からは省く。
 *
 * 作法は OnboardingStep1 / Step2 と同一:
 *   1つの進行用 SharedValue(phase) + active連動(表示中だけ頭出し再生)。
 *   キャプションは「操作と反対側に出す」。タップ要素に TouchIndicator を重ねる。
 *
 * Android白化対策: transform(scale/translate)/opacity のみ。
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  ReduceMotion,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from './BirdMascot';
import SpeechBubble from './SpeechBubble';
import TouchIndicator from './TouchIndicator';
import { shared, norm, easeIO, fadeHold, jumpY, SPEAK_FADE, FRAME_SLIDE } from './shared';
import { useT } from '../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
const CYCLE_MS = 11000; // ゆっくり(間込み)

// カット2枚(day/night)。番号バッジは index+1。早めに並べる。
const CUTS = [
  { variant: 'day', appear: 0.03 },
  { variant: 'night', appear: 0.10 },
] as const;

// 進行に合わせて差し替えるキャプション文言(後で調整しやすいよう定数化)
// 文言は描画時に t() で解決する。

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function OnboardingStep3({ active = true }: { active?: boolean }) {
  const { t } = useT();
  const phase = useSharedValue(0);

  // active(表示中)の時だけ頭出し再生。非表示では停止して進行を0へ戻す。
  useEffect(() => {
    if (!active) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
      undefined,
      // 【重要】withRepeat 自身にも指定が要る。withTiming 側だけだと
      // OSの「視差効果を減らす/アニメーションを減らす」でループが無効化され、
      // 1周しただけで止まる（説明用のアニメなので必ず動かす）。
      ReduceMotion.Never,
    );
    return () => cancelAnimation(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── タイムライン ──────────────────────────────────────────────────────────
  // フェーズA: [0, 0.45]  カット2枚が出現 → 確認(下キャプション)
  // フェーズB: [0.45, 0.94] 保存ボタンをタップ(上キャプション)
  // リセット : [0.94, 1]

  // カード出現: appear から 0.10 かけて opacity+translateY(=素早く並べる)、末尾でフェードアウト。
  const cut0Style = useAnimatedStyle(() => {
    const p = phase.value;
    const t = easeIO(norm(p, CUTS[0].appear, CUTS[0].appear + 0.10));
    const out = 1 - norm(p, 0.94, 1);
    return { opacity: t * out, transform: [{ translateY: (1 - t) * 12 }] };
  });
  const cut1Style = useAnimatedStyle(() => {
    const p = phase.value;
    const t = easeIO(norm(p, CUTS[1].appear, CUTS[1].appear + 0.10));
    const out = 1 - norm(p, 0.94, 1);
    return { opacity: t * out, transform: [{ translateY: (1 - t) * 12 }] };
  });

  // 「保存する」ボタン押下: [0.78, 0.86] で軽く縮む
  const saveStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let scale = 1;
    if (p >= 0.78 && p < 0.82)      scale = 1 - norm(p, 0.78, 0.82) * 0.05;
    else if (p >= 0.82 && p < 0.86) scale = 0.95 + norm(p, 0.82, 0.86) * 0.05;
    return { transform: [{ scale }] };
  });

  // ── 字幕(キャラ＋吹き出し): 操作側に出す ──
  // A(カット確認=上に注目)→上。B(保存=下操作)→下へ移動。喋り始めに「ピョン」。
  const mascotAStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.22, 0.56, 0.03),   // 喋る直前に登場(早すぎ防止)
    transform: [{ translateY: jumpY(phase.value, 0.30) }],
  }));
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.30, 0.54, SPEAK_FADE) }));
  const mascotBStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.56, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.60) }],
  }));
  const bubbleBStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.60, 0.84, SPEAK_FADE) }));

  // フレームのスライド(上下対称): A(上=カット確認)=下へ(+) / B(下=保存)=上へ(-)。
  // キャラの出る側と反対へ寄せて空きを作る。translateY のみ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.04)      y = 0;
    else if (p < 0.12) y = easeIO(norm(p, 0.04, 0.12));          // → +1(下げて上を空ける=A)
    else if (p < 0.46) y = 1;
    else if (p < 0.56) y = 1 - 2 * easeIO(norm(p, 0.46, 0.56)); // +1 → -1(上げて下を空ける=B)
    else if (p < 0.94) y = -1;
    else               y = -1 + easeIO(norm(p, 0.94, 0.99));     // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション(フェーズA: カット確認=上に注目 → キャラ＋吹き出しは上・overlay) ── */}
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={1}
          text={t('onboarding.step3.caption')}
          direction="left"
          mascotStyle={mascotAStyle}
          bubbleStyle={bubbleAStyle}
        />
      </View>

      {/* ── 実画面の枠(ResultScreen 通常モードの再現)。上側操作の説明中だけ下へスライド ── */}
      <Animated.View style={[shared.frame, frameStyle]}>
        {/* ヘッダー(戻る / 分割結果 / 画像・ホーム・設定) */}
        <View style={s.header}>
          <Text style={s.headerSide}>{t('common.back')}</Text>
          <Text style={s.headerTitle}>{t('result.title')}</Text>
          <View style={s.headerIcons}>
            <Icon name="image" size={18} color="#007AFF" />
            <Icon name="home" size={18} color="#007AFF" />
            <Icon name="settings" size={18} color="#007AFF" />
          </View>
        </View>

        <View style={s.body}>
          {/* セクション見出し + ヒント */}
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>{t('onboarding.cutsLabel', { count: 2 })}</Text>
            <Text style={s.sectionHint}>{t('result.longPressHint')}</Text>
          </View>

          {/* カット2枚(day/night・番号バッジ) */}
          <View style={s.cuts}>
            <Animated.View style={[s.cutCard, cut0Style]}>
              <BirdMascot variant={CUTS[0].variant} size={92} />
              <View style={s.numBadge}><Text style={s.numBadgeTxt}>1</Text></View>
            </Animated.View>
            <Animated.View style={[s.cutCard, cut1Style]}>
              <BirdMascot variant={CUTS[1].variant} size={92} />
              <View style={s.numBadge}><Text style={s.numBadgeTxt}>2</Text></View>
            </Animated.View>
          </View>

          {/* リセット / 手動分割 */}
          <View style={s.actionRow}>
            <View style={s.actionBtn}>
              <Icon name="refresh" size={16} color="#007AFF" />
              <Text style={s.actionTxt}>{t('common.reset')}</Text>
            </View>
            <View style={s.actionDivider} />
            <View style={s.actionBtn}>
              <Icon name="edit" size={16} color="#007AFF" />
              <Text style={s.actionTxt}>{t('result.manualSplit')}</Text>
            </View>
          </View>

          {/* 保存する(押下スケール + TouchIndicator) */}
          <Animated.View style={[s.saveBtn, saveStyle]}>
            <Text style={s.saveTxt}>{t('common.save')}</Text>
            {/* タップ表現: フェーズBで保存ボタンを押す */}
            <TouchIndicator progress={phase} window={[0.74, 0.88]} />
          </Animated.View>
        </View>
      </Animated.View>

      {/* ── 下キャプション(フェーズB: 保存=下操作 → キャラ＋吹き出しは下へ移動・overlay) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={2}
          text={t('onboarding.step3.bubble')}
          direction="left"
          mascotStyle={mascotBStyle}
          bubbleStyle={bubbleBStyle}
        />
      </View>
    </View>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────
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
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  body: { flex: 1, padding: 16, gap: 14 },

  // セクション見出し
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: '#000' },
  sectionHint: { fontSize: 12, color: '#8E8E93' },

  // カット2枚
  cuts: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  cutCard: {
    flex: 1,
    maxWidth: 150,
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3E3E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  numBadgeTxt: { fontSize: 12, fontWeight: '700', color: '#FFF' },

  // 再分割 / 手動分割
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E3E8',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
  },
  actionTxt: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  actionDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: '#E3E3E8' },

  // 保存する
  saveBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveTxt: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
