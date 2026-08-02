/**
 * SplashAnimationView.tsx — 起動直後に出すスプラッシュ
 *
 * 共通フロー(約1.9秒):
 *   1. シマエナガ登場
 *   2. パターン固有のアクション
 *   3. アクションが原因でスプラッシュ層が削られ、**下のホーム画面が現れる**
 *      (削られ方はパターンごと: 風で吹き飛ぶ/波紋/端から剥がれる/一様に薄れる)
 *   4. ロゴ(app.name の文字ロゴ)表示
 *   5. フェードアウト → onFinish(呼び出し側がホームへ進める)
 *
 * 演出パターンは splash/patterns に分離してあり、animationType で切り替える。
 * 未指定なら端末のローカル時刻から選ぶ(朝=fly / 昼=peel / 夕夜=cross /
 * 深夜=sleep、まれにレア枠の drop)。判断は splash/patterns/index.ts の
 * resolveSplash に集約してあり、この画面は戻り値しか見ない。
 *
 * 駆動方式:
 *   共有値 elapsed(ms) を 0→total で1本流し、各要素は経過msから自分の値を引く。
 *   withSequence を積まないので、フェーズ長を変えても破綻しない。
 *
 * レイヤー構成(下から):
 *   ホーム画面(App が下に描画) → シーン色の膜(SceneVeil) → 世界の中身
 *   (SplashScene) → シマエナガ → ロゴ
 *   膜が削れた所からホーム画面がそのまま見える。演出後はこの層を外すだけで
 *   操作可能な状態になる(ホーム画面をフェードインさせているわけではない)。
 *
 * 既存資産の再利用:
 *   キャラは BirdMascot(showScene=false でキャラ単体)。
 *   BirdMascot に渡すのは任意プロップだけなので、オンボーディングには影響しない。
 *
 * Android白化対策として、動かすのは transform / opacity のみ。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useReducedMotion,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  runOnJS,
  ReduceMotion,
  Easing,
} from 'react-native-reanimated';
import BirdMascot from './onboarding/BirdMascot';
import SplashLogo from './splash/SplashLogo';
import SceneVeil from './splash/SceneVeil';
import SplashScene from './splash/SplashScene';
import { resolveSplash } from './splash/patterns';
import { marksOf } from './splash/types';
import type { BirdVariant, SplashAnimationType } from './splash/types';
import type { SplashAnimationSetting } from '../settings/store';
import { clamp01, phase, mix } from './splash/ease';
import { characterExtras, isBlinking } from './splash/character';

/**
 * 再生速度の倍率。1 でパターン既定の尺(2.5〜2.8秒)になる。
 *
 * 退場フェーズが入って素の尺が 2.9〜3.5秒になったため、確認用の引き伸ばしは
 * 1(=等倍)に戻した。ゆっくり見たい時だけ 1.2〜1.4 に上げる。
 *
 * 共有値 elapsed は「パターン上の時刻(0→marks.total)」のまま流し、実時間の
 * duration だけを引き伸ばす。こうするとフェーズも羽ばたきの周期も同じ比率で
 * 遅くなり、演出の中身は一切変わらない。確認が済んだら 1 に戻す。
 */
const TIME_SCALE = 1;

/**
 * モーション低減が ON の時に使う「動きの大きさ」の倍率。
 * 1 = 軽減しない(現状)。演出の見え方を変える変更になるため、実際に下げるかは
 * 各パターンの調整と合わせて別途判断する。
 */
const REDUCED_MOTION_SCALE = 1;

/**
 * 演出見比べ用のループモード(開発ビルドのみ有効)。
 *
 * true にすると fly → sleep → drop → cross → peel → shake を順に繰り返し再生し、ホームへ
 * 進まなくなる。画面をタップすると次のパターンへすぐ切り替わり、左上に今の
 * パターン名が出る。確認が済んだら false に戻すこと。
 */
const DEBUG_LOOP_PATTERNS = false;

