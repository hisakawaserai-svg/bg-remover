/**
 * FinishAnimation.tsx — 複雑な画像チュートリアル STEP3(囲んで仕上げて保存する)
 *
 * 器(ComplexStickerTutorialScreen)の STEPS[2] に差し込む中身。
 * STEP2 でポリゴン編集に入ったところから続く。
 *   A) 小さい四角が出て、角を1つずつ外へ広げてキャラに合わせる
 *   B) 「プレビュー」で分割結果へ戻る
 *   C) 3枚とも綺麗に切り抜けているので「保存する」
 *   D) 保存完了 →「複雑なシートもきれいに切り抜けます」で締める
 *
 * 囲む動作の見せ方は PolygonTutorialScreen(範囲を調整の使い方)に合わせてある:
 *   タップ → 小さい四角が出現 → ポーズ → TL→TR→BL→BR の順に角が最終位置へ
 *   （指カーソルが動かしている角に追従）→ 完成形を保持。
 *   あちらと同じ「順番に1角ずつ」のリズムなので、両方見ても違和感が出ない。
 *
 * 枚数について: STEP1 で 2段×2列＝4枚に切れ、STEP2 で割れた2枚を合体したので
 * ここでは 3枚(day / night / 合体した sleep)になっている。
 *
 * 【重要】四角と頂点ハンドルは Skia の <Canvas> で描くが、その Canvas の中には
 * Skia のノードしか入れていない。BirdMascot は内部に自前の <Canvas> を持つので、
 * 兄弟の RN View として Canvas の下に敷いている（Canvas の入れ子は落ちる）。
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  ReduceMotion,
} from 'react-native-reanimated';
import { Canvas, Circle, Line } from '@shopify/react-native-skia';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from '../BirdMascot';
import SpeechBubble from '../SpeechBubble';
import TouchIndicator from '../TouchIndicator';
import { shared, norm, easeIO, fadeHold, jumpY, SPEAK_FADE, FRAME_SLIDE } from '../shared';
import { Cell, EditorMock, BIRD, ui } from './parts';
import { useT } from '../../../i18n';
import { ALBUM_ID } from '../../../imaging';

// ── 定数 ───────────────────────────────────────────────────────────────────────
// 囲む動作 + 保存まで見せるので長め。
// 器の上部プログレスバーもこの長さで進むので export する。
export const CYCLE_MS = 16000;

// ── 囲みキャンバスの座標系(PolygonTutorialScreen と同じ考え方) ────────────────
const EDIT_W = 180;
const EDIT_H = 180;
const EDIT_BIRD = 108;
// キャラの中心 = タップ位置
const TAP_X = EDIT_W / 2;      // 90
const TAP_Y = 95;

// 初期(小さい)四角の角
const HALF = 34;
const INIT_TL = { x: TAP_X - HALF, y: TAP_Y - HALF };
const INIT_TR = { x: TAP_X + HALF, y: TAP_Y - HALF };
const INIT_BL = { x: TAP_X - HALF, y: TAP_Y + HALF };
const INIT_BR = { x: TAP_X + HALF, y: TAP_Y + HALF };

// 最終(キャラを囲む)四角の角。キャラは x36..144 / y41..149 を占めるので少し外側。
const FINAL_TL = { x: 28, y: 26 };
const FINAL_TR = { x: 152, y: 26 };
const FINAL_BL = { x: 28, y: 156 };
const FINAL_BR = { x: 152, y: 156 };

const HANDLE_R = 5;
const FINGER_R = 7;
const BOX_SW = 2.5;

// 文言は描画時に t() で解決する。

// ── タイムライン ──────────────────────────────────────────────────────────────
// [0.02,0.26] A喋り / [0.04,0.10] タップ / [0.08,0.14] 四角出現 / [0.14,0.18] ポーズ
// [0.18,0.26] TL / [0.26,0.33] TR / [0.33,0.40] BL / [0.40,0.47] BR / [0.47,0.54] 完成保持
// [0.54,0.60] プレビュー押下 / [0.60,0.66] 分割結果へ
// [0.64,0.82] C喋り / [0.72,0.78] 保存押下 / [0.80,0.86] 保存完了
// [0.84,0.97] D喋り → ループ
const TAP_IN: [number, number] = [0.04, 0.10];
const BOX_IN: [number, number] = [0.08, 0.14];
const TL_MOVE: [number, number] = [0.18, 0.26];
const TR_MOVE: [number, number] = [0.26, 0.33];
const BL_MOVE: [number, number] = [0.33, 0.40];
const BR_MOVE: [number, number] = [0.40, 0.47];
const PREVIEW_TAP: [number, number] = [0.54, 0.60];
const RESULT_IN = 0.60;      // 編集 → 分割結果 の切り替え開始
const RESULT_FULL = 0.66;
const SAVE_TAP: [number, number] = [0.72, 0.78];
const SAVED_IN = 0.80;       // 保存完了の表示
const SAVED_FULL = 0.86;
const RESET_START = 0.97;    // ループ先頭へ戻すための片付け

/** worklet 用の線形補間。 */
function lerp(t: number, from: number, to: number) {
  'worklet';
  return from + (to - from) * t;
}

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function FinishAnimation({ active = true }: { active?: boolean }) {
  const { t } = useT();
  const phase = useSharedValue(0);

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

  // ── 囲み四角: 角ごとに時間窓をずらして最終位置へ動かす ──
  // Skia の Line/Circle に渡す座標(Vector)を角ごとに1つ作る。
  // 4角とも同じ形なので、時間窓と行き先だけが違う。
  const pTL = useDerivedValue(() => {
    const t = easeIO(norm(phase.value, TL_MOVE[0], TL_MOVE[1]));
    return { x: lerp(t, INIT_TL.x, FINAL_TL.x), y: lerp(t, INIT_TL.y, FINAL_TL.y) };
  });
  const pTR = useDerivedValue(() => {
    const t = easeIO(norm(phase.value, TR_MOVE[0], TR_MOVE[1]));
    return { x: lerp(t, INIT_TR.x, FINAL_TR.x), y: lerp(t, INIT_TR.y, FINAL_TR.y) };
  });
  const pBL = useDerivedValue(() => {
    const t = easeIO(norm(phase.value, BL_MOVE[0], BL_MOVE[1]));
    return { x: lerp(t, INIT_BL.x, FINAL_BL.x), y: lerp(t, INIT_BL.y, FINAL_BL.y) };
  });
  const pBR = useDerivedValue(() => {
    const t = easeIO(norm(phase.value, BR_MOVE[0], BR_MOVE[1]));
    return { x: lerp(t, INIT_BR.x, FINAL_BR.x), y: lerp(t, INIT_BR.y, FINAL_BR.y) };
  });

  // 四角の出現(タップの直後にふわっと出す)
  const boxOpacity = useDerivedValue(() => {
    const p = phase.value;
    if (p < BOX_IN[0]) return 0;
    if (p < RESULT_IN) return norm(p, BOX_IN[0], BOX_IN[1]);
    return 0;
  });

  // タップリップル(四角が出る合図)
  const tapR = useDerivedValue(() => lerp(easeIO(norm(phase.value, TAP_IN[0], TAP_IN[1])), 6, 22));
  const tapOpacity = useDerivedValue(() => {
    const p = phase.value;
    if (p < TAP_IN[0] || p > TAP_IN[1]) return 0;
    return 1 - norm(p, TAP_IN[0], TAP_IN[1]);
  });

  // 指カーソル: 今動かしている角に追従する
  const fingerPos = useDerivedValue(() => {
    const p = phase.value;
    if (p < TR_MOVE[0]) return pTL.value;
    if (p < BL_MOVE[0]) return pTR.value;
    if (p < BR_MOVE[0]) return pBL.value;
    return pBR.value;
  });
  const fingerOpacity = useDerivedValue(() => {
    const p = phase.value;
    if (p < TL_MOVE[0] - 0.02) return 0;
    if (p < TL_MOVE[0])        return norm(p, TL_MOVE[0] - 0.02, TL_MOVE[0]);
    if (p < BR_MOVE[1])        return 1;
    if (p < BR_MOVE[1] + 0.03) return 1 - norm(p, BR_MOVE[1], BR_MOVE[1] + 0.03);
    return 0;
  });

  // ── 画面遷移: ポリゴン編集 → 分割結果 ──
  const editorLayerStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 1;
    if (p < RESULT_IN)        o = 1;
    else if (p < RESULT_FULL) o = 1 - easeIO(norm(p, RESULT_IN, RESULT_FULL));
    else if (p < RESET_START) o = 0;
    else                      o = easeIO(norm(p, RESET_START, 1));
    return { opacity: o };
  });
  const resultLayerStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 0;
    if (p < RESULT_IN)        o = 0;
    else if (p < RESULT_FULL) o = easeIO(norm(p, RESULT_IN, RESULT_FULL));
    else if (p < RESET_START) o = 1;
    else                      o = 1 - easeIO(norm(p, RESET_START, 1));
    const slide = p < RESULT_FULL ? (1 - easeIO(norm(p, RESULT_IN, RESULT_FULL))) * 16 : 0;
    return { opacity: o, transform: [{ translateY: slide }] };
  });

  // 「保存する」ボタン押下
  const saveBtnStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let scale = 1;
    if (p >= SAVE_TAP[0] && p < 0.75)      scale = 1 - norm(p, SAVE_TAP[0], 0.75) * 0.05;
    else if (p >= 0.75 && p < SAVE_TAP[1]) scale = 0.95 + norm(p, 0.75, SAVE_TAP[1]) * 0.05;
    return { transform: [{ scale }] };
  });

  // 保存完了オーバーレイ
  const savedStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 0;
    if (p < SAVED_IN)         o = 0;
    else if (p < SAVED_FULL)  o = easeIO(norm(p, SAVED_IN, SAVED_FULL));
    else if (p < RESET_START) o = 1;
    else                      o = 1 - easeIO(norm(p, RESET_START, 1));
    return { opacity: o };
  });
  const checkStyle = useAnimatedStyle(() => {
    const t = easeIO(norm(phase.value, SAVED_IN + 0.01, SAVED_FULL + 0.01));
    return { transform: [{ scale: 0.6 + 0.4 * t }] };
  });

  // ── 字幕(キャラ＋吹き出し) ──
  const mascotAStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.01, 0.32, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.02) }],
  }));
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.02, 0.26, SPEAK_FADE) }));
  // C と D は同じ下スロットに置き、時間窓で入れ替える。
  const mascotCStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.60, 0.84, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.62) }],
  }));
  const bubbleCStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.64, 0.82, SPEAK_FADE) }));
  const mascotDStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.84, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.86) }],
  }));
  const bubbleDStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.86, 0.97, SPEAK_FADE) }));

  // フレームのスライド: A(上に喋る)=下へ / C・D(下操作)=上へ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.01)      y = 0;
    else if (p < 0.08) y = easeIO(norm(p, 0.01, 0.08));       // → +1
    else if (p < 0.50) y = 1;
    else if (p < 0.56) y = 1 - easeIO(norm(p, 0.50, 0.56));   // → 0
    else if (p < 0.62) y = -easeIO(norm(p, 0.56, 0.62));      // → -1
    else if (p < 0.97) y = -1;
    else               y = -1 + easeIO(norm(p, 0.97, 1));     // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  // ── 囲みアニメの中身(EditorMock のキャンバスに差し込む) ──
  // Canvas には Skia のノードだけを入れ、BirdMascot は下に敷いた兄弟 View にする。
  const subject = (
    <View style={s.editArea}>
      <View style={s.editBird} pointerEvents="none">
        <BirdMascot variant="sleep" size={EDIT_BIRD} />
      </View>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* タップリップル */}
        <Circle cx={TAP_X} cy={TAP_Y} r={tapR} color="#30D158" opacity={tapOpacity} />
        {/* 四角の4辺 */}
        <Line p1={pTL} p2={pTR} color="#FFFFFF" strokeWidth={BOX_SW} opacity={boxOpacity} />
        <Line p1={pTR} p2={pBR} color="#FFFFFF" strokeWidth={BOX_SW} opacity={boxOpacity} />
        <Line p1={pBR} p2={pBL} color="#FFFFFF" strokeWidth={BOX_SW} opacity={boxOpacity} />
        <Line p1={pBL} p2={pTL} color="#FFFFFF" strokeWidth={BOX_SW} opacity={boxOpacity} />
        {/* 頂点ハンドル */}
        <Circle c={pTL} r={HANDLE_R} color="#FFFFFF" opacity={boxOpacity} />
        <Circle c={pTR} r={HANDLE_R} color="#FFFFFF" opacity={boxOpacity} />
        <Circle c={pBL} r={HANDLE_R} color="#FFFFFF" opacity={boxOpacity} />
        <Circle c={pBR} r={HANDLE_R} color="#FFFFFF" opacity={boxOpacity} />
        {/* 指カーソル(動かしている角に追従) */}
        <Circle c={fingerPos} r={FINGER_R} color="#30D158" opacity={fingerOpacity} />
      </Canvas>
    </View>
  );

  return (
    <View style={shared.root}>
      {/* ── 上キャプション(フェーズA) ── */}
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={1}
          text={t('complexTutorial.finish.caption')}
          direction="left"
          mascotStyle={mascotAStyle}
          bubbleStyle={bubbleAStyle}
        />
      </View>

      {/* ── 実画面の枠。中身を「ポリゴン編集」と「分割結果」の2層で入れ替える ── */}
      <Animated.View style={[shared.frame, frameStyle]}>

        {/* ── 層1: ポリゴン編集画面(STEP2 から続く) ── */}
        <Animated.View style={[StyleSheet.absoluteFill, editorLayerStyle]} pointerEvents="none">
          <EditorMock progress={phase} previewTap={PREVIEW_TAP} subject={subject} />
        </Animated.View>

        {/* ── 層2: 分割結果画面(仕上がり) ── */}
        <Animated.View style={[StyleSheet.absoluteFill, resultLayerStyle]}>
          <View style={ui.header}>
            <Text style={ui.headerSide}>{t('common.back')}</Text>
            <Text style={ui.headerTitle}>{t('result.title')}</Text>
            <Icon name="settings" size={18} color="#007AFF" />
          </View>

          <View style={ui.body}>
            {/* 合体したので4枚→3枚になっている */}
            <View style={ui.sectionRow}>
              <Text style={ui.sectionLabel}>{t('onboarding.cutsLabel', { count: 3 })}</Text>
              <Text style={ui.sectionHint}>{t('result.longPressHint')}</Text>
            </View>

            {/* 上段: 綺麗に切れている2枚 */}
            <View style={ui.gridRow}>
              <Cell index={1}>
                <BirdMascot variant="day" size={BIRD} />
              </Cell>
              <Cell index={2}>
                <BirdMascot variant="night" size={BIRD} />
              </Cell>
            </View>

            {/* 下段: 合体して1枚に戻り、囲み直して整えた子。
                STEP2 では2枚ぶんの横長セルだったが、ポリゴンで囲み直した結果
                切り出し範囲がキャラにぴったり詰まるので、ここでは他と同じ
                正方形のセルになる（ResultScreen はカットの bbox に合わせて
                セルの大きさが決まるため）。横長のままだと「切り取ったサイズ」に
                見えないので、ここは wide を付けない。*/}
            <View style={ui.gridRow}>
              <Cell index={3}>
                <BirdMascot variant="sleep" size={BIRD} />
              </Cell>
            </View>

            <View style={s.spacer} />

            {/* フッター: リセット + 保存する を1行に横並び(リセット1 : 保存2 の幅) */}
            <View style={ui.actionRow}>
              <View style={ui.actionBtn}>
                <Icon name="refresh" size={16} color="#007AFF" />
                <Text style={ui.actionBtnTxt}>{t('common.reset')}</Text>
              </View>
              <Animated.View style={[ui.saveBtn, saveBtnStyle]}>
                <Text style={ui.primaryBtnTxt}>{t('common.save')}</Text>
                {/* タップ表現: 保存ボタンを押す */}
                <TouchIndicator progress={phase} window={SAVE_TAP} />
              </Animated.View>
            </View>
          </View>

          {/* 保存完了: 画面に薄く重ねてチェックを出す */}
          <Animated.View style={[s.savedOverlay, savedStyle]} pointerEvents="none">
            <Animated.View style={[s.savedCircle, checkStyle]}>
              <Icon name="check" size={30} color="#FFF" />
            </Animated.View>
            {/* 文言は実際の SaveCompleteScreen に合わせる */}
            <Text style={s.savedTxt}>{t('saveComplete.savedCount', { count: 3 })}</Text>
            <Text style={s.savedSub}>{t('saveComplete.albumSuffix', { album: ALBUM_ID })}</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* ── 下キャプション(フェーズC / D を同じスロットで入れ替える) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={2}
          text={t('complexTutorial.finish.bubble')}
          direction="left"
          mascotStyle={mascotCStyle}
          bubbleStyle={bubbleCStyle}
        />
      </View>
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={3}
          text={t('complexTutorial.finish.closing')}
          direction="left"
          mascotStyle={mascotDStyle}
          bubbleStyle={bubbleDStyle}
        />
      </View>
    </View>
  );
}

// ── このステップ固有のスタイル(共通分は parts.tsx の ui) ────────────────────────
const s = StyleSheet.create({
  // 囲みアニメの舞台。Canvas に固定寸法が要るのでサイズを決め打ちする。
  editArea: {
    width: EDIT_W,
    height: EDIT_H,
  },
  // キャラは Canvas の下に敷く(Canvas の入れ子を避けるため兄弟にする)。
  editBird: {
    position: 'absolute',
    left: (EDIT_W - EDIT_BIRD) / 2,
    top: TAP_Y - EDIT_BIRD / 2,
  },

  spacer: { flex: 1 },

  // 保存完了オーバーレイ
  savedOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(242,242,247,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  savedCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#30D158',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  savedTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
  savedSub: { fontSize: 13, color: '#8E8E93' },
});
