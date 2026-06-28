/**
 * PolygonTutorialScreen — 手動切り抜きの操作手順チュートリアル
 *
 * 「手動で囲む」を選択したとき、PolygonEditor に入る前に表示する。
 * 「次回から表示しない」チェックをONにして「はじめる」を押すと
 * settings.skipPolygonTutorial = true が保存され、次回以降スキップされる。
 *
 * 図のアニメーション:
 *   タップ → 小さい四角が出現 → 各頂点が順番に外側へ広がる → 完成 → フェードアウト → ループ
 *   reanimated useSharedValue + useDerivedValue で UI スレッド上で完結。
 *   Canvas/Circle/Line/Oval は Skia の AnimatedProp<T> 経由で SharedValue を直接受け取る。
 */
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withRepeat,
  withTiming,
  withSpring,
  cancelAnimation,
  Easing,
  interpolateColor,
  runOnJS,
  ReduceMotion,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  Oval,
  Line,
  Group,
  RoundedRect,
} from '@shopify/react-native-skia';
import type { AnimatedProp } from '@shopify/react-native-skia';
import type { Vector } from '@shopify/react-native-skia';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from './onboarding/BirdMascot';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import { colors, spacing, radius, shadow } from './ui/theme';
import { useSettings } from '../settings/SettingsContext';

// ── アニメーション定数 ─────────────────────────────────────────────────────────

const CANVAS_W = 200;
const CANVAS_H = 200;
const CX = CANVAS_W / 2; // 100

// キャラシルエット
const HEAD_CX = CX;
const HEAD_CY = 68;
const HEAD_R  = 21;
const BODY_X  = CX - 22;
const BODY_Y  = 93;
const BODY_W  = 44;
const BODY_H  = 68;

// タップリップルの中心
const TAP_X = CX;
const TAP_Y = 108;

// 初期(小さい)ボックス角
const INIT_HALF = 16;
const INIT_TL = { x: TAP_X - INIT_HALF, y: TAP_Y - INIT_HALF };
const INIT_TR = { x: TAP_X + INIT_HALF, y: TAP_Y - INIT_HALF };
const INIT_BL = { x: TAP_X - INIT_HALF, y: TAP_Y + INIT_HALF };
const INIT_BR = { x: TAP_X + INIT_HALF, y: TAP_Y + INIT_HALF };

// 最終(キャラを囲む)ボックス角。
// day の BirdMascot(後述: left50/top50/size100 → 円の外接は x50..150 / y50..150、
// 尻尾が右下 ~(134,136) まで)に、少しだけ余白を足してゆるく囲む。
const FINAL_TL = { x: 44, y: 44 };
const FINAL_TR = { x: 156, y: 44 };
const FINAL_BL = { x: 44, y: 158 };
const FINAL_BR = { x: 156, y: 158 };

const HANDLE_R  = 5;   // ハンドル円半径
const FINGER_R  = 7;   // 指カーソル円半径
const BOX_SW    = 2.5; // ボックス線幅

// ── ペンボタン (Canvas 右端フローティング) ──────────────────────────────────
// 実エディタ: right:8, 44×44 ボタン。図は縮小版をキャラと重ならない上端に配置
const TOOL_X  = 166;           // ボタン左端 X (right:8 相当, 200-8-26=166)
const TOOL_W  = 26;            // ボタン幅/高さ (正方形)
const TOOL_R  = 6;             // 角丸半径
const TOOL_CX = TOOL_X + TOOL_W / 2; // = 179 ボタン中心 X
const TOOL_EY = 8;             // edit ボタン上端 Y (キャラ頭部 y≈47 より上)

// サイクル全体の長さ(ms)
const CYCLE_MS = 5500;

// ── ワークレットユーティリティ ────────────────────────────────────────────────

// [a, b] を 0→1 に正規化してクランプ
function norm(p: number, a: number, b: number): number {
  'worklet';
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}

