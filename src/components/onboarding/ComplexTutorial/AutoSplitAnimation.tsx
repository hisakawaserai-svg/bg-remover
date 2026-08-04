/**
 * AutoSplitAnimation.tsx — 複雑な画像チュートリアル STEP1(自動分割してみる)
 *
 * 器(ComplexStickerTutorialScreen)の STEPS[0] に差し込む中身。
 * OnboardingStep2 と同じ作法で SetupScreen の自動分割をそっくり再現し、
 *   A) 「自動分割は全段を同じ線で切る」という説明 + 分割線が上から伸びる
 *   B) 線がずれてたら指でドラッグして動かせる、という独立の説明
 *   C) 「この行数で分割」をタップ
 * をループアニメで見せる。押した結果(真ん中の子が割れる)は次の STEP で扱う。
 * A/B は同じ上スロットで話者を差し替え、C だけ下スロットへ移る
 * (MergeCellsAnimation と同じ「フレーム位置でグルーピング」作法)。
 *
 * OnboardingStep2 との違いは題材だけ:
 *   2段×2列で、2段目は中央に1匹しか居ない。その1匹がちょうど縦の中央線を
 *   跨いでいる = 全幅共通の縦線で切ると左右に割れてしまう、という状況を作ってある。
 *
 * アニメ作法は OnboardingStep2 / SetupScreen と同じ:
 *   1つの進行用 SharedValue(phase) でタイムラインを作り、
 *   各要素の useAnimatedStyle が時間窓で動く。
 *
 * Android白化対策:
 *   分割線・バッジ・ボタン等は height/width/borderWidth を動かさず、
 *   transform(scale/translate) と opacity のみで動かす。
 *   分割線は SetupScreen と同じく scaleY/scaleX + transformOrigin で伸ばす。
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
import BirdMascot from '../BirdMascot';
import SpeechBubble from '../SpeechBubble';
import TouchIndicator from '../TouchIndicator';
import { shared, norm, easeIO, fadeHold, jumpY, wiggle, SPEAK_FADE, FRAME_SLIDE } from '../shared';
import { useT } from '../../../i18n';
import type { TKey } from '../../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
// A/B/Cの3ビート分の間を確保するため、旧版(2ビート・12000ms)より長め。
// 器(ComplexStickerTutorialScreen)の上部プログレスバーもこの長さで進むので export する。
export const CYCLE_MS = 15000;

// プレビュー内のキャラの大きさ。2段×2列を収めるので Step2(84)より小さめ。
const BIRD = 64;

// 細かさスライダーのスナップラベル(粗い/中/細かい)。位置は簡略のため等間隔。
const STRENGTHS = [
  { labelKey: 'granularity.coarse' as TKey, pct: 25 },
  { labelKey: 'granularity.medium' as TKey, pct: 50 },
  { labelKey: 'granularity.fine' as TKey, pct: 75 },
] as const;
const STRENGTH_ON = 1; // つまみの位置(中)

// 分割線(v/h とも共通)が上から/左から伸びる窓。
const LINE_GROW: [number, number] = [0.24, 0.34];
// フェーズBの説明が終わった後、線を軽く揺らして実演する窓。
const DRAG_WIGGLE: [number, number] = [0.52, 0.60];
// 「この行数で分割」ボタンを押す窓(フェーズC末)。
const BUTTON_PRESS: [number, number] = [0.86, 0.96];

// 文言は描画時に t() で解決する。

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function AutoSplitAnimation({ active = true }: { active?: boolean }) {
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
  // A喋り[0.04,0.20] → 分割線[0.24,0.34]
  //  → B喋り[0.34,0.50](線はドラッグで動かせる) → 線をゆらして実演[0.52,0.60]
  //  → C喋り[0.66,0.82] → ボタン押下[0.86,0.96]

  // 分割線: 縦横とも同じ窓で動かすので出るタイミングが完全に一致する。
  // 縦は原点 top で上から、横は原点 left で左から伸ばす(SetupScreen と同じ)。
  const vLineStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const grow = p < LINE_GROW[0] ? 0 : easeIO(norm(p, LINE_GROW[0], LINE_GROW[1]));
    // 列境界線なので、実画面と同じ「左右」にゆらして見せる。
    const nudge = wiggle(p, DRAG_WIGGLE[0], DRAG_WIGGLE[1], 5);
    return { transform: [{ scaleY: grow }, { translateX: nudge }] };
  });
  const hLineStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const grow = p < LINE_GROW[0] ? 0 : easeIO(norm(p, LINE_GROW[0], LINE_GROW[1]));
    // 行境界線なので「上下」にゆらして見せる。
    const nudge = wiggle(p, DRAG_WIGGLE[0], DRAG_WIGGLE[1], 5);
    return { transform: [{ scaleX: grow }, { translateY: nudge }] };
  });

  // 「この行数で分割」ボタン押下で軽く縮む
  const ctaStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const mid = (BUTTON_PRESS[0] + BUTTON_PRESS[1]) / 2;
    let scale = 1;
    if (p >= BUTTON_PRESS[0] && p < mid)      scale = 1 - norm(p, BUTTON_PRESS[0], mid) * 0.05;
    else if (p >= mid && p < BUTTON_PRESS[1]) scale = 0.95 + norm(p, mid, BUTTON_PRESS[1]) * 0.05;
    return { transform: [{ scale }] };
  });

  // ── 字幕(キャラ＋吹き出し) ──
  // A・Bは同じ上スロットで話者を差し替え(概要説明/線の説明)。
  // Cだけ下スロットへ移り、実際の操作(ボタン押下)を担当する。喋り始めに「ピョン」。
  const mascotAStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.02, 0.30, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.04) }],
  }));
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.04, 0.20, SPEAK_FADE) }));
  const mascotBStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.30, 0.62, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.34) }],
  }));
  const bubbleBStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.34, 0.50, SPEAK_FADE) }));
  const mascotCStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.64, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.66) }],
  }));
  const bubbleCStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.66, 0.82, SPEAK_FADE) }));

  // フレームのスライド(上下対称): A・B(上に喋る)=下へ(+) / C(下操作)=上へ(-)。
  // キャラの出る側と反対へ寄せて、その側に1帯ぶんの空きを作る。translateY のみ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.02)      y = 0;
    else if (p < 0.08) y = easeIO(norm(p, 0.02, 0.08));       // → +1(下げて上を空ける=A/B)
    else if (p < 0.62) y = 1;
    else if (p < 0.66) y = 1 - easeIO(norm(p, 0.62, 0.66));   // → 0
    else if (p < 0.70) y = -easeIO(norm(p, 0.66, 0.70));      // → -1(上げて下を空ける=C)
    else if (p < 0.97) y = -1;
    else               y = -1 + easeIO(norm(p, 0.97, 1));     // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション(フェーズA/B: 同じスロットで話者を差し替え・overlay) ── */}
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={1}
          text={t('complexTutorial.autoSplit.caption')}
          direction="left"
          mascotStyle={mascotAStyle}
          bubbleStyle={bubbleAStyle}
        />
      </View>
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={2}
          text={t('complexTutorial.autoSplit.dragHint')}
          direction="left"
          mascotStyle={mascotBStyle}
          bubbleStyle={bubbleBStyle}
        />
      </View>

      {/* ── 実画面の枠(SetupScreen 自動分割の再現) ── */}
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
              <Text style={[s.tabTxt, s.tabTxtOn]}>{t('setup.modeAuto')}</Text>
            </View>
            <View style={s.tab}>
              <Text style={s.tabTxt}>{t('setup.modeManual')}</Text>
            </View>
          </View>

          {/* プレビュー: 2段×2列。1段目は各セルに収まり、2段目は中央に1匹だけ。
              その1匹が縦の中央線を跨いでいる = 自動分割だと割れてしまう配置。 */}
          <View style={s.previewBox}>
            {/* 1段目: 左右のセルにきちんと収まっている */}
            <View style={[s.bird, { left: '25%', top: '25%' }]}>
              <BirdMascot variant="day" size={BIRD} />
            </View>
            <View style={[s.bird, { left: '75%', top: '25%' }]}>
              <BirdMascot variant="night" size={BIRD} />
            </View>
            {/* 2段目: 中央に1匹だけ。縦の中央線をちょうど跨ぐ */}
            <View style={[s.bird, { left: '50%', top: '75%' }]}>
              <BirdMascot variant="sleep" size={BIRD} />
            </View>

            {/* 分割線(列境界): 上から下へ伸びる(scaleY・原点 top)。
                フェーズBの説明後、左右にゆれて「ドラッグできる」を実演する。 */}
            <Animated.View style={[s.vLineBg, vLineStyle]} pointerEvents="none" />
            <Animated.View style={[s.vLine, vLineStyle]} pointerEvents="none" />
            {/* 分割線(行境界): 左から右へ伸びる(scaleX・原点 left)。上下にゆれて実演する。 */}
            <Animated.View style={[s.hLineBg, hLineStyle]} pointerEvents="none" />
            <Animated.View style={[s.hLine, hLineStyle]} pointerEvents="none" />
          </View>

          {/* 行数(段数) / 列数ステッパー(静的表示) */}
          <View style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.rowLabel}>{t('setup.rows')}</Text>
              <View style={s.stepper}>
                <View style={s.stepBtn}><Text style={s.stepTxt}>−</Text></View>
                <Text style={s.stepVal}>2</Text>
                <View style={s.stepBtn}><Text style={s.stepTxt}>＋</Text></View>
              </View>
            </View>
            <View style={s.cardDivider} />
            <View style={s.cardRow}>
              <Text style={s.rowLabel}>{t('setup.columns')}</Text>
              <View style={s.stepper}>
                <View style={s.stepBtn}><Text style={s.stepTxt}>−</Text></View>
                <Text style={s.stepVal}>2</Text>
                <View style={s.stepBtn}><Text style={s.stepTxt}>＋</Text></View>
              </View>
            </View>
          </View>

          {/* 分割の細かさ(連続スライダー風・簡略表示。STEP1では操作しない) */}
          <View style={s.sliderCard}>
            <Text style={s.rowLabel}>{t('granularity.label')}</Text>
            <View style={s.track}>
              <View style={[s.trackFill, { width: `${STRENGTHS[STRENGTH_ON].pct}%` }]} />
              {STRENGTHS.map(snp => (
                <View key={snp.labelKey} style={[s.tick, { left: `${snp.pct}%` }]} />
              ))}
              <View style={[s.thumb, { left: `${STRENGTHS[STRENGTH_ON].pct}%` }]} />
            </View>
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
            <TouchIndicator progress={phase} window={BUTTON_PRESS} />
          </Animated.View>
        </View>
      </Animated.View>

      {/* ── 下キャプション(フェーズC: ボタン=下操作 → キャラ＋吹き出しは下へ・overlay) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={3}
          text={t('complexTutorial.autoSplit.bubble')}
          direction="left"
          mascotStyle={mascotCStyle}
          bubbleStyle={bubbleCStyle}
        />
      </View>
    </View>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────
// OnboardingStep2 と同じ値を使い、2画面で見た目が揃うようにしてある。
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
  tabOn: { backgroundColor: '#FFFFFF' },
  tabTxt: { fontSize: 14, fontWeight: '500', color: '#8E8E93' },
  tabTxtOn: { color: '#000', fontWeight: '600' },

  // プレビュー(2段×2列なのでキャラは絶対配置)
  previewBox: {
    width: '100%',
    flex: 1,
    minHeight: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
  },
  // left/top に % を指定し、margin で自身の半分ぶん戻して「中心合わせ」にする。
  bird: {
    position: 'absolute',
    width: BIRD,
    height: BIRD,
    marginLeft: -BIRD / 2,
    marginTop: -BIRD / 2,
  },

  // 分割線(中央縦): 原点 top で上から伸ばす
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
  // 分割線(中央横): 原点 left で左から伸ばす
  hLineBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 4,
    marginTop: -2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    transformOrigin: 'left',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    marginTop: -1,
    backgroundColor: '#007AFF',
    transformOrigin: 'left',
  },

  // カード(行数 / 列数)
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
    marginVertical: 10,
  },
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
    marginHorizontal: 10,
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