/**
 * 確認用の配色固定(開発ビルドのみ)。null なら時間帯から自動。
 * 'day' | 'night' | 'sleep' を入れると端末の時計を変えなくても背景を見比べられる。
 */
const DEBUG_VARIANT: BirdVariant | null = null;

/** ループモードの再生順。 */
const DEBUG_ORDER: SplashAnimationType[] = [
  'fly',
  'sleep',
  'drop',
  'cross',
  'peel',
  'shake',
];

/** シーン色(variant ごと)。BirdMascot のシーン円と同じ値を使う。 */
const SCENE_COLORS: Record<BirdVariant, { solid: string; clear: string }> = {
  day:   { solid: '#BFE6FF', clear: 'rgba(191,230,255,0)' },
  night: { solid: '#1E2A55', clear: 'rgba(30,42,85,0)' },
  sleep: { solid: '#B8B5E8', clear: 'rgba(184,181,232,0)' },
};

/** キャラ登場のフェードイン(ms)。 */
const BIRD_FADE_IN = 120;
/** ロゴのフェードイン(ms)。 */
const LOGO_FADE_IN = 220;

interface Props {
  /** 演出パターン。省略時は setting/時間帯から決める。 */
  animationType?: SplashAnimationType;
  /** ユーザー設定('auto' 以外なら固定)。 */
  setting?: SplashAnimationSetting;
  /**
   * 設定画面からの確認再生か。起動時と同じ見え方を確認するためのもので、
   * 演出そのものは変えない。違いは2点だけ:
   *   - レア抽選をしない('auto' なら**今の時間帯どおり**の演出を見せる)
   *   - タップで途中終了できる(確認を待たされないように)
   */
  isPreview?: boolean;
  /** 配色。省略時はパターンの既定。 */
  variant?: BirdVariant;
  /** フェードアウト完了時に呼ばれる。 */
  onFinish: () => void;
}

