/**
 * MergeCellsAnimation.tsx — 複雑な画像チュートリアル STEP2(割れたカットを合体する)
 *
 * 器(ComplexStickerTutorialScreen)の STEPS[1] に差し込む中身。
 * STEP1 で「この行数で分割」を押した続き。分割結果画面(ResultScreen)を再現し、
 *   A) 上段2枚は綺麗に切れているが、下段は1匹が左右に割れている
 *   B) 割れた片方を長押し → 選択(合体)モードに入る
 *   C) もう片方をタップして選び、「2枚を合体する」で1枚に戻す
 * をループアニメで見せる。合体後の1枚をタップしてポリゴン編集する流れは STEP3 で扱う。
 *
 * STEP1 と同じスタンプ(day / night / sleep)を使う。sleep は STEP1 の縦の中央線で
 * 割られた結果なので、ここでは左半分・右半分の2枚として並んでいる。
 * 「半分」は BirdMascot を幅半分の overflow:hidden な箱に入れてずらして作る
 * （画像を切る処理は不要で、見た目だけ再現できる）。
 *
 * アニメ作法は OnboardingStep2 / AutoSplitAnimation と同じ:
 *   1つの進行用 SharedValue(phase) でタイムラインを作り、
 *   各要素の useAnimatedStyle が時間窓で動く。
 *
 * Android白化対策:
 *   height/width/borderWidth は動かさず、transform(scale/translate)と opacity のみ。
 *   選択枠は「静的な borderWidth を持つオーバーレイの opacity」で出し入れする
 *   (ResultScreen 本体が borderWidth を避けているのと同じ理由)。
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
import { shared, norm, easeIO, fadeHold, jumpY, SPEAK_FADE, FRAME_SLIDE } from '../shared';
import { EditorMock, BODY_PAD, GRID_GAP, INNER_W, CELL, BIRD, ui } from './parts';
import { useT } from '../../../i18n';

// ── 定数 ───────────────────────────────────────────────────────────────────────
// 長押し→選択→合体→編集へ、と手数が多いので STEP1 より長め。
// 器の上部プログレスバーもこの長さで進むので export する。
export const CYCLE_MS = 17000;

// グリッドの寸法・セル・編集画面モックは parts.tsx で STEP3 と共有している。

// 文言は描画時に t() で解決する。

// ── タイムライン ──────────────────────────────────────────────────────────────
// A喋り[0.02,0.24] → 長押し[0.18,0.30] → 選択モード[0.30] → C喋り[0.32,0.62]
//  → 片割れをタップ[0.38,0.46] → 合体ボタン[0.52,0.60] → 合体[0.60,0.68]
//  → D喋り[0.70,0.95] → 合体した1枚を短押し[0.76,0.84] → ポリゴン編集へ[0.84,0.90]
const LONG_PRESS: [number, number] = [0.18, 0.30];
// 長押しの「押し込んだまま待つ」区間。ここでセルが少し沈み、リングが閉じていく。
// タップと見分けが付くよう、押し始め〜発火までをはっきり見せるのが狙い。
const HOLD_FROM = 0.19;
const HOLD_TO = 0.29;
const SELECT_MODE_IN = 0.30;   // 選択モードのUIに切り替わる
const TAP_OTHER: [number, number] = [0.38, 0.46];
const SECOND_SELECTED = 0.44;  // 2枚目が選ばれた見た目になる
const MERGE_TAP: [number, number] = [0.52, 0.60];
const MERGE_START = 0.60;      // 2枚 → 1枚のクロスフェード開始
const MERGE_END = 0.68;
// 合体した1枚を「選択モードではない短押し」でタップ → ポリゴン編集画面へ。
// 描き方そのものは既存の PolygonTutorialScreen が説明しているので、
// ここでは「分割結果からタップで編集に入れる」という入口だけを見せる。
const EDIT_TAP: [number, number] = [0.76, 0.84];
const EDITOR_IN = 0.84;        // 画面が切り替わり始める
const EDITOR_FULL = 0.90;      // 切り替わり切る
const RESET_START = 0.97;      // ループ先頭へ戻すための片付け

// ── コンポーネント ────────────────────────────────────────────────────────────
export default function MergeCellsAnimation({ active = true }: { active?: boolean }) {
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

  // ── セクション見出しの右側テキスト(長押しで選択・合体 ⇄ N枚選択中) ──
  const hintNormalStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= SELECT_MODE_IN && phase.value < RESET_START ? 0 : 1,
  }));
  const hintSelectStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= SELECT_MODE_IN && phase.value < RESET_START ? 1 : 0,
  }));

  // ── 長押しの表現 ──
  // (1) セル自体が少し沈んだまま保持される（タップなら一瞬で戻るので区別が付く）
  const holdCellStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let dip = 0;
    if (p < HOLD_FROM)                           dip = 0;
    else if (p < HOLD_FROM + 0.02)               dip = norm(p, HOLD_FROM, HOLD_FROM + 0.02); // 押し込む
    else if (p < HOLD_TO)                        dip = 1;                                     // 保持
    else if (p < HOLD_TO + 0.02)                 dip = 1 - norm(p, HOLD_TO, HOLD_TO + 0.02);  // 離す
    return { transform: [{ scale: 1 - 0.045 * dip }] };
  });
  // (2) 押している間じわっと閉じていくリング。閉じ切った瞬間が「発火」。
  const holdRingStyle = useAnimatedStyle(() => {
    const p = phase.value;
    if (p < HOLD_FROM || p > HOLD_TO + 0.03) return { opacity: 0, transform: [{ scale: 1.7 }] };
    const t = easeIO(norm(p, HOLD_FROM, HOLD_TO));
    // 発火直後は弾けて消える
    const after = norm(p, HOLD_TO, HOLD_TO + 0.03);
    return {
      opacity: (1 - after) * 0.9,
      transform: [{ scale: 1.7 - 0.7 * t + after * 0.5 }],
    };
  });

  // ── 選択枠(オレンジ) ──
  // 1枚目: 長押し完了で点く。2枚目: タップで点く。合体後はどちらも消す。
  const sel3Style = useAnimatedStyle(() => {
    const p = phase.value;
    const on = p >= SELECT_MODE_IN && p < MERGE_START;
    return { opacity: on ? 1 : 0 };
  });
  const sel4Style = useAnimatedStyle(() => {
    const p = phase.value;
    const on = p >= SECOND_SELECTED && p < MERGE_START;
    return { opacity: on ? 1 : 0 };
  });

  // ── 下段: 割れた2枚 → 合体した1枚 のクロスフェード ──
  const splitStyle = useAnimatedStyle(() => {
    const p = phase.value;
    if (p < MERGE_START) return { opacity: 1 };
    if (p < MERGE_END)   return { opacity: 1 - easeIO(norm(p, MERGE_START, MERGE_END)) };
    if (p < RESET_START) return { opacity: 0 };
    return { opacity: easeIO(norm(p, RESET_START, 1)) }; // ループ先頭へ戻す
  });
  const mergedStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 0;
    if (p < MERGE_START)      o = 0;
    else if (p < MERGE_END)   o = easeIO(norm(p, MERGE_START, MERGE_END));
    else if (p < RESET_START) o = 1;
    else                      o = 1 - easeIO(norm(p, RESET_START, 1));
    // 合体した瞬間に軽く弾ませて「1枚になった」ことを強調する
    const pop = p >= MERGE_START && p < MERGE_END
      ? 0.96 + 0.04 * easeIO(norm(p, MERGE_START, MERGE_END))
      : 1;
    return { opacity: o, transform: [{ scale: pop }] };
  });

  // ── フッター: 通常(保存する) ⇄ 選択モード(合体する / キャンセル) ──
  const footerNormalStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= SELECT_MODE_IN && phase.value < MERGE_END ? 0 : 1,
  }));
  const footerSelectStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= SELECT_MODE_IN && phase.value < MERGE_END ? 1 : 0,
  }));
  // 合体ボタンは2枚目を選ぶまで非活性(グレー)、選んだら活性(青)。
  const mergeBtnStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const enabled = p >= SECOND_SELECTED;
    let scale = 1;
    if (p >= MERGE_TAP[0] && p < 0.71)      scale = 1 - norm(p, MERGE_TAP[0], 0.71) * 0.05;
    else if (p >= 0.71 && p < MERGE_TAP[1]) scale = 0.95 + norm(p, 0.71, MERGE_TAP[1]) * 0.05;
    return { opacity: enabled ? 1 : 0.45, transform: [{ scale }] };
  });

  // ── 画面遷移: 分割結果 ⇄ ポリゴン編集 ──
  // フレームの中身を2層重ねてクロスフェードする。編集側は少し下から出して
  // 「別の画面に入った」感じを付ける（translate/opacity のみ）。
  const resultLayerStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 1;
    if (p < EDITOR_IN)        o = 1;
    else if (p < EDITOR_FULL) o = 1 - easeIO(norm(p, EDITOR_IN, EDITOR_FULL));
    else if (p < RESET_START) o = 0;
    else                      o = easeIO(norm(p, RESET_START, 1));
    return { opacity: o };
  });
  const editorLayerStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let o = 0;
    if (p < EDITOR_IN)        o = 0;
    else if (p < EDITOR_FULL) o = easeIO(norm(p, EDITOR_IN, EDITOR_FULL));
    else if (p < RESET_START) o = 1;
    else                      o = 1 - easeIO(norm(p, RESET_START, 1));
    const slide = p < EDITOR_FULL ? (1 - easeIO(norm(p, EDITOR_IN, EDITOR_FULL))) * 16 : 0;
    return { opacity: o, transform: [{ translateY: slide }] };
  });

  // ── 字幕(キャラ＋吹き出し) ──
  const mascotAStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.01, 0.30, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.02) }],
  }));
  const bubbleAStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.02, 0.24, SPEAK_FADE) }));
  // C と D は同じ下スロットに置き、時間窓で入れ替える。
  const mascotCStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.30, 0.68, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.32) }],
  }));
  const bubbleCStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.32, 0.62, SPEAK_FADE) }));
  const mascotDStyle = useAnimatedStyle(() => ({
    opacity: fadeHold(phase.value, 0.68, 0.99, 0.03),
    transform: [{ translateY: jumpY(phase.value, 0.70) }],
  }));
  const bubbleDStyle = useAnimatedStyle(() => ({ opacity: fadeHold(phase.value, 0.70, 0.95, SPEAK_FADE) }));

  // フレームのスライド: A(上に喋る)=下へ / C・D(下操作)=上へ。
  const frameStyle = useAnimatedStyle(() => {
    const p = phase.value;
    let y = 0;
    if (p < 0.01)      y = 0;
    else if (p < 0.08) y = easeIO(norm(p, 0.01, 0.08));       // → +1
    else if (p < 0.26) y = 1;
    else if (p < 0.32) y = 1 - easeIO(norm(p, 0.26, 0.32));   // → 0
    else if (p < 0.38) y = -easeIO(norm(p, 0.32, 0.38));      // → -1
    else if (p < 0.96) y = -1;
    else               y = -1 + easeIO(norm(p, 0.96, 1));     // → 0
    return { transform: [{ translateY: FRAME_SLIDE * y }] };
  });

  return (
    <View style={shared.root}>
      {/* ── 上キャプション(フェーズA) ── */}
      <View style={shared.captionTop}>
        <SpeechBubble
          stepNumber={1}
          text={t('complexTutorial.merge.caption')}
          direction="left"
          mascotStyle={mascotAStyle}
          bubbleStyle={bubbleAStyle}
        />
      </View>

      {/* ── 実画面の枠。中身を「分割結果」と「ポリゴン編集」の2層で入れ替える ── */}
      <Animated.View style={[shared.frame, frameStyle]}>

        {/* ── 層2: ポリゴン編集画面(タップで入った先) ──
            描き方そのものは既存の「範囲を調整の使い方」に任せ、
            ここでは分割結果からタップで入れることだけを見せる。 */}
        <Animated.View style={[StyleSheet.absoluteFill, editorLayerStyle]} pointerEvents="none">
          {/* STEP3 と同じモックを共有する（片方だけ直して見た目がズレるのを防ぐ）*/}
          <EditorMock />
        </Animated.View>

        {/* ── 層1: 分割結果画面 ── */}
        <Animated.View style={[StyleSheet.absoluteFill, resultLayerStyle]}>
        {/* ヘッダー(戻る / 分割結果 / 設定) */}
        <View style={s.header}>
          <Text style={s.headerSide}>{t('common.back')}</Text>
          <Text style={s.headerTitle}>{t('result.title')}</Text>
          <Icon name="settings" size={18} color="#007AFF" />
        </View>

        <View style={s.body}>
          {/* セクション見出し: 左=枚数 / 右=ヒント(選択モードで文言が変わる) */}
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>{t('result.cutsLabel', { count: 4 })}</Text>
            <View>
              <Animated.Text style={[s.sectionHint, hintNormalStyle]}>{t('result.longPressHint')}</Animated.Text>
              {/* 同じ位置に重ねて入れ替える(レイアウトを動かさない) */}
              <Animated.Text style={[s.sectionHint, s.sectionHintOverlay, hintSelectStyle]}>
                {t('result.selectedCount', { count: 2 })}
              </Animated.Text>
            </View>
          </View>

          {/* ── カット後グリッド ───────────────────────────────────────── */}
          {/* 上段: 綺麗に切れている2枚 */}
          <View style={s.gridRow}>
            <Cell index={1}>
              <BirdMascot variant="day" size={BIRD} />
            </Cell>
            <Cell index={2}>
              <BirdMascot variant="night" size={BIRD} />
            </Cell>
          </View>

          {/* 下段: 割れた2枚 ⇄ 合体した1枚 を同じ場所で差し替える */}
          <View style={s.bottomRow}>
            {/* 割れた2枚 */}
            <Animated.View style={[s.bottomLayer, splitStyle]}>
              {/* 長押しされる側。押し込みはセルごと沈ませたいので Animated で包む */}
              <Animated.View style={holdCellStyle}>
                <Cell index={3} selectedStyle={sel3Style}>
                  {/* 左半分: 箱の左端にキャラを置き、右側をはみ出させて隠す */}
                  <View style={s.halfBox}>
                    <View style={s.halfInnerLeft}>
                      <BirdMascot variant="sleep" size={BIRD} />
                    </View>
                  </View>
                  {/* 長押し表現: 閉じていくリング + 指(TouchIndicator) */}
                  <View style={s.holdCenter} pointerEvents="none">
                    <Animated.View style={[s.holdRing, holdRingStyle]} />
                  </View>
                  <TouchIndicator progress={phase} window={LONG_PRESS} />
                </Cell>
              </Animated.View>
              <Cell index={4} selectedStyle={sel4Style}>
                {/* 右半分: キャラを左へずらして左側をはみ出させて隠す */}
                <View style={s.halfBox}>
                  <View style={s.halfInnerRight}>
                    <BirdMascot variant="sleep" size={BIRD} />
                  </View>
                </View>
                {/* タップ表現: 合体相手として選ぶ */}
                <TouchIndicator progress={phase} window={TAP_OTHER} />
              </Cell>
            </Animated.View>

            {/* 合体した1枚(下段いっぱい)。最後にここを短押しして編集へ入る。 */}
            <Animated.View style={[s.bottomLayer, s.mergedLayer, mergedStyle]} pointerEvents="none">
              <View style={[s.cell, s.mergedCell]}>
                <View style={s.numBadge}><Text style={s.numBadgeTxt}>3</Text></View>
                <BirdMascot variant="sleep" size={BIRD} />
                {/* 短押し表現: 選択モードではないタップ → ポリゴン編集へ */}
                <TouchIndicator progress={phase} window={EDIT_TAP} />
              </View>
            </Animated.View>
          </View>

          <View style={s.spacer} />

          {/* ── フッター: 通常 ⇄ 選択モード を同じ高さの箱で入れ替える ── */}
          <View style={s.footerArea}>
            {/* 通常: リセット + 保存する を1行に横並び(リセット1 : 保存2 の幅) */}
            <Animated.View style={[s.footerLayer, footerNormalStyle]}>
              <View style={ui.actionRow}>
                <View style={ui.actionBtn}>
                  <Icon name="refresh" size={16} color="#007AFF" />
                  <Text style={ui.actionBtnTxt}>{t('common.reset')}</Text>
                </View>
                <View style={ui.saveBtn}>
                  <Text style={ui.primaryBtnTxt}>{t('common.save')}</Text>
                </View>
              </View>
            </Animated.View>

            {/* 選択モード: 合体する / キャンセル */}
            <Animated.View style={[s.footerLayer, footerSelectStyle]}>
              <Animated.View style={[ui.primaryBtn, mergeBtnStyle]}>
                <Icon name="merge-type" size={18} color="#FFF" style={ui.mergeIcon} />
                <Text style={ui.primaryBtnTxt}>{t('result.mergeCount', { count: 2 })}</Text>
                {/* タップ表現: 合体ボタンを押す */}
                <TouchIndicator progress={phase} window={MERGE_TAP} />
              </Animated.View>
              <View style={ui.cancelBtn}>
                <Text style={ui.cancelBtnTxt}>{t('common.cancel')}</Text>
              </View>
            </Animated.View>
          </View>
        </View>
        </Animated.View>
      </Animated.View>

      {/* ── 下キャプション(フェーズC / D を同じスロットで入れ替える) ── */}
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={2}
          text={t('complexTutorial.merge.bubble')}
          direction="left"
          mascotStyle={mascotCStyle}
          bubbleStyle={bubbleCStyle}
        />
      </View>
      <View style={shared.captionBottom}>
        <SpeechBubble
          stepNumber={3}
          text={t('complexTutorial.merge.bubble2')}
          direction="left"
          mascotStyle={mascotDStyle}
          bubbleStyle={bubbleDStyle}
        />
      </View>
    </View>
  );
}