// linear interp
function lerp(t: number, from: number, to: number): number {
  'worklet';
  return from + (to - from) * t;
}

// easeInOut cubic
function easeIO(t: number): number {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * ステップの active/done レベル (0→1) を計算するワークレット。
 * @param p      現在の phase 値 (0→1)
 * @param aStart アクティブ開始
 * @param aEnd   アクティブ終了（= done 開始）
 * @param dEnd   done 終了（リセット開始）
 * @returns [activeLevel, doneLevel] いずれも 0→1
 */
function stepLevels(p: number, aStart: number, aEnd: number, dEnd: number): [number, number] {
  'worklet';
  const T = 0.025; // トランジション幅
  if (p < aStart - T) return [0, 0];
  if (p < aStart + T) return [norm(p, aStart - T, aStart + T), 0];
  if (p < aEnd    - T) return [1, 0];
  if (p < aEnd    + T) { const t = norm(p, aEnd - T, aEnd + T); return [1 - t, t]; }
  if (p < dEnd    - T) return [0, 1];
  if (p < dEnd    + T) return [0, 1 - norm(p, dEnd - T, dEnd + T)];
  return [0, 0];
}

// ── AnimatedFigure ────────────────────────────────────────────────────────────

/**
 * タイムライン (phase: 0→1 = 5500ms)
 *
 * [0.00, 0.07]  シーン全体フェードイン                     (385ms)
 * [0.03, 0.13]  タップリップル                             (550ms)
 * [0.10, 0.18]  ボックス出現                               (440ms)
 * [0.18, 0.28]  ★ポーズ: 小さい四角を静止表示             (550ms)
 * [0.28, 0.39]  TL コーナー → 最終位置 + 指が追従          (605ms)
 * [0.39, 0.50]  TR コーナー → 最終位置 + 指が追従          (605ms)
 * [0.50, 0.60]  BL コーナー → 最終位置                    (550ms)
 * [0.60, 0.70]  BR コーナー → 最終位置 + 指が追従          (550ms)
 * [0.70, 0.83]  完成形を保持                               (715ms)
 * [0.83, 1.00]  フェードアウト                             (935ms)
 */
function AnimatedFigure({ phase }: { phase: SharedValue<number> }) {

  // ── Scene opacity — Skia Group で制御 ────────────────────────────────
  // p=0 も p=1 も 0 なのでループ繋ぎ目でフラッシュしない
  const sceneOp = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.07) return p / 0.07;
    if (p > 0.83) return 1 - (p - 0.83) / 0.17;
    return 1;
  });

  // ── Pen button glow & active state ────────────────────────────────────
  // penGlow: step1 前半 [0.00, 0.08] = 1 → [0.08, 0.18] で 0 に収束（タップ演出）
  const penGlow = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.08) return 1;
    if (p < 0.18) return 1 - norm(p, 0.08, 0.18);
    return 0;
  });
  // 外側のハロー: glow の 0.3 倍で柔らかく光らせる
  const penHalo = useDerivedValue(() => {
    'worklet';
    return penGlow.value * 0.3;
  });
  // penActive: 押した後 [0.08, 0.18] で青に変わり、以降ずっと青を維持（実エディタの選択状態）
  const penActive = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.08) return 0;
    if (p < 0.18) return norm(p, 0.08, 0.18);
    return 1;
  });

  // ── Tap ripple ──────────────────────────────────────────────────────────
  const tapR = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.03, 0.13)), 6, 22);
  });
  const tapOp = useDerivedValue(() => {
    'worklet';
    return 1 - norm(phase.value, 0.03, 0.13);
  });

  // ── Box opacity ─────────────────────────────────────────────────────────
  const boxOp = useDerivedValue(() => {
    'worklet';
    return norm(phase.value, 0.10, 0.18);
  });

  // ── Corner X / Y ────────────────────────────────────────────────────────
  // [0.18, 0.28] はポーズ区間 → 各頂点は INIT 位置で静止
  const tlX = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.28, 0.39)), INIT_TL.x, FINAL_TL.x);
  });
  const tlY = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.28, 0.39)), INIT_TL.y, FINAL_TL.y);
  });
  const trX = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.39, 0.50)), INIT_TR.x, FINAL_TR.x);
  });
  const trY = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.39, 0.50)), INIT_TR.y, FINAL_TR.y);
  });
  const blX = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.50, 0.60)), INIT_BL.x, FINAL_BL.x);
  });
  const blY = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.50, 0.60)), INIT_BL.y, FINAL_BL.y);
  });
  const brX = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.60, 0.70)), INIT_BR.x, FINAL_BR.x);
  });
  const brY = useDerivedValue(() => {
    'worklet';
    return lerp(easeIO(norm(phase.value, 0.60, 0.70)), INIT_BR.y, FINAL_BR.y);
  });

  // ── Finger position + opacity ───────────────────────────────────────────
  // [0.18, 0.28] ポーズ中: 指は TL init 位置で待機(「ここを動かす」を示す)
  // TL 追従 [0.28, 0.39] → TR 追従 [0.39, 0.50] → BR 追従 [0.60, 0.70]
  const fingerX = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.11)         return TAP_X;
    if (p < 0.19)         return lerp(norm(p, 0.11, 0.19), TAP_X, INIT_TL.x); // 中央→TL init
    if (p < 0.28)         return INIT_TL.x;                                    // ポーズ中: TL init で待機
    if (p <= 0.39)        return tlX.value;                                    // TL 追従
    if (p < 0.42)         return lerp(norm(p, 0.39, 0.42), FINAL_TL.x, INIT_TR.x); // TL→TR
    if (p <= 0.50)        return trX.value;                                    // TR 追従
    if (p < 0.62)         return FINAL_TR.x;                                   // 待機
    if (p <= 0.70)        return brX.value;                                    // BR 追従
    return FINAL_BR.x;
  });
  const fingerY = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.11)         return TAP_Y;
    if (p < 0.19)         return lerp(norm(p, 0.11, 0.19), TAP_Y, INIT_TL.y);
    if (p < 0.28)         return INIT_TL.y;
    if (p <= 0.39)        return tlY.value;
    if (p < 0.42)         return lerp(norm(p, 0.39, 0.42), FINAL_TL.y, INIT_TR.y);
    if (p <= 0.50)        return trY.value;
    if (p < 0.62)         return FINAL_TR.y;
    if (p <= 0.70)        return brY.value;
    return FINAL_BR.y;
  });
  const fingerOp = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.10) return 0;
    if (p < 0.14) return norm(p, 0.10, 0.14);
    if (p > 0.72) return 1 - norm(p, 0.72, 0.80);
    return 1;
  });

  // ── Box lines: 4辺の端点を DerivedValue<Vector> で渡す ─────────────────
  const topP1 = useDerivedValue(() => ({ x: tlX.value, y: tlY.value }));
  const topP2 = useDerivedValue(() => ({ x: trX.value, y: trY.value }));
  const rtP1  = useDerivedValue(() => ({ x: trX.value, y: trY.value }));
  const rtP2  = useDerivedValue(() => ({ x: brX.value, y: brY.value }));
  const botP1 = useDerivedValue(() => ({ x: blX.value, y: blY.value }));
  const botP2 = useDerivedValue(() => ({ x: brX.value, y: brY.value }));
  const ltP1  = useDerivedValue(() => ({ x: tlX.value, y: tlY.value }));
  const ltP2  = useDerivedValue(() => ({ x: blX.value, y: blY.value }));

  return (
    // plain View: ダーク背景は常に表示、Canvas 内要素は sceneOp Group で一括制御
    <View style={fig.wrap}>
      {/* 飾り: night を右に半分見切れ配置(静止・非インタラクティブ・背面・やや小さめ)。
          fig.wrap の overflow:hidden で右端がクリップされ「見切れ」になる。囲み対象ではない。 */}
      <View style={fig.nightDeco} pointerEvents="none">
        <BirdMascot variant="night" size={76} />
      </View>
      {/* くり抜き見本本体: day を Canvas の背面に重ねる(箱線・ハンドルは Canvas 側が上に描く)。
          Skia は別 Canvas をネストできないため View レイヤーで重ね、同じ 200×200 座標系に乗せる。 */}
      <View style={fig.dayMascot} pointerEvents="none">
        <BirdMascot variant="day" size={100} />
      </View>
      <Canvas style={{ width: CANVAS_W, height: CANVAS_H }}>
        {/*
          最上位 Group で sceneOp を適用。
          p=0 も p=1 も sceneOp=0 なので、ループ繋ぎ目で全要素が完全透明になる。
          Animated.View と違い同一 Skia レンダーパスで atomic に処理されるため
          タイミングズレによるフラッシュが起きない。
        */}
        <Group opacity={sceneOp as unknown as AnimatedProp<number>}>

          {/* ─ キャラシルエットは BirdMascot(day) を背面 View で表示するためここでは描かない ─ */}

          {/* ─ ペンボタン (右端フローティング) — ステップ1でグロー ─ */}
          {/* ハロー: ボタン外側の柔らかい青グロー */}
          <RoundedRect
            x={TOOL_X - 4} y={TOOL_EY - 4}
            width={TOOL_W + 8} height={TOOL_W + 8}
            r={TOOL_R + 4}
            color="#007AFF"
            opacity={penHalo as unknown as AnimatedProp<number>}
          />
          {/* ボタンベース: 押す前の下地（薄白） */}
          <RoundedRect
            x={TOOL_X} y={TOOL_EY} width={TOOL_W} height={TOOL_W} r={TOOL_R}
            color="rgba(255,255,255,0.18)"
          />
          {/* 青の永続レイヤー: 押した後は常時 #007AFF（実エディタの選択状態と同色） */}
          <RoundedRect
            x={TOOL_X} y={TOOL_EY} width={TOOL_W} height={TOOL_W} r={TOOL_R}
            color="#007AFF"
            opacity={penActive as unknown as AnimatedProp<number>}
          />
          {/* 初期グロー: step1 前半の光り（penActive に引き継がれ自然に消える） */}
          <RoundedRect
            x={TOOL_X} y={TOOL_EY} width={TOOL_W} height={TOOL_W} r={TOOL_R}
            color="rgba(255,255,255,0.25)"
            opacity={penGlow as unknown as AnimatedProp<number>}
          />
          {/* edit アイコン: 斜め線(ペン軸) */}
          <Line
            p1={{ x: TOOL_CX - 5, y: TOOL_EY + TOOL_W / 2 + 5 }}
            p2={{ x: TOOL_CX + 5, y: TOOL_EY + TOOL_W / 2 - 5 }}
            color="rgba(255,255,255,0.92)"
            strokeWidth={1.5}
          />
          {/* edit アイコン: 短い横線(ペン先端のフラット部) */}
          <Line
            p1={{ x: TOOL_CX + 3, y: TOOL_EY + TOOL_W / 2 - 5 }}
            p2={{ x: TOOL_CX + 6, y: TOOL_EY + TOOL_W / 2 - 2 }}
            color="rgba(255,255,255,0.92)"
            strokeWidth={1.5}
          />

          {/* ─ タップリップル ─ */}
          <Circle
            cx={TAP_X}
            cy={TAP_Y}
            r={tapR as unknown as AnimatedProp<number>}
            color="rgba(255,255,255,0.35)"
            opacity={tapOp as unknown as AnimatedProp<number>}
          />

          {/* ─ ボックス枠 4辺 ─ */}
          <Group
            opacity={boxOp as unknown as AnimatedProp<number>}
            color="#30D158"
            strokeWidth={BOX_SW}
            style="stroke"
          >
            <Line p1={topP1 as unknown as AnimatedProp<Vector>} p2={topP2 as unknown as AnimatedProp<Vector>} />
            <Line p1={rtP1  as unknown as AnimatedProp<Vector>} p2={rtP2  as unknown as AnimatedProp<Vector>} />
            <Line p1={botP1 as unknown as AnimatedProp<Vector>} p2={botP2 as unknown as AnimatedProp<Vector>} />
            <Line p1={ltP1  as unknown as AnimatedProp<Vector>} p2={ltP2  as unknown as AnimatedProp<Vector>} />
          </Group>

          {/* ─ 四隅ハンドル ─ */}
          <Group opacity={boxOp as unknown as AnimatedProp<number>} color="#FFFFFF">
            <Circle cx={tlX as unknown as AnimatedProp<number>} cy={tlY as unknown as AnimatedProp<number>} r={HANDLE_R} />
            <Circle cx={trX as unknown as AnimatedProp<number>} cy={trY as unknown as AnimatedProp<number>} r={HANDLE_R} />
            <Circle cx={blX as unknown as AnimatedProp<number>} cy={blY as unknown as AnimatedProp<number>} r={HANDLE_R} />
            <Circle cx={brX as unknown as AnimatedProp<number>} cy={brY as unknown as AnimatedProp<number>} r={HANDLE_R} />
          </Group>

          {/* ─ 指カーソル (緑丸 + 白縁) ─ */}
          <Circle
            cx={fingerX as unknown as AnimatedProp<number>}
            cy={fingerY as unknown as AnimatedProp<number>}
            r={FINGER_R + 2}
            color="rgba(255,255,255,0.7)"
            opacity={fingerOp as unknown as AnimatedProp<number>}
          />
          <Circle
            cx={fingerX as unknown as AnimatedProp<number>}
            cy={fingerY as unknown as AnimatedProp<number>}
            r={FINGER_R}
            color="#30D158"
            opacity={fingerOp as unknown as AnimatedProp<number>}
          />

        </Group>
      </Canvas>
    </View>
  );
}