export default function SplashAnimationView({
  animationType,
  setting,
  variant,
  isPreview = false,
  onFinish,
}: Props) {
  const { width, height } = useWindowDimensions();

  // 見比べ用: 開発ビルドかつ DEBUG_LOOP_PATTERNS の時だけ、順送りで再生する。
  const debugLoop = __DEV__ && DEBUG_LOOP_PATTERNS;
  const [debugIndex, setDebugIndex] = useState(0);
  const nextDebugPattern = useCallback(() => {
    setDebugIndex(i => (i + 1) % DEBUG_ORDER.length);
  }, []);

  const choice = useMemo(
    () =>
      resolveSplash({
        animationType: debugLoop ? DEBUG_ORDER[debugIndex] : animationType,
        setting,
        variant: variant ?? (debugLoop ? DEBUG_VARIANT ?? undefined : undefined),
        // 確認再生では抽選を挟まず、設定どおり(auto なら時間帯どおり)を見せる。
        rareChance: isPreview ? 0 : undefined,
      }),
    [debugLoop, debugIndex, animationType, setting, variant, isPreview],
  );
  const { pattern } = choice;
  const marks = useMemo(() => marksOf(pattern.phases), [pattern]);

  // キャラは短辺基準。小さい端末でも大きい端末でも同じ見え方にする。
  const birdSize = Math.min(width, height) * 0.45;
  // 動きの大きさの軽減はここで倍率にして各パターンへ渡す。今は軽減なし(=1)。
  // 実際に抑えるときは REDUCED_MOTION_SCALE を下げ、各パターンの移動量・
  // 回転量・バウンス量・羽ばたきの振れ幅に layout.motionScale を掛ける。
  const reducedMotion = useReducedMotion();
  const motionScale = reducedMotion ? REDUCED_MOTION_SCALE : 1;
  const layout = useMemo(
    () => ({ width, height, birdSize, motionScale }),
    [width, height, birdSize, motionScale],
  );
  const scene = SCENE_COLORS[choice.variant];

  // 経過時間(ms)。これ1本ですべての要素を駆動する。
  const elapsed = useSharedValue(0);

  // 目の開閉。閉眼を持つパターン(sleep)だけ true から始め、時間で開く。
  const closeUntil = pattern.eyesClosedUntil?.(marks) ?? null;
  const [eyesClosed, setEyesClosed] = useState(closeUntil !== null);

  // パターンが変わったら閉眼状態を作り直す(ループ再生で sleep を2周目に見る時、
  // 1周目に開いた目のままにならないようにする)。
  useEffect(() => {
    setEyesClosed(closeUntil !== null);
  }, [closeUntil]);

  useEffect(() => {
    elapsed.value = 0;
    elapsed.value = withTiming(
      marks.total,
      {
        duration: marks.total * TIME_SCALE,
        easing: Easing.linear,
        // ここは「動き」ではなく演出全体の時計。ReduceMotion.System にすると
        // モーション低減時に1フレームで終端へ飛び、フェーズ・背景の透明化・
        // ロゴ表示が一切描かれないまま onFinish が走る(＝一瞬で消える)ため、
        // 時間進行そのものは常に流す。
        // 動きの大きさの軽減は motionScale 側で行う(下記参照)。
        reduceMotion: ReduceMotion.Never,
      },
      finished => {
        'worklet';
        if (finished) {
          // ループモードではホームへ進まず、次のパターンを再生する。
          runOnJS(debugLoop ? nextDebugPattern : onFinish)();
        }
      },
    );
    return () => cancelAnimation(elapsed);
  }, [elapsed, marks, onFinish, debugLoop, nextDebugPattern]);

  // 目の開閉を時間から決める。パターンの閉眼(sleep)と共通のまばたきの OR。
  // 描画内容の切り替えなので JS 側の state へ渡す。
  useAnimatedReaction(
    () => {
      const t = elapsed.value;
      const byPattern = closeUntil !== null && t < closeUntil;
      return byPattern || isBlinking(t, marks);
    },
    (closed, prev) => {
      if (prev !== null && closed !== prev) {
        runOnJS(setEyesClosed)(closed);
      }
    },
    [closeUntil, marks],
  );

  // ── 各要素のスタイル ──────────────────────────────────────────────────────
  // 全体: 退場はキャラが画面外へ飛んでいくことで見せるので、フェードは
  // 最後のわずかな区間だけの保険にとどめる(飛び去る前に消えないように)。
  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - phase(elapsed.value, mix(0.85, marks.logoEnd, marks.total), marks.total),
  }));

  // キャラ: 登場のフェード＋パターン固有の transform＋共通のキャラらしさ。
  // 待機・気づき・リアクション・余韻は characterExtras が全パターンに上乗せする。
  const birdStyle = useAnimatedStyle(() => {
    const t = elapsed.value;
    const s = pattern.birdStyle(t, marks, layout);
    const e = characterExtras(t, marks, layout);
    const base = Array.isArray(s.transform) ? s.transform : [];
    // 退場(exit フェーズ)の動きをパターンごとに上乗せする。
    const x = pattern.exitStyle?.(t, marks, layout);
    const exitT = x && Array.isArray(x.transform) ? x.transform : [];
    return {
      ...s,
      opacity: phase(t, 0, BIRD_FADE_IN),
      transform: [
        ...base,
        ...exitT,
        { translateX: e.tx },
        { translateY: e.ty },
        { rotate: `${e.rotate}rad` },
        { scale: e.scale },
      ],
    };
  }, [pattern, marks, layout]);

  // 翼: パターンが wingAngle を持てばそれ、無ければ等速の羽ばたき。
  const wing = useDerivedValue(() => {
    const t = elapsed.value;
    if (pattern.wingAngle) {
      return pattern.wingAngle(t, marks);
    }
    return (
      Math.sin((t / pattern.wing.periodMs) * Math.PI * 2) *
      pattern.wing.amplitudeRad
    );
  }, [pattern, marks]);

  // 背景: 透明化の進捗(0→1)。走らせる時間帯はパターンが指定でき(revealWindow)、
  // 省略時は reveal フェーズそのもの。出方は SceneVeil がパターンから決める。
  const revealWindow = useMemo(
    () =>
      pattern.revealWindow?.(marks) ?? {
        from: marks.actionEnd,
        to: marks.revealEnd,
      },
    [pattern, marks],
  );
  const revealProgress = useDerivedValue(
    () => phase(elapsed.value, revealWindow.from, revealWindow.to),
    [revealWindow],
  );

  // 下地: 透明化が始まった瞬間に消す(以後の形は膜が作る)。
  const baseStyle = useAnimatedStyle(() => ({
    opacity: 1 - clamp01(revealProgress.value * 20),
  }));

  // ロゴの縦位置。既定はキャラの下、パターン指定があればそちら。
  const logoOffset = pattern.logoOffset?.(layout) ?? birdSize * 0.45;

  // ロゴ: ホーム画面が見え始めるのに合わせて出し、演出の終わりで先に引く。
  // ロゴはスプラッシュ層の一部なので、ホーム画面が操作可能になるより前に
  // 消えていないと邪魔になる(exit を待たずに settle→logo で抜く)。
  const logoStyle = useAnimatedStyle(() => {
    const t = elapsed.value;
    const appear = phase(t, revealWindow.from, revealWindow.from + LOGO_FADE_IN);
    const leave = phase(t, marks.settleEnd, marks.logoEnd);
    return {
      opacity: appear * (1 - leave),
      transform: [{ translateY: mix(appear, 10, 0) * (1 - leave) - leave * 8 }],
    };
  }, [marks, revealWindow]);

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      {/* 1) 下地。膜が描かれる前の1フレームでホーム画面が覗かないための保険。
             透明化が始まったら即座に消す(以後は膜が形を作る)。 */}
      <Animated.View
        style={[styles.base, { backgroundColor: scene.solid }, baseStyle]}
        pointerEvents="none"
      />

      {/* 2) シーン色の膜。削れた所から下のホーム画面が見える */}
      <SceneVeil
        spec={pattern.reveal}
        progress={revealProgress}
        colors={scene}
        layout={layout}
      />

      {/* 3) 世界の中身(太陽/月/星/Zzz)。透明化の波が通った要素から消える */}
      <SplashScene
        variant={choice.variant}
        spec={pattern.reveal}
        progress={revealProgress}
        layout={layout}
      />

      {/* 4) キャラ(シーン円なしのキャラ単体) */}
      <Animated.View style={[styles.center, birdStyle]} pointerEvents="none">
        <BirdMascot
          variant={choice.variant}
          size={birdSize}
          wingAngle={wing}
          showScene={false}
          eyesClosed={eyesClosed}
        />
      </Animated.View>

      {/* 5) 文字ロゴ(既定はキャラの下。パターンが logoOffset を持てばその位置) */}
      <Animated.View
        style={[styles.logoLayer, { transform: [{ translateY: logoOffset }] }]}
        pointerEvents="none">
        <SplashLogo style={logoStyle} />
      </Animated.View>

      {/* 確認再生: タップで途中終了できるようにする。 */}
      {isPreview && !debugLoop && (
        <Pressable style={StyleSheet.absoluteFill} onPress={onFinish} />
      )}

      {/* 見比べ用オーバーレイ(開発ビルドのみ)。タップで次のパターンへ。 */}
      {debugLoop && (
        <Pressable style={StyleSheet.absoluteFill} onPress={nextDebugPattern}>
          <Text style={styles.debugLabel} allowFontScaling={false}>
            {`${debugIndex + 1}/${DEBUG_ORDER.length}  ${choice.animationType}  (tap: next)`}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
  },
  base: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugLabel: {
    marginTop: 64,
    marginLeft: 20,
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});
