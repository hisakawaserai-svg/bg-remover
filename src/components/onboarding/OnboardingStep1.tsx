/**
 * OnboardingStep1.tsx — オンボーディング ステップ1(ホーム/画像選択)
 *
 * 器(OnboardingScreen)の STEPS[0] に差し込む中身。実画面(ホーム空状態)を再現し、
 * 下から写真選択モーダルがせり上がる様子をループアニメで見せる。
 *
 * 共通化: フレーム/キャラサイズ/キャプション枠は shared.ts を使用(全ステップ統一)。
 * 字幕は SpeechBubble(案B＋ステップ番号)。喋り始めにキャラが「ピョン」と跳ねる。
 * 喋り→間(沈黙)→操作→次の喋り、のリズム。active連動で表示中だけ頭出し再生。
 *
 * Android白化対策: transform/opacity のみ。
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  ReduceMotion,
  Easing,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from './BirdMascot';
import SpeechBubble from './SpeechBubble';
import TouchIndicator from './TouchIndicator';
import { shared, COLORS, norm, easeIO, fadeHold, jumpY, SPEAK_FADE, FRAME_SLIDE } from './shared';
import { useT } from '../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
const CYCLE_MS = 12000; // ゆっくり(間込み)
const MODAL_H  = 300;

// シマエナガ本体が出始めるまでの待ち時間(ms)。早すぎ/遅すぎはここだけで調整。
// timeline(clock)方式なので phase 比率に直して使う: BIRD_ENTER_DELAY / CYCLE_MS
const BIRD_ENTER_DELAY = 1200;
// シマエナガ本体が出てから「喋る/跳ねる」までの一拍(ms)
const SPEAK_AFTER_ENTER = 400;
// 基準phase(登場)と、それ以降のイベントphase を1か所で導出(順序崩れ防止)
const BIRD_ENTER_P  = BIRD_ENTER_DELAY / CYCLE_MS;                        // 登場
const SPEAK_START_P = (BIRD_ENTER_DELAY + SPEAK_AFTER_ENTER) / CYCLE_MS;  // 喋り出し＝跳ね

const GRID = [0, 1, 2, 3, 4, 5];
const SELECTED_CELL = 1;
const CELL_TINTS = ['#FFD9C2', '#C2E0FF', '#D6F5DD', '#FFE3F0', '#E5DBFF', '#FFF2C2'];
const GRID_GUTTER = 6;

// 選択するセルだけは「次のステップで加工される画像」そのものを見せる。
// step2 のプレビューと絵が違うと、選んだ写真と処理される写真が別物に見えるため、
// 地色(#1C1C1E)も 2体(day/night)の並びも step2 の previewBox に合わせている。
const PICKED_BG = '#1C1C1E';

// 文言は描画時に t() で解決する（下の useT 参照）。

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function OnboardingStep1({ active = true }: { active?: boolean }) {
  const { t } = useT();
  const phase = useSharedValue(0);
  const [cellSize, setCellSize] = useState(0);

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

  // タイムライン: A喋り[0.04,0.30] → 間 → CTA押下[0.34] → モーダル上昇[0.42,0.56]
  //              → B喋り[0.60,0.84] → セル選択[0.70] → 間 → モーダル下降[0.88,0.97]

  // CTA押下: [0.34,0.42]
  const ctaStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let scale = 1;
    if (p >= 0.34 && p < 0.38)      scale = 1 - norm(p, 0.34, 0.38) * 0.05;
    else if (p >= 0.38 && p < 0.42) scale = 0.95 + norm(p, 0.38, 0.42) * 0.05;
    return { transform: [{ scale }] };
  });

  // モーダル: [0.42,0.56] せり上がり / [0.88,0.97] 下げて戻す
  const modalStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let up = 0;
    if (p < 0.42)       up = 0;
    else if (p < 0.56)  up = easeIO(norm(p, 0.42, 0.56));
    else if (p < 0.88)  up = 1;
    else if (p < 0.97)  up = 1 - easeIO(norm(p, 0.88, 0.97));
    return { transform: [{ translateY: (1 - up) * MODAL_H }] };
  });
  const scrimStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let v = 0;
    if (p < 0.42)       v = 0;
    else if (p < 0.56)  v = norm(p, 0.42, 0.56);
    else if (p < 0.88)  v = 1;
    else if (p < 0.97)  v = 1 - norm(p, 0.88, 0.97);
    return { opacity: v * 0.35 };
  });

  // セル選択チェック: [0.70,0.80] 出現、モーダル下降で消す
  const checkStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const t = norm(p, 0.70, 0.80) * (p < 0.88 ? 1 : 1 - norm(p, 0.88, 0.94));
    return { opacity: t, transform: [{ scale: 0.6 + t * 0.4 }] };
  });

  // ── 字幕(キャラ＋吹き出し): 上スロットに2文。キャラは常時表示、喋り毎にジャンプ ──
  const mascotStyle = useAnimatedStyle(() => {
    const p = phase.value;
    return {
      // 登場 = 基準phase / 1個目ジャンプ = 登場の一拍後(SPEAK_START_P)に連動
      opacity: fadeHold(p, BIRD_ENTER_P, 0.99, 0.03),
      transform: [{ translateY: jumpY(p, SPEAK_START_P) + jumpY(p, 0.60) }],
    };
  });
  // A文=押す前[0.04,0.30] / B文=モーダルが上がった後[0.60,0.84](連続で出ないよう間を空ける)
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, SPEAK_START_P, 0.30, SPEAK_FADE) }));
  const bubbleBStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.60, 0.84, SPEAK_FADE) }));

  // フレームのスライド(上下対称): 操作=下なので上へ寄せて(-)、下にキャプションの空きを作る。
  // キャプションは loop ほぼ全域で表示なので、頭で上げて末尾で戻す。translateY のみ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.02)      y = 0;
    else if (p < 0.10) y = -easeIO(norm(p, 0.02, 0.10));     // → -1(上げて下を空ける)
    else if (p < 0.92) y = -1;
    else               y = -1 + easeIO(norm(p, 0.92, 0.99)); // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション枠(overlay・本ステップは空) ── */}
      <View style={shared.captionTop} pointerEvents="none" />

      {/* ── 実画面の枠(ホーム空状態の再現)。下キャプションぶん上へスライド ── */}
      <Animated.View style={[shared.frame, frameStyle]}>
        <View style={s.titleBar}>
          <Text style={s.title}>{t('app.name')}</Text>
          <Icon name="auto-fix-high" size={20} color={COLORS.blue} />
        </View>

        <View style={s.emptyBody}>
          <View style={s.emptyIconWrap}>
            <Icon name="auto-fix-high" size={40} color={COLORS.blue} />
          </View>
          <Text style={s.emptyTitle}>{t('onboarding.step1.tagline')}</Text>
          <Text style={s.emptyDesc}>{t('onboarding.step1.lead')}</Text>

          <View style={s.hints}>
            {[t('home.features.formats'), t('home.features.autoRemove'), t('onboarding.step1.savePng')].map(feature => (
              <View key={feature} style={s.hintRow}>
                <Icon name="check-circle" size={15} color={COLORS.blue} />
                <Text style={s.hintTxt}>{feature}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 下部CTA */}
        <Animated.View style={[s.cta, ctaStyle]}>
          <Text style={s.ctaTxt}>{t('onboarding.step1.pick')}</Text>
          <TouchIndicator progress={phase} window={[0.34, 0.46]} />
        </Animated.View>

        {/* 暗幕 */}
        <Animated.View style={[s.scrim, scrimStyle]} pointerEvents="none" />

        {/* せり上がる写真選択モーダル */}
        <Animated.View style={[s.modal, modalStyle]}>
          <View style={s.grabber} />
          <View style={s.modalHeader}>
            <Text style={s.modalCancel}>{t('common.cancel')}</Text>
            <Text style={s.modalTitle}>{t('onboarding.step1.photoPickerTitle')}</Text>
            <Text style={s.modalDone}>{t('common.done')}</Text>
          </View>
          <View
            style={s.grid}
            onLayout={e => {
              const w = e.nativeEvent.layout.width;
              setCellSize((w - GRID_GUTTER * 2) / 3);
            }}
          >
            {GRID.map(i => (
              <View
                key={i}
                style={[
                  s.cell,
                  {
                    backgroundColor: i === SELECTED_CELL ? PICKED_BG : CELL_TINTS[i],
                    width: cellSize,
                    height: cellSize,
                  },
                ]}
              >
                {i === SELECTED_CELL && (
                  <>
                    {/* step2 で分割される画像と同じ絵。セル幅に対して2体が収まる大きさにする。 */}
                    {cellSize > 0 && (
                      <View style={s.pickedBirds}>
                        <BirdMascot variant="day" size={cellSize * 0.46} />
                        <BirdMascot variant="night" size={cellSize * 0.46} />
                      </View>
                    )}
                    <Animated.View style={[s.cellCheck, checkStyle]}>
                      <Icon name="check" size={14} color="#FFF" />
                    </Animated.View>
                    <TouchIndicator progress={phase} window={[0.70, 0.82]} />
                  </>
                )}
              </View>
            ))}
          </View>
        </Animated.View>
      </Animated.View>

      {/* ── 下キャプション(操作=CTA/モーダルとも下 → キャラ＋吹き出しは下・overlay)。2文クロスフェード ── */}
      <View style={shared.captionBottom}>
        {/* A文(キャラあり=常時表示の本体) */}
        <SpeechBubble
          stepNumber={1}
          text={t('onboarding.step1.caption')}
          direction="left"
          mascotStyle={mascotStyle}
          bubbleStyle={bubbleAStyle}
        />
        {/* B文(同位置に重ねる。キャラは本体側に任せ、ここは非表示で整列だけ取る) */}
        <View style={s.bubbleOverlay}>
          <SpeechBubble
            stepNumber={2}
            text={t('onboarding.step1.bubble')}
            direction="left"
            mascotStyle={s.hiddenMascot}
            bubbleStyle={bubbleBStyle}
          />
        </View>
      </View>
    </View>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // 2文目を1文目に重ねる(同じキャプション枠内)
  bubbleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenMascot: { opacity: 0 },

  // 選択セルの中身(step2 のプレビューと同じ 2体並び)
  pickedBirds: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },

  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(0,122,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 13,
    color: COLORS.secondary,
    textAlign: 'center',
    marginBottom: 22,
  },
  hints: { gap: 11, alignSelf: 'stretch', paddingHorizontal: 18 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hintTxt: { fontSize: 14, color: '#3A3A3C' },

  cta: {
    margin: 18,
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTxt: { color: '#FFF', fontSize: 16, fontWeight: '600' },

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },

  modal: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: MODAL_H,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D1D6',
    marginTop: 8,
    marginBottom: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalCancel: { fontSize: 14, color: COLORS.secondary },
  modalTitle:  { fontSize: 15, fontWeight: '600', color: '#000' },
  modalDone:   { fontSize: 14, fontWeight: '600', color: COLORS.blue },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 6,
  },
  cell: {
    borderRadius: 8,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 5,
  },
  cellCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
