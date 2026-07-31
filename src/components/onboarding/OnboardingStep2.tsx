/**
 * OnboardingStep2.tsx — オンボーディング ステップ2(分割設定)
 *
 * 器(OnboardingScreen)の STEPS[1] に差し込む中身。
 * 実画面(SetupScreen の自動分割)をそっくり再現し、
 *   A) 「自動分割」で切り分ける案内
 *   B) 分割線が上から伸びる + 「2個に分かれます」バッジ出現
 *   C) 行数・細かさを整えて「分割」をタップ
 * をループアニメで見せる。
 *
 * アニメ作法は OnboardingStep1 / SetupScreen と同じ:
 *   1つの進行用 SharedValue(phase) でタイムラインを作り、
 *   各要素の useAnimatedStyle が時間窓で動く。
 *
 * Android白化対策:
 *   分割線・バッジ・ボタン等は height/width/borderWidth を動かさず、
 *   transform(scale/translate) と opacity のみで動かす。
 *   分割線は SetupScreen と同じく scaleY + transformOrigin top で上から伸ばす。
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
import type { TKey } from '../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
// ゆっくり(間込み)。
const CYCLE_MS = 13000;

// 細かさスライダーのスナップラベル(粗い/中/細かい)。位置は簡略のため等間隔(25/50/75%)。
const STRENGTHS = [
  { labelKey: 'granularity.coarse' as TKey, pct: 25 },
  { labelKey: 'granularity.medium' as TKey, pct: 50 },
  { labelKey: 'granularity.fine' as TKey, pct: 75 },
] as const;
const STRENGTH_ON = 1; // つまみの位置(中)

// 進行に合わせて差し替えるキャプション文言(後で調整しやすいよう定数化)
// 文言は描画時に t() で解決する。

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function OnboardingStep2({ active = true }: { active?: boolean }) {
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

  // ── タイムライン(喋り→間→操作のリズム) ───────────────────────────────────
  // A喋り[0.05,0.31] → 間 → タブtap[0.36,0.48] → 分割線[0.50,0.62]+バッジ
  //  → C喋り[0.70,0.92] → スライダーtap[0.80,0.90] → ボタン押下[0.92,0.97]

  // 「自動分割」タブのハイライト: タップ前後で脈打つ [0.34,0.50]
  const tabHiStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const o = p >= 0.34 && p < 0.50 ? 0.6 + 0.4 * Math.sin(norm(p, 0.34, 0.50) * Math.PI) : 0;
    return { opacity: o };
  });

  // 分割線: [0.50, 0.62] で上から下へ伸びる(scaleY のみ・原点 top)
  const lineStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const grow = p < 0.50 ? 0 : easeIO(norm(p, 0.50, 0.62));
    return { transform: [{ scaleY: grow }] };
  });

  // バッジ: [0.56, 0.68] で opacity + translateY 出現、リセットで消す
  const badgeStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let t = 0;
    if (p < 0.56)      t = 0;
    else if (p < 0.68) t = norm(p, 0.56, 0.68);
    else if (p < 0.94) t = 1;
    else               t = 1 - norm(p, 0.94, 0.99);
    return { opacity: t, transform: [{ translateY: (1 - t) * -6 }] };
  });

  // 「この行数で分割」ボタン押下: [0.92, 0.97] で軽く縮む
  const ctaStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let scale = 1;
    if (p >= 0.92 && p < 0.945)      scale = 1 - norm(p, 0.92, 0.945) * 0.05;
    else if (p >= 0.945 && p < 0.97) scale = 0.95 + norm(p, 0.945, 0.97) * 0.05;
    return { transform: [{ scale }] };
  });

  // ── 字幕(キャラ＋吹き出し): 操作側に出す ──
  // A(タブ=上操作)→上。C(ボタン=下操作)→下へ移動。喋り始めに「ピョン」。
  const mascotAStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.03, 0.50, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.05) }],
  }));
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.05, 0.31, SPEAK_FADE) }));
  const mascotCStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.60, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.70) }],
  }));
  const bubbleCStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.70, 0.92, SPEAK_FADE) }));

  // フレームのスライド(上下対称): A(上操作)=下へ(+) / C(下操作)=上へ(-)。
  // キャラの出る側と反対へ寄せて、その側に1帯ぶんの空きを作る。translateY のみ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.03)      y = 0;
    else if (p < 0.11) y = easeIO(norm(p, 0.03, 0.11));          // → +1(下げて上を空ける=A)
    else if (p < 0.46) y = 1;
    else if (p < 0.56) y = 1 - easeIO(norm(p, 0.46, 0.56));      // → 0
    else if (p < 0.62) y = 0;                                    // 中立(分割線フェーズ)
    else if (p < 0.70) y = -easeIO(norm(p, 0.62, 0.70));         // → -1(上げて下を空ける=C)
    else if (p < 0.94) y = -1;
    else               y = -1 + easeIO(norm(p, 0.94, 0.99));     // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション(フェーズA: タブ=上操作 → キャラ＋吹き出しは上・overlay) ── */}
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={1}
          text={t('onboarding.step2.caption')}
          direction="left"
          mascotStyle={mascotAStyle}
          bubbleStyle={bubbleAStyle}
        />
      </View>

      {/* ── 実画面の枠(SetupScreen 自動分割の再現)。上側操作の説明中だけ下へスライド ── */}
      <Animated.View style={[shared.frame, frameStyle]}>
        {/* ヘッダー(戻る / 分割設定 / 設定) */}
        <View style={s.header}>
          <Text style={s.headerSide}>{t('common.back')}</Text>
          <Text style={s.headerTitle}>{t('setup.title')}</Text>
          <Icon name="settings" size={18} color="#007AFF" />
        </View>

        <View style={s.body}>
          {/* タブ(自動分割[選択] / 範囲を調整) */}
          <View style={s.tabRow}>
            <View style={[s.tab, s.tabOn]}>
              {/* 自動分割タブのハイライト枠(opacityで脈打つ・transform不使用) */}
              <Animated.View style={[s.tabHighlight, tabHiStyle]} pointerEvents="none" />
              <Text style={[s.tabTxt, s.tabTxtOn]}>{t('setup.modeAuto')}</Text>
              {/* タップ表現: 間のあと「自動分割」を押す */}
              <TouchIndicator progress={phase} window={[0.36, 0.48]} />
            </View>
            <View style={s.tab}>
              <Text style={s.tabTxt}>{t('setup.modeManual')}</Text>
            </View>
          </View>

          {/* プレビュー(暗い背景 + day/night 2体 + 分割線 + バッジ) */}
          <View style={s.previewBox}>
            <View style={s.birds}>
              <BirdMascot variant="day" size={84} />
              <BirdMascot variant="night" size={84} />
            </View>

            {/* 分割線(列境界): 上から下へ伸びる(scaleY・原点 top) */}
            <Animated.View style={[s.vLineBg, lineStyle]} pointerEvents="none" />
            <Animated.View style={[s.vLine, lineStyle]} pointerEvents="none" />

            {/* 「2個に分かれます」バッジ(右上・薄青ピル) */}
            <Animated.View style={[s.badge, badgeStyle]} pointerEvents="none">
              <Text style={s.badgeTxt}>{t('setup.splitsInto', { count: 2 })}</Text>
            </Animated.View>
          </View>

          {/* 行数(段数)ステッパー + 分割しないチェック(静的・OFF表示) */}
          <View style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.rowLabel}>{t('setup.rows')}</Text>
              <View style={s.stepper}>
                <View style={s.stepBtn}><Text style={s.stepTxt}>−</Text></View>
                <Text style={s.stepVal}>1</Text>
                <View style={s.stepBtn}><Text style={s.stepTxt}>＋</Text></View>
              </View>
            </View>
            <View style={s.cardDivider} />
            <View style={s.checkRow}>
              <View style={s.checkbox} />
              <Text style={s.checkLabel}>{t('setup.noSplit')}</Text>
            </View>
          </View>

          {/* 分割の細かさ(連続スライダー風・粗い/中/細かいスナップ。簡略表示) */}
          <View style={s.sliderCard}>
            <Text style={s.rowLabel}>{t('granularity.label')}</Text>
            {/* トラック + 塗り + つまみ + スナップ目盛り */}
            <View style={s.track}>
              <View style={[s.trackFill, { width: `${STRENGTHS[STRENGTH_ON].pct}%` }]} />
              {STRENGTHS.map(snp => (
                <View key={snp.labelKey} style={[s.tick, { left: `${snp.pct}%` }]} />
              ))}
              <View style={[s.thumb, { left: `${STRENGTHS[STRENGTH_ON].pct}%` }]}>
                {/* タップ表現: フェーズCでつまみを操作 */}
                <TouchIndicator progress={phase} window={[0.80, 0.90]} />
              </View>
            </View>
            {/* 粗い/中/細かいラベル(スナップ点の真下) */}
            <View style={s.labelRow}>
              {STRENGTHS.map((snp, i) => (
                <Text
                  key={snp.labelKey}
                  style={[s.snapTxt, { left: `${snp.pct}%` }, i === STRENGTH_ON && s.snapTxtOn]}
                >
                  {t(snp.labelKey)}
                </Text>
              ))}
            </View>
          </View>

          {/* 「この行数で分割」ボタン(押下スケール) */}
          <Animated.View style={[s.cta, ctaStyle]}>
            <Text style={s.ctaTxt}>{t('setup.splitWithRows')}</Text>
            {/* タップ表現: フェーズC末でボタンを押す */}
            <TouchIndicator progress={phase} window={[0.92, 0.99]} />
          </Animated.View>
        </View>
      </Animated.View>

      {/* ── 下キャプション(フェーズC: ボタン=下操作 → キャラ＋吹き出しは下へ移動・overlay) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={2}
          text={t('onboarding.step2.bubble')}
          direction="left"
          mascotStyle={mascotCStyle}
          bubbleStyle={bubbleCStyle}
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

  body: { flex: 1, padding: 16, gap: 12 },

  // タブ
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#E5E5EA',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    backgroundColor: '#FFFFFF',
  },
  tabHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  tabTxt: { fontSize: 14, fontWeight: '500', color: '#8E8E93' },
  tabTxtOn: { color: '#000', fontWeight: '600' },

  // プレビュー
  previewBox: {
    width: '100%',
    flex: 1,
    // 分割しないチェック行を追加したぶん固定高が増えたので、プレビューは
    // より小さくまで縮めて CTA が枠外(overflow:hidden)に押し出されないようにする。
    minHeight: 140,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birds: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  // 分割線(中央縦): SetupScreen と同じく原点 top で上から伸ばす
  vLineBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 4,
    marginLeft: -2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    transformOrigin: 'top',
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: '#007AFF',
    transformOrigin: 'top',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#EAF2FF',
    borderColor: '#007AFF',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeTxt: { fontSize: 12, fontWeight: '600', color: '#007AFF' },

  // カード(行数 / 細かさ): 縦積みコンテナ
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E3E3E8',
    marginVertical: 12,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
  },
  checkLabel: { fontSize: 15, color: '#000' },
  rowLabel: { fontSize: 15, color: '#000' },

  // ステッパー
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#C6C6C8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  stepTxt: { fontSize: 20, color: '#007AFF', lineHeight: 24 },
  stepVal: { fontSize: 16, fontWeight: '600', color: '#000', minWidth: 24, textAlign: 'center' },

  // 細かさ(連続スライダー風)
  sliderCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 14,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 10, // つまみ半径ぶん内側に
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#007AFF',
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 8,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#C6C6C8',
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  labelRow: {
    position: 'relative',
    height: 16,
    marginHorizontal: 10,
  },
  snapTxt: {
    position: 'absolute',
    fontSize: 12,
    color: '#8E8E93',
    transform: [{ translateX: -8 }],
    minWidth: 16,
    textAlign: 'center',
  },
  snapTxtOn: { color: '#007AFF', fontWeight: '600' },

  // CTA
  cta: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTxt: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