const fig = StyleSheet.create({
  wrap: {
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: '#1C1C1E',
    borderRadius: radius.lg,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  // 重ね順は zIndex を付けず JSX のソース順で決める: night → day → Canvas(箱線/ハンドル)。
  // ※zIndex を付けると Canvas より前面に出てしまい、箱線がキャラの裏に回るので付けない。
  // くり抜き見本本体(day): 200×200 座標系の中央に size100(left/top=50 → 円は 50..150)。Canvas より背面。
  dayMascot: { position: 'absolute', left: 50, top: 50 },
  // 飾り(night): 右端から半分はみ出す(left164 + size76 = 240 > 200 でクリップ)。day より背面・静止。
  nightDeco: { position: 'absolute', left: 164, top: 62 },
});

// ── アニメーション連動ステップカード ─────────────────────────────────────────

interface AnimatedStepCardProps {
  phase:    SharedValue<number>;
  /** このステップがアクティブになる phase 区間 */
  aStart:   number;
  aEnd:     number;
  /** done 状態が終わる phase 値（リセット） */
  dEnd:     number;
  num:      number;
  icon:     string;
  title:    string;
  sub?:     string;
}

function AnimatedStepCard({ phase, aStart, aEnd, dEnd, num, icon, title, sub }: AnimatedStepCardProps) {
  // active/done レベル (UI スレッド)
  const activeLevel = useDerivedValue(() => stepLevels(phase.value, aStart, aEnd, dEnd)[0]);
  const doneLevel   = useDerivedValue(() => stepLevels(phase.value, aStart, aEnd, dEnd)[1]);

  // バッジ状態 (JS スレッド: 内容の切り替えに使用)
  const [badgeState, setBadgeState] = useState<'inactive' | 'active' | 'done'>('inactive');
  useAnimatedReaction(
    () => {
      const a = activeLevel.value;
      const d = doneLevel.value;
      if (a > 0.5) return 'active' as const;
      if (d > 0.5) return 'done' as const;
      return 'inactive' as const;
    },
    (cur, prev) => { if (cur !== prev) runOnJS(setBadgeState)(cur); },
  );

  // カードのアニメーションスタイル
  const cardStyle = useAnimatedStyle(() => {
    const a = activeLevel.value;
    const d = doneLevel.value;
    return {
      transform: [
        { scale:      withSpring(1 + a * 0.03, { damping: 15, stiffness: 200 }) },
        { translateY: withSpring(-4 * a,        { damping: 15, stiffness: 200 }) },
      ],
      backgroundColor: interpolateColor(a, [0, 1], [colors.card, '#EAF2FF']),
      borderColor:     interpolateColor(a, [0, 1], [colors.separator, colors.accent]),
      opacity: 1 - d * 0.35, // done は少し薄く
    };
  });

  // バッジのアニメーションスタイル
  const badgeStyle = useAnimatedStyle(() => {
    const a = activeLevel.value;
    return {
      backgroundColor: interpolateColor(a, [0, 1], [colors.fill, colors.accent]),
    };
  });

  return (
    <Animated.View style={[s.stepCard, cardStyle]}>
      <View style={s.step}>
        {/* バッジ: done=✓, active/inactive=数字 */}
        <Animated.View style={[s.stepBadge, badgeStyle]}>
          {badgeState === 'done'
            ? <Icon name="check" size={13} color={badgeState === 'done' ? colors.secondary : colors.accent} />
            : <Text style={[s.stepNum, badgeState === 'active' && s.stepNumActive]}>{num}</Text>
          }
        </Animated.View>
        <View style={s.stepIconWrap}>
          <Icon name={icon} size={22} color={colors.accent} />
        </View>
        <View style={s.stepText}>
          <Text style={s.stepTitle}>{title}</Text>
          {sub && <Text style={s.stepSub}>{sub}</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onStart: () => void;
  onBack:  () => void;
  /**
   * 'onboarding': 初回フロー。フッターに「はじめる」→ エディタへ進む。
   * 'help':       使い方閲覧。フッターに「閉じる」→ 呼び出し元に戻る。
   * デフォルトは 'onboarding'。
   */
  mode?: 'onboarding' | 'help';
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function PolygonTutorialScreen({ onStart, onBack, mode = 'onboarding' }: Props) {
  const { updateSettings } = useSettings();
  const [skipNext, setSkipNext] = useState(true);
  const isHelp = mode === 'help';

  // アニメーション phase を最上位で管理し、図・ステップカード・プレビューボタン全体に共有
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // プレビューボタンのグロー: ステップ3 [0.70, 0.83] でアクティブ
  const previewGlow = useDerivedValue(() => {
    'worklet';
    const p = phase.value;
    if (p < 0.68) return 0;
    if (p < 0.72) return norm(p, 0.68, 0.72);
    if (p < 0.81) return 1;
    if (p < 0.85) return 1 - norm(p, 0.81, 0.85);
    return 0;
  });
  const previewBtnStyle = useAnimatedStyle(() => {
    const p = phase.value;
    // 押し込み: [0.72, 0.74] で 1.0 → 0.93, リリース: [0.74, 0.78] で 0.93 → 1.0
    let scale = 1.0;
    if (p >= 0.72 && p < 0.74) {
      scale = 1.0 - norm(p, 0.72, 0.74) * 0.07;
    } else if (p >= 0.74 && p < 0.78) {
      scale = 0.93 + norm(p, 0.74, 0.78) * 0.07;
    }
    return {
      opacity: 0.28 + previewGlow.value * 0.72,
      transform: [{ scale }],
    };
  });

  const handleStart = async () => {
    if (!isHelp && skipNext) {
      await updateSettings({ skipPolygonTutorial: true });
    }
    onStart();
  };

  const header = (
    <AppHeader
      title="手動で囲む"
      onBack={onBack}
      backLabel="戻る"
    />
  );

  const footer = (
    <View style={s.footerWrap}>
      {/* 初回フローのみ「次回から表示しない」チェックを表示 */}
      {!isHelp && (
        <AnimatedPressable
          style={s.skipRow}
          onPress={() => setSkipNext(v => !v)}
          pressedScale={0.97}
        >
          <View style={[s.checkbox, skipNext && s.checkboxOn]}>
            {skipNext && <Icon name="check" size={14} color="#FFF" />}
          </View>
          <Text style={s.skipTxt}>次回から表示しない</Text>
        </AnimatedPressable>
      )}

      <AnimatedPressable style={s.startBtn} onPress={handleStart} pressedScale={0.97}>
        <Text style={s.startBtnTxt}>{isHelp ? '閉じる' : 'はじめる'}</Text>
      </AnimatedPressable>
    </View>
  );

  return (
    <Screen header={header} footer={footer} bg={colors.bg}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.headline}>四角を置いて形を合わせる</Text>
        <Text style={s.sub}>自動でうまくいかない時はこちら</Text>

        {/* アニメ図 + プレビューボタンを縦に並べる */}
        <View style={s.figureArea}>
          <AnimatedFigure phase={phase} />
          {/* プレビューボタン: 実エディタの下部バー右端ボタンを縮小再現 */}
          <Animated.View style={[s.previewBtn, previewBtnStyle]}>
            <Icon name="preview" size={16} color="#FFF" />
            <Text style={s.previewBtnTxt}>プレビュー</Text>
          </Animated.View>
        </View>

        {/* ステップカード: phase を共有してアニメーション連動 */}
        <View style={s.stepsWrap}>
          <AnimatedStepCard
            phase={phase}
            aStart={0.10} aEnd={0.28} dEnd={1.05}
            num={1} icon="edit"
            title="ペンを押して、キャラをタップ"
            sub="四角が出る"
          />
          <AnimatedStepCard
            phase={phase}
            aStart={0.28} aEnd={0.70} dEnd={1.05}
            num={2} icon="open-with"
            title="白い点を外側へ広げてキャラを囲む"
            sub="辺をタップで点を追加・長押しで削除"
          />
          <AnimatedStepCard
            phase={phase}
            aStart={0.70} aEnd={0.83} dEnd={1.00}
            num={3} icon="photo-camera"
            title="「プレビュー」で切り出して確認"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },

  // アニメ図 + プレビューボタンのコンテナ
  figureArea: {
    width: CANVAS_W,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  // プレビューボタン: 実エディタの exportBtn (flex:1, height:48, blue) を縮小再現
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    backgroundColor: colors.accent,
    borderRadius: 12,
    gap: 6,
  },
  previewBtnTxt: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFF',
  },

  headline: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.label,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    color: colors.secondary,
    textAlign: 'center',
    marginTop: -spacing.sm,
  },

  // ステップカード群のラッパー (gap のみ担当)
  stepsWrap: {
    width: '100%',
    gap: spacing.sm,
  },
  // 各ステップカード本体
  // borderWidth は静的固定 → borderColor のみ animate (レイアウト変化なし)
  stepCard: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.separator, // 初期値; useAnimatedStyle で上書き
    ...shadow.sm,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.fill, // 初期値; useAnimatedStyle で上書き
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary, // inactive: グレー
  },
  stepNumActive: {
    color: '#FFFFFF', // active: バッジが青になるので白抜き
  },
  stepIconWrap: {
    width: 32,
    alignItems: 'center',
  },
  stepText: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.label,
  },
  stepSub: {
    fontSize: 12,
    color: colors.secondary,
  },

  footerWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  skipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.separator,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  skipTxt: {
    fontSize: 14,
    color: colors.secondary,
  },
  startBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnTxt: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFF',
  },
});