/**
 * カット1枚ぶんのセル。市松の下地 + 連番バッジ + 選択枠。
 * 選択枠は静的な borderWidth を持つオーバーレイで、opacity だけで出し入れする
 * (borderWidth を動かすと Android で再レイアウトが走って白くなるため)。
 */
function Cell({
  index,
  selectedStyle,
  children,
}: {
  index: number;
  selectedStyle?: ReturnType<typeof useAnimatedStyle>;
  children: React.ReactNode;
}) {
  return (
    <View style={s.cell}>
      {children}
      <View style={s.numBadge}><Text style={s.numBadgeTxt}>{index}</Text></View>
      {selectedStyle && (
        <>
          <Animated.View style={[s.selOverlay, selectedStyle]} pointerEvents="none" />
          <Animated.View style={[s.checkBadge, selectedStyle]} pointerEvents="none">
            <Icon name="check" size={12} color="#FFF" />
          </Animated.View>
        </>
      )}
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

  body: { flex: 1, padding: BODY_PAD, gap: GRID_GAP },

  // セクション見出し
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: '#8E8E93' },
  sectionHint: { fontSize: 13, color: '#007AFF' },
  // 同じ位置に重ねるための絶対配置(右揃え)
  sectionHintOverlay: { position: 'absolute', right: 0, top: 0 },

  // グリッド
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  bottomRow: { height: CELL },
  bottomLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  mergedLayer: { flexDirection: 'column' },

  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // 合体後は下段いっぱいの1枚になる
  mergedCell: { width: INNER_W },

  // 「半分に割れた」表現: 幅半分の箱でクリップし、中のキャラをずらす。
  halfBox: {
    width: BIRD / 2,
    height: BIRD,
    overflow: 'hidden',
  },
  halfInnerLeft: { position: 'absolute', left: 0, top: 0 },
  halfInnerRight: { position: 'absolute', left: -BIRD / 2, top: 0 },

  // 連番バッジ(左上)
  numBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  // 選択枠(オレンジ) + チェック
  selOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 12,
    borderWidth: 2.5,
    borderColor: '#FF9500',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF9500',
    alignItems: 'center',
    justifyContent: 'center',
  },

  spacer: { flex: 1 },

  // フッター(通常 / 選択モードを重ねる)
  footerArea: { height: 92, justifyContent: 'flex-end' },
  footerLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 8,
  },
  // フッターのボタン類は parts.tsx の ui に集約した（STEP3 と共有）。

  // ── ポリゴン編集画面(入った先のモック) ────────────────────────────────────
  editorCanvas: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // キャラ + 囲みポリゴン + 頂点ハンドルをまとめる箱
  editorSubject: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  polyBox: {
    position: 'absolute',
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  vtx: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  editorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F2F2F7',
  },
  editorTool: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPreviewBtn: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPreviewTxt: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  // ── 長押しリング(セル中央に重ねる) ────────────────────────────────────────
  holdCenter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: '#30D158',
  },
});
