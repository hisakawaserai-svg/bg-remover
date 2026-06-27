/**
 * OnboardingStep4.tsx — オンボーディング ステップ4(保存完了・最終)
 *
 * 器(OnboardingScreen)の STEPS[3] に差し込む中身。
 * 実画面(SaveCompleteScreen)をそっくり再現し、
 *   1) ✓ がポンと出る(scale バウンス)
 *   2) サムネ2枚 → ボタン群が順に出現(opacity/translateY・stagger)
 *   3) キャプション「完成!透過PNGがアルバムに保存されます」
 * をループアニメで見せる。最終ステップなので操作ハイライトは控えめ
 * (ここはユーザーが選ぶ画面)。TouchIndicator は無理に入れない。
 *
 * 作法は OnboardingStep1〜3 と同一:
 *   1つの進行用 SharedValue(phase) + active連動(表示中だけ頭出し再生)。
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
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from './BirdMascot';
import SpeechBubble from './SpeechBubble';
import { shared, easeIO, fadeHold, jumpY, norm, FRAME_SLIDE } from './shared';

// ── 定数 ───────────────────────────────────────────────────────────────────────
const CYCLE_MS = 11000; // ゆっくり(間込み)
const ALBUM_NAME = 'スタンプ抜き'; // 実画面と同じ表記(imaging/index.ts と一致)

// 順次出現の開始タイミング(stagger)。サムネ → 各ボタン。さらに前倒し＆間隔を詰める。
const THUMBS_AT  = 0.10;
const BTN_AT     = [0.15, 0.20, 0.25] as const;

// シマエナガ本体が出始めるまでの待ち時間(ms)。中身(〜0.33)が並んだ後に登場させる。
// 早すぎ/遅すぎはここだけで調整。timeline(clock)方式なので phase 比率に直して使う。
const BIRD_ENTER_DELAY  = 4000;
// 本体が出てから「喋る/跳ねる」までの一拍(ms)
const SPEAK_AFTER_ENTER = 500;
const BIRD_ENTER_P  = BIRD_ENTER_DELAY / CYCLE_MS;                        // 登場
const SPEAK_START_P = (BIRD_ENTER_DELAY + SPEAK_AFTER_ENTER) / CYCLE_MS;  // 喋り出し＝跳ね

// キャプション文言(後で調整しやすいよう定数化)
const CAPTION = '完成！透過PNGがアルバムに保存されます';

// ── ワークレットユーティリティ ────────────────────────────────────────────────
function easeOutBack(t: number) {
  'worklet';
  // ポンと出るバウンス(オーバーシュート)
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function OnboardingStep4({ active = true }: { active?: boolean }) {
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
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 末尾でのフェードアウト(ループのちらつき回避)
  const fadeOut = (p: number) => {
    'worklet';
    return 1 - norm(p, 0.94, 1);
  };

  // ✓ バウンス: [0.0, 0.10] で scale 0→1(オーバーシュート)。すぐ出す。
  const checkStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const t = easeOutBack(norm(p, 0.0, 0.10));
    return { opacity: norm(p, 0.0, 0.05) * fadeOut(p), transform: [{ scale: t }] };
  });

  // 完了サマリのテキスト: ✓ の直後に出る
  const summaryTextStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const t = norm(p, 0.04, 0.12);
    return { opacity: t * fadeOut(p), transform: [{ translateY: (1 - t) * 6 }] };
  });

  // 出現ヘルパ: start から 0.08 かけて opacity+translateY(=素早く)、末尾でフェードアウト。
  const appearStyle = (start: number) =>
    useAnimatedStyle(() => {
      const p = phase.value;
      const t = easeIO(norm(p, start, start + 0.08));
      return { opacity: t * fadeOut(p), transform: [{ translateY: (1 - t) * 12 }] };
    });

  const thumbsStyle = appearStyle(THUMBS_AT);
  const btn0Style   = appearStyle(BTN_AT[0]);
  const btn1Style   = appearStyle(BTN_AT[1]);
  const btn2Style   = appearStyle(BTN_AT[2]);

  // ── 字幕(キャラ＋吹き出し・下): 中身が並んだ後に登場→一拍おいて喋る/跳ねる。
  // 登場=BIRD_ENTER_P / 喋り＝跳ね=SPEAK_START_P(登場の一拍後)に連動。
  const mascotStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, BIRD_ENTER_P, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, SPEAK_START_P) }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, SPEAK_START_P, 0.92, 0.02) }));

  // フレームのスライド(上下対称): 操作=下なので上へ寄せて(-)、下にキャプションの空きを作る。
  // 本体登場(BIRD_ENTER_P)に合わせて上げ、末尾で戻す。translateY のみ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const slideEnd = BIRD_ENTER_P + 0.08;
    let y = 0;
    if (p < BIRD_ENTER_P)   y = 0;
    else if (p < slideEnd)  y = -easeIO(norm(p, BIRD_ENTER_P, slideEnd)); // → -1(上げて下を空ける)
    else if (p < 0.94)      y = -1;
    else                    y = -1 + easeIO(norm(p, 0.94, 0.99));         // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション枠(overlay・本ステップは空) ── */}
      <View style={shared.captionTop} pointerEvents="none" />

      {/* ── 実画面の枠(SaveCompleteScreen の再現)。下キャプションぶん上へスライド ── */}
      <Animated.View style={[shared.frame, frameStyle]}>
        {/* ヘッダー(保存完了 / ホーム・設定) */}
        <View style={s.header}>
          <View style={s.headerSideL} />
          <Text style={s.headerTitle}>保存完了</Text>
          <View style={s.headerIcons}>
            <Icon name="home" size={18} color="#007AFF" />
            <Icon name="settings" size={18} color="#007AFF" />
          </View>
        </View>

        <View style={s.body}>
          {/* 完了サマリカード: ✓ + 「2枚 保存しました」 + アルバム名 */}
          <View style={s.summary}>
            <View style={s.iconCircle}>
              <Animated.View style={checkStyle}>
                <Icon name="check" size={26} color="#0F6E56" />
              </Animated.View>
            </View>
            <Animated.View style={[s.summaryText, summaryTextStyle]}>
              <Text style={s.summaryTitle}>2枚 保存しました</Text>
              <Text style={s.summaryAlbum}>「{ALBUM_NAME}」アルバム</Text>
            </Animated.View>
          </View>

          {/* サムネ2枚(BirdMascot day/night) */}
          <Animated.View style={[s.grid, thumbsStyle]}>
            <View style={s.cell}><BirdMascot variant="day" size={84} /></View>
            <View style={s.cell}><BirdMascot variant="night" size={84} /></View>
          </Animated.View>

          {/* ボタン3つ(stagger 出現) */}
          <Animated.View style={[s.primaryBtn, btn0Style]}>
            <Text style={s.primaryTxt}>別の画像を処理する</Text>
          </Animated.View>
          <Animated.View style={[s.subBtn, btn1Style]}>
            <Icon name="photo-library" size={16} color="#007AFF" />
            <Text style={s.subTxt}>保存先を確認する</Text>
          </Animated.View>
          <Animated.View style={[s.lineBtn, btn2Style]}>
            <Text style={s.lineTxt}>LINE スタンプ Maker を開く</Text>
            <Icon name="open-in-new" size={16} color="#FFF" />
          </Animated.View>
        </View>
      </Animated.View>

      {/* ── 下キャプション(操作=各ボタン=下 → キャラ＋吹き出しは下・overlay) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={1}
          text={CAPTION}
          direction="left"
          mascotStyle={mascotStyle}
          bubbleStyle={bubbleStyle}
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
  headerSideL: { minWidth: 40 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  body: { flex: 1, padding: 16, gap: 14 },

  // 完了サマリ
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#E3E3E8',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E1F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  summaryAlbum: { fontSize: 13, color: '#8E8E93' },

  // サムネ2枚
  grid: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  cell: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#E3E3E8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  // ボタン
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTxt: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  subBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3E3E8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  subTxt: { color: '#007AFF', fontSize: 15, fontWeight: '500' },
  lineBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#3A3A3C',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lineTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
