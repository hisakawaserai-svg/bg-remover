/**
 * RemoveBgScreen.tsx — 「背景を消す」画面
 *
 * 背景を消した直後に挟む画面。目的は2つ:
 *   1. 背景が消えたことを伝える。市松模様＝透明だと分からない人（祖父母世代の実機報告）
 *      向けに、見出しと説明を出し、元の画像と見比べられるようにする。
 *   2. うまく消えていなかったときに直す。スポイト・強さ（自動除去の強さ）・消し方は
 *      すべてこの画面に集め、分割設定画面は分割だけを行う画面にした。
 *
 * 画像編集は「元画像 + 操作列」を呼び出し側（App）が持ち、この画面は操作を通知するだけ
 * （SetupScreen / PolygonEditor と同じ作り）。bgVersion は作り直しの通知
 * （rgba は同一参照のまま中身が変わるため）。
 *
 * レイアウトは Claude Design の 6a（docs/design/export/6a.html）に合わせている。
 * デザインからの変更: 元の画像は「押している間」ではなくトグルで切り替える。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import CheckerboardBg from './ui/CheckerboardBg';
import LoadingView from './ui/LoadingView';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ToleranceSlider, { REMOVAL_SNAPS, REMOVAL_EDGE_ICONS, EDGE_LABEL_STYLE } from './ui/ToleranceSlider';
import { colors, radius, shadow, spacing } from './ui/theme';
import { useT } from '../i18n';
import { useSettings } from '../settings/SettingsContext';
import { useThumbBg } from '../hooks/useThumbBg';
import { useVisionSupported } from '../hooks/useVisionSupported';
import { isTransparentAt } from '../imaging';
import type { RemoveBgResult } from '../imaging';
import { DEFAULTS } from '../settings/store';
import type { BgEngine, ThumbBg } from '../settings/store';

/**
 * 道具を開閉するときの動き。見出し・ボタンの出入りと画像の伸び縮みを同じ曲線でそろえる
 * （デザインの cubic-bezier(0.32,0.72,0,1) / 420ms に合わせた）。
 * 【注意】LayoutAnimation も Reanimated の entering/exiting/layout も、この環境
 * （RN 0.86 新アーキテクチャ + Reanimated 4.5）では効かなかった。entering は途中で止まり、
 * 中身が透明のまま残る。そのため、測った高さと透明度を withTiming で自前で動かしている。
 */
// reduceMotion: Never — 端末の「視差効果を減らす」がオンでも動かす。Reanimated の既定（System）
// だと一瞬で切り替わり、何が開いて何が隠れたのか分からなくなる（実機で確認）。
// ゆっくり伸び縮みするだけで、酔いやすい大きな移動はしないので常に出す。
const OPEN_TIMING = { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1), reduceMotion: ReduceMotion.Never };
/** 元の画像 ⇔ 消した後の切り替え。上と同じ理由で常に動かす。 */
const TOGGLE_TIMING = { duration: 200, reduceMotion: ReduceMotion.Never };

/**
 * 高さを 0 ⇔ 中身の高さ で開閉する入れ物。中身の高さは onLayout で測る。
 * progress: 1=開いている、0=閉じている。
 *
 * 中身は絶対配置にして、入れ物の高さに左右されないようにしている。普通に置くと、
 * 入れ物を高さ 0 に縮めたときに中身まで 0 と測り直されることがあり、次に開くときも
 * 「高さ 0 まで伸ばす」ことになって、二度と出てこなくなった（実機で確認）。
 * 念のため 0 と測られた値も無視する。
 */
function Collapsible({ progress, children, style }: {
  progress: SharedValue<number>;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const h = useSharedValue(-1);
  const anim = useAnimatedStyle(() => {
    // 測る前は高さ 0 で待つ（中身は絶対配置なので、高さ 0 でも本来の高さで測れる）。
    if (h.value < 0) return { height: 0, opacity: 0 };
    return {
      height: h.value * progress.value,
      opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0, 1]),
    };
  });
  return (
    <Animated.View style={[styles.collapse, anim]}>
      <View
        style={[styles.collapseInner, style]}
        onLayout={e => {
          const height = e.nativeEvent.layout.height;
          if (height > 0) h.value = height;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** 下地の切り替えアイコン。分割結果・プレビュー・範囲を調整と同じ対応。 */
const BG_ICONS: Record<ThumbBg, string> = {
  checker: 'grid-on',
  white: 'wb-sunny',
  black: 'brightness-2',
  gray: 'grid-on',
};
const BG_MODES = ['checker', 'white', 'black'] as const;

/**
 * 色ベースで消した背景の色（最大2色）を小さな四角で見せる。
 * 1色ならその色で塗り、2色なら対角線で区切って左上・右下に塗り分ける。
 * 色が分からない（求められなかった）ときは、元の画像を表す薄い空色にする。
 */
function BgColorSwatch({ colors: cs, size }: { colors: { r: number; g: number; b: number }[]; size: number }) {
  const css = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;
  if (cs.length === 0) return <View style={[StyleSheet.absoluteFill, styles.statusSwatchBefore]} />;
  if (cs.length === 1) return <View style={[StyleSheet.absoluteFill, { backgroundColor: css(cs[0]) }]} />;
  // 幅・高さ 0 の View に上と右の太い枠を付けると、左下→右上の対角線で2色の三角に分かれる。
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.swatchTriangle, {
        borderTopWidth: size, borderRightWidth: size,
        borderTopColor: css(cs[0]), borderRightColor: css(cs[1]),
      }]} />
      {/* 区切り線。2色が似ていても境目が分かるよう、白い細線を対角線に重ねる。 */}
      <View style={[styles.swatchDivider, { width: size * Math.SQRT2, top: size / 2, left: -(size * Math.SQRT2 - size) / 2 }]} />
    </View>
  );
}

/** スポイトのタップ波紋の半径(px)。分割設定・範囲を調整と同じ値。 */
const EYE_RIPPLE_R = 26;

type ToolTab = 'eye' | 'strength' | 'method';

interface Props {
  bgResult: RemoveBgResult;
  bgVersion: number;
  /** 背景を消す前の画像。トグルで見比べる。 */
  originalImageUri?: string;
  /**
   * 自動で背景を消したか。「透過せずに編集」（すでに透明な画像）を選んだときは false で、
   * そのときは「背景を消しました」の見出しを出さない。
   */
  removed: boolean;
  /** 処理直後だけ true。元の画像から背景が消えていくアニメーションを1回見せる。 */
  playIntro: boolean;
  onIntroPlayed: () => void;
  /** 色ベースで背景とみなした色（最大2色）。「元の画像」表示中に左の四角で見せる。 */
  bgColors: { r: number; g: number; b: number }[];
  /** 自動で背景を消したときの方式と強さ。消していなければ null。 */
  engine: BgEngine | null;
  tolerance: number | null;
  onEyedrop: (x: number, y: number, tolerance: number, feather: boolean) => void;
  onUndoEdit: () => void;
  onRedoEdit: () => void;
  onResetEdits: () => void;
  canUndoEdit: boolean;
  canRedoEdit: boolean;
  /** 強さを変えて消し直す（スポイトで消した分は残す）。 */
  onChangeTolerance: (tolerance: number) => void;
  /** 消し方を変えて最初から消し直す。確認は呼び出し側で出す。 */
  onChangeEngine: (engine: BgEngine) => void;
  onNext: () => void;
  onBack: () => void;
  onHelp?: () => void;
  onSettings?: () => void;
}

export default function RemoveBgScreen({
  bgResult, bgVersion, originalImageUri, removed, playIntro, onIntroPlayed, bgColors,
  engine, tolerance, onEyedrop, onUndoEdit, onRedoEdit, onResetEdits, canUndoEdit, canRedoEdit,
  onChangeTolerance, onChangeEngine, onNext, onBack, onHelp, onSettings,
}: Props) {
  const { t } = useT();
  const { settings } = useSettings();
  // 下地はこの画面の中だけで切り替える（分割結果画面と同じ。設定は書き換えない）。
  const defaultBg = useThumbBg();
  const [bgMode, setBgMode] = useState<ThumbBg>(defaultBg);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const visionSupported = useVisionSupported();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ToolTab>('eye');
  const [eyeOn, setEyeOn] = useState(false);
  const [showBefore, setShowBefore] = useState(false);

  // 消し方タブは被写体検出が使える端末だけ。判定中(null)も出さない（出してから消えるとちらつく）。
  const canSwitchEngine = visionSupported === true && engine != null;
  const activeTab: ToolTab = tab === 'method' && !canSwitchEngine ? 'eye' : tab;
  // 被写体検出では強さは結果に影響しない（Vision の結果で rgba を丸ごと置き換えるため）。
  const strengthUsable = engine === 'flood' && tolerance != null;

  // 道具の開き具合（1=開いている）。見出し・ボタン・道具の欄は、これに合わせて伸び縮みする。
  // 画像はその残りの場所いっぱい（flex:1）なので、つられて大きさが変わる。
  const openP = useSharedValue(0);
  const closedP = useDerivedValue(() => 1 - openP.value);
  const setOpenAnimated = useCallback((next: boolean) => {
    setOpen(next);
    openP.value = withTiming(next ? 1 : 0, OPEN_TIMING);
    if (!next) setEyeOn(false);
  }, [openP]);

  // ── 元の画像 ⇔ 消した後 ──────────────────────────────────────────────────
  const beforeOpacity = useSharedValue(playIntro ? 1 : 0);
  const beforeStyle = useAnimatedStyle(() => ({ opacity: beforeOpacity.value }));
  // 処理直後だけ、元の画像を1秒見せてから背景が消えた画像へゆっくり切り替える。
  // 何が起きたかを、説明を読まなくても目で分かるようにするため。
  // 始めるのは元の画像を読み込み終えてから。元の画像は大きく読み込みに時間がかかるので、
  // マウント時に始めると、表示される前にアニメーションが終わってしまっていた。
  const introStartedRef = useRef(!playIntro);
  const startIntro = useCallback(() => {
    if (introStartedRef.current) return;
    introStartedRef.current = true;
    beforeOpacity.value = withDelay(1000, withTiming(0, {
      duration: 1400,
      easing: Easing.inOut(Easing.quad),
      // OS の「視差効果を減らす」でも切り替え自体は必要。ゆっくり動くだけなので出す。
      reduceMotion: ReduceMotion.Never,
    }, undefined), ReduceMotion.Never);
    onIntroPlayed();
  }, [beforeOpacity, onIntroPlayed]);
  // 元の画像が無いときは見せるものが無いので、すぐ消した後の表示にする。
  useEffect(() => {
    if (playIntro && !originalImageUri) {
      introStartedRef.current = true;
      beforeOpacity.value = 0;
      onIntroPlayed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleBefore = useCallback(() => {
    setShowBefore(v => {
      const next = !v;
      beforeOpacity.value = withTiming(next ? 1 : 0, TOGGLE_TIMING);
      return next;
    });
  }, [beforeOpacity]);
  /** スポイトは消した後の画像に対して使うので、オンにしたら元の画像の表示はやめる。 */
  const toggleEye = useCallback(() => {
    setEyeOn(v => {
      if (!v && showBefore) {
        setShowBefore(false);
        beforeOpacity.value = withTiming(0, TOGGLE_TIMING);
      }
      return !v;
    });
  }, [showBefore, beforeOpacity]);

  // bgResult.rgba → base64 PNG URI（作り直しの通知 bgVersion が来たときだけ変換する）
  const afterUri = useMemo(() => {
    const data = Skia.Data.fromBytes(bgResult.rgba);
    const img = Skia.Image.MakeImage(
      {
        width: bgResult.width,
        height: bgResult.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      data,
      bgResult.width * 4,
    );
    if (!img) return null;
    const b64 = img.encodeToBase64();
    img.dispose();
    return `data:image/png;base64,${b64}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgResult, bgVersion]);

  // ── 画像の表示枠: 置き場所いっぱいに、画像の縦横比のまま収める ──────────────
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const handleAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  }, []);
  const fit = useMemo(() => {
    if (!area) return null;
    const scale = Math.min(area.width / bgResult.width, area.height / bgResult.height);
    return { scale, width: bgResult.width * scale, height: bgResult.height * scale };
  }, [area, bgResult.width, bgResult.height]);

  // ── スポイト ──────────────────────────────────────────────────────────────
  // 押してから画像が変わるまで間があるので、タップ位置に波紋を出して即座に反応を返す。
  // 波紋を描いてから2フレーム待って実処理を呼ぶ（同じフレームだと重い再計算が先に走り、
  // 波紋が見えないまま固まる。分割設定画面と同じ理由）。
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const rippleV = useSharedValue(0);
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 1 - rippleV.value,
    transform: [{ scale: 0.25 + rippleV.value * 1.5 }],
  }));
  // 1回の再計算は重いので、反映が終わるまで次のタップは捨てる（積むと固まり続ける）。
  const eyeBusyRef = useRef(false);
  const handleImagePress = useCallback((lx: number, ly: number) => {
    if (!eyeOn || !fit || eyeBusyRef.current) return;
    const x = lx / fit.scale;
    const y = ly / fit.scale;
    const { width: w, height: h, rgba } = bgResult;
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    // 透明な場所は押しても見た目が変わらない（空振り）ので何もしない。
    if (isTransparentAt(rgba, w, h, x, y)) return;
    eyeBusyRef.current = true;
    setRipple({ x: lx, y: ly });
    rippleV.value = 0;
    rippleV.value = withTiming(1, {
      duration: 420,
      easing: Easing.out(Easing.quad),
      reduceMotion: ReduceMotion.Never,
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        onEyedrop(x, y, settings.eyedropperTolerance, settings.featherEdges);
      } finally {
        // 例外が出ても必ず解除する（漏らすと以後スポイトが効かなくなる）。
        eyeBusyRef.current = false;
      }
    }));
  }, [eyeOn, fit, bgResult, onEyedrop, settings.eyedropperTolerance, settings.featherEdges, rippleV]);

  /** スポイトで消した分を全部戻す。取り消せないので確認する（分割設定画面と同じ文言）。 */
  const handleReset = useCallback(() => {
    Alert.alert(
      t('setup.resetTitle'),
      t('setup.resetMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.reset'), style: 'destructive', onPress: onResetEdits },
      ],
    );
  }, [t, onResetEdits]);

  // ── 強さ: 設定画面の「自動除去の強さ」と同じスライダー ──────────
  // 動かしている間は表示だけ変え、指を離したときだけ消し直す（消し直しは全画素の再計算で重い）。
  const [strengthValue, setStrengthValue] = useState(tolerance ?? settings.tolerance);
  useEffect(() => {
    if (tolerance != null) setStrengthValue(tolerance);
  }, [tolerance]);
  // 消し直しは全画素の再計算で、その間 JS が止まる。先に半透明のローディングを描いてから
  // （2フレーム待ってから）消し直す。待たずに呼ぶとローディングが描かれる前に固まる。
  const [reprocessing, setReprocessing] = useState(false);
  const commitStrength = useCallback((v: number) => {
    setStrengthValue(v);
    if (tolerance == null || v === tolerance) return;
    setReprocessing(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        onChangeTolerance(v);
      } finally {
        setReprocessing(false);
      }
    }));
  }, [tolerance, onChangeTolerance]);

  const header = (
    <AppHeader
      title={t('removeBg.title')}
      onBack={onBack}
      backLabel={t('common.back')}
      right={
        <HeaderActions
          showOriginal={false}
          showHelp={!!onHelp}
          showSettings={!!onSettings}
          onHelp={onHelp}
          onSettings={onSettings}
        />
      }
    />
  );

  const footer = (
    <Collapsible progress={closedP} style={styles.footer}>
      <AnimatedPressable style={styles.nextBtn} onPress={onNext} pressedScale={0.97} disabled={open}>
        <Text style={styles.nextTxt}>{t('removeBg.next')}</Text>
        <Icon name="chevron-right" size={22} color="#FFF" />
      </AnimatedPressable>
    </Collapsible>
  );

  const tabDefs: { key: ToolTab; label: string }[] = [
    { key: 'eye', label: t('removeBg.tabEye') },
    { key: 'strength', label: t('removeBg.tabStrength') },
    ...(canSwitchEngine ? [{ key: 'method' as const, label: t('removeBg.tabMethod') }] : []),
  ];

  return (
    <View style={styles.root}>
    {/* 小さい画面で道具を開いても全部に手が届くよう、全体をスクロールできるようにする。
        収まるときは flexGrow で画面いっぱいに広げ、画像が残りの場所を使う。 */}
    <Screen header={header} footer={footer} style={[styles.body, open && styles.bodyOpen]}>
      {/* 見出しと説明。道具を開いたら隠して、画像を大きく使う。 */}
      <Collapsible progress={closedP} style={styles.headline}>
          {removed && (
            <View style={styles.headlineRow}>
              <Icon name="check-circle" size={30} color={colors.accent} />
              <Text style={styles.headlineTxt}>{t('removeBg.headline')}</Text>
            </View>
          )}
          <View style={styles.explainRow}>
            <View style={styles.explainSwatch}>
              <CheckerboardBg mode="checker" tile={8} width={32} height={32} />
            </View>
            <Text style={styles.explainTxt}>{t('removeBg.explain')}</Text>
          </View>
      </Collapsible>

      {/* 今どちらを見ているか ＋ 元の画像トグル。スポイト中は案内の帯に置き換える。 */}
      {eyeOn ? (
        <View style={styles.eyeBanner}>
          <Icon name="touch-app" size={22} color="#FFF" />
          <Text style={styles.eyeBannerTxt}>{t('removeBg.eyeBanner')}</Text>
          <AnimatedPressable style={styles.eyeStop} onPress={() => setEyeOn(false)} pressedScale={0.95}>
            <Text style={styles.eyeStopTxt}>{t('removeBg.stop')}</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            <View style={styles.statusSwatch}>
              {showBefore
                ? <BgColorSwatch colors={bgColors} size={24} />
                : <CheckerboardBg mode="checker" tile={6} width={24} height={24} />}
            </View>
            <Text style={[styles.statusTxt, !showBefore && styles.statusTxtAfter]}>
              {showBefore ? t('removeBg.before') : t('removeBg.after')}
            </Text>
          </View>
          {originalImageUri ? (
            <AnimatedPressable
              style={[styles.beforeBtn, showBefore && styles.beforeBtnOn]}
              onPress={toggleBefore}
              pressedScale={0.96}
            >
              <Icon name={showBefore ? 'visibility-off' : 'visibility'} size={20} color={showBefore ? '#FFF' : colors.label} />
              <Text style={[styles.beforeBtnTxt, showBefore && styles.beforeBtnTxtOn]}>
                {showBefore ? t('removeBg.showAfter') : t('removeBg.showBefore')}
              </Text>
            </AnimatedPressable>
          ) : null}
          {/* 下地の切り替え。画像には重ねない（実機の判断）。選択肢はボタンの左に開く。 */}
          <View style={styles.bgToggleWrap}>
            <AnimatedPressable
              style={[styles.bgToggleBtn, bgPickerOpen && styles.bgToggleBtnOn]}
              onPress={() => setBgPickerOpen(o => !o)}
              pressedScale={0.9}
              accessibilityLabel={t('removeBg.bgToggle')}
            >
              <Icon name={BG_ICONS[bgMode]} size={22} color="#FFF" />
            </AnimatedPressable>
            {bgPickerOpen && (
              <View style={styles.bgToggleRow}>
                {BG_MODES.map(m => (
                  <AnimatedPressable
                    key={m}
                    style={[styles.bgToggleDot, bgMode === m && styles.bgToggleDotOn]}
                    onPress={() => { setBgMode(m); setBgPickerOpen(false); }}
                    pressedScale={0.9}
                  >
                    <Icon name={BG_ICONS[m]} size={20} color="#FFF" />
                  </AnimatedPressable>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* 画像。置き場所いっぱいに縦横比のまま収め、スポイトのタップ座標はこの枠基準で読む。 */}
      <View style={styles.imageArea} onLayout={handleAreaLayout}>
        {fit && (
          <Pressable
            style={[
              styles.imageBox,
              { width: fit.width, height: fit.height },
              eyeOn && styles.imageBoxEye,
            ]}
            disabled={!eyeOn}
            onPress={e => handleImagePress(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          >
            <View style={[StyleSheet.absoluteFill, styles.imageClip]}>
              <CheckerboardBg mode={bgMode} tile={20} width={fit.width} height={fit.height} />
              {afterUri && (
                <Image source={{ uri: afterUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              )}
              {originalImageUri && (
                <Animated.Image
                  source={{ uri: originalImageUri }}
                  style={[StyleSheet.absoluteFill, beforeStyle]}
                  resizeMode="contain"
                  onLoad={startIntro}
                />
              )}
            </View>
            {ripple && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ripple,
                  { left: ripple.x - EYE_RIPPLE_R, top: ripple.y - EYE_RIPPLE_R },
                  rippleStyle,
                ]}
              />
            )}
          </Pressable>
        )}
      </View>

      {/* 「うまく消えていないときは」。閉じているときは1行、開いたら道具を出す。 */}
      <View style={styles.card}>
          <Collapsible progress={closedP}>
          <AnimatedPressable style={styles.disclosure} onPress={() => setOpenAnimated(true)} pressedScale={0.98} disabled={open}>
            <Icon name="tune" size={24} color={colors.accent} />
            <Text style={styles.disclosureTxt}>{t('removeBg.disclosure')}</Text>
            <Icon name="expand-more" size={26} color={colors.secondary} />
          </AnimatedPressable>
          </Collapsible>
          <Collapsible progress={openP} style={styles.tools}>
            <View style={styles.tabRow}>
              <View style={styles.tabs}>
                {tabDefs.map(d => {
                  const on = d.key === activeTab;
                  return (
                    <Pressable
                      key={d.key}
                      style={[styles.tab, on && styles.tabOn]}
                      onPress={() => setTab(d.key)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.tabTxt, on && styles.tabTxtOn]} numberOfLines={2}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={styles.doneBtn} onPress={() => setOpenAnimated(false)}>
                <Text style={styles.doneTxt}>{t('common.done')}</Text>
              </Pressable>
            </View>

            <View style={styles.panel}>
              {activeTab === 'eye' && (
                <View style={styles.panelCol}>
                  <AnimatedPressable
                    style={[styles.eyeBtn, eyeOn && styles.eyeBtnOn]}
                    onPress={toggleEye}
                    pressedScale={0.98}
                  >
                    <Icon name="colorize" size={22} color={eyeOn ? '#FFF' : colors.label} />
                    <Text style={[styles.eyeBtnTxt, eyeOn && styles.eyeBtnTxtOn]}>
                      {eyeOn ? t('removeBg.eyeOn') : t('removeBg.eyeOff')}
                    </Text>
                  </AnimatedPressable>
                  <View style={styles.editRow}>
                    <EditButton icon="undo" label={t('removeBg.undo')} enabled={canUndoEdit} onPress={onUndoEdit} />
                    <EditButton icon="redo" label={t('removeBg.redo')} enabled={canRedoEdit} onPress={onRedoEdit} />
                    <EditButton icon="refresh" label={t('removeBg.reset')} enabled={canUndoEdit} onPress={handleReset} />
                  </View>
                </View>
              )}

              {activeTab === 'strength' && (
                <View style={[styles.panelCol, !strengthUsable && styles.dimmed]}>
                  {/* 見出し・数値・説明文は設定画面の「自動除去の強さ」とそろえる（同じ値を扱うため）。 */}
                  <View style={styles.strengthHead}>
                    <Text style={styles.strengthTitle}>{t('settings.autoTolerance')}</Text>
                    <Text style={styles.strengthValue}>
                      {Math.round(strengthValue)}
                      {Math.round(strengthValue) === DEFAULTS.tolerance && (
                        <Text style={styles.strengthDefaultTag}>  {t('common.default')}</Text>
                      )}
                    </Text>
                  </View>
                  {/* 被写体検出のときは強さが結果に影響しないので触れなくする */}
                  <View pointerEvents={strengthUsable ? 'auto' : 'none'}>
                    <ToleranceSlider
                      bare
                      showLabel={false}
                      edgeLabels
                      edgeIcons={REMOVAL_EDGE_ICONS}
                      labelStyle={EDGE_LABEL_STYLE}
                      snaps={REMOVAL_SNAPS}
                      value={strengthValue}
                      defaultValue={DEFAULTS.tolerance}
                      onChange={setStrengthValue}
                      onComplete={commitStrength}
                    />
                  </View>
                  <Text style={styles.note}>
                    {strengthUsable ? t('settings.autoToleranceHint') : t('removeBg.strengthOff')}
                  </Text>
                </View>
              )}

              {activeTab === 'method' && (
                <View style={styles.panelCol}>
                  <View style={styles.seg}>
                    <SegButton label={t('removeBg.byColor')} on={engine === 'flood'}
                      onPress={() => engine !== 'flood' && onChangeEngine('flood')} />
                    <SegButton icon="auto-awesome" label={t('removeBg.bySubject')} on={engine === 'vision'}
                      onPress={() => engine !== 'vision' && onChangeEngine('vision')} />
                  </View>
                  <Text style={styles.note}>{t('removeBg.methodNote')}</Text>
                </View>
              )}
            </View>
          </Collapsible>
      </View>
    </Screen>
    {reprocessing && <LoadingView overlay message={t('removeBg.reprocessing')} />}
    </View>
  );
}

function EditButton({ icon, label, enabled, onPress }: { icon: string; label: string; enabled: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable
      style={[styles.editBtn, !enabled && styles.dimmed]}
      disabled={!enabled}
      onPress={onPress}
      pressedScale={0.95}
    >
      <Icon name={icon} size={22} color={colors.label} />
      <Text style={styles.editBtnTxt} numberOfLines={2}>{label}</Text>
    </AnimatedPressable>
  );
}

function SegButton({ icon, label, on, onPress }: { icon?: string; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segBtn, on && styles.segBtnOn]} onPress={onPress} accessibilityState={{ selected: on }}>
      {icon && <Icon name={icon} size={18} color={on ? colors.label : colors.label2} />}
      <Text style={[styles.segTxt, on && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  bodyOpen: { paddingTop: spacing.md },
  collapse: { overflow: 'hidden' },
  collapseInner: { position: 'absolute', top: 0, left: 0, right: 0 },

  // ── 見出し ─────────────────────────────────────────────────────────────────
  // 下の余白は margin ではなく padding で取る（Collapsible が測る高さに含めるため）。
  headline: { gap: spacing.sm, paddingHorizontal: spacing.xs, paddingBottom: spacing.lg },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headlineTxt: { flexShrink: 1, fontSize: 26, fontWeight: '700', lineHeight: 32, color: colors.label },
  explainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  explainSwatch: {
    width: 32, height: 32, borderRadius: radius.sm, overflow: 'hidden', marginTop: 2,
    borderWidth: 1, borderColor: colors.separator,
  },
  explainTxt: { flex: 1, fontSize: 17, lineHeight: 25, color: colors.label2 },

  // ── 表示中ラベル ＋ 元の画像トグル ─────────────────────────────────────────
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, marginBottom: spacing.sm, zIndex: 10 },
  statusLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  statusSwatch: {
    width: 24, height: 24, borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.separator,
  },
  // 元の画像側の印。市松ではない「普通の背景」を表す薄い空色（デザインと同じ色）。
  statusSwatchBefore: { backgroundColor: '#CFE8F7' },
  swatchTriangle: { width: 0, height: 0 },
  swatchDivider: {
    position: 'absolute', height: 1.5, backgroundColor: '#FFF',
    transform: [{ rotate: '-45deg' }],
  },
  bgToggleWrap: { position: 'relative', zIndex: 10 },
  bgToggleBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(30,30,30,0.80)',
  },
  bgToggleBtnOn: { backgroundColor: colors.accent },
  bgToggleRow: {
    position: 'absolute', top: 0, right: '100%', marginRight: 6,
    flexDirection: 'row', gap: 4, padding: 4,
    borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.80)',
  },
  bgToggleDot: {
    width: 44, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bgToggleDotOn: { backgroundColor: colors.accent },
  statusTxt: { fontSize: 17, fontWeight: '700', color: colors.label },
  statusTxtAfter: { color: colors.accent },
  beforeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '62%',
    minHeight: 44, paddingVertical: 6, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.fill,
  },
  beforeBtnOn: { backgroundColor: colors.accent },
  beforeBtnTxt: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.label },
  beforeBtnTxtOn: { color: '#FFF' },

  // ── スポイト中の案内帯 ─────────────────────────────────────────────────────
  eyeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, marginBottom: spacing.sm,
    paddingVertical: spacing.xs, paddingRight: spacing.xs, paddingLeft: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  eyeBannerTxt: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 20, color: '#FFF' },
  eyeStop: {
    minHeight: 40, paddingHorizontal: 14, justifyContent: 'center',
    borderRadius: 10, backgroundColor: '#FFF',
  },
  eyeStopTxt: { fontSize: 15, fontWeight: '600', color: colors.accent },

  // ── 画像 ───────────────────────────────────────────────────────────────────
  // 小さい画面ではこれより縮めず、代わりに画面全体をスクロールさせる。
  imageArea: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  imageBox: { borderRadius: radius.md },
  imageClip: { borderRadius: radius.md, overflow: 'hidden' },
  // スポイト中は青枠で「この画像をタップする」と示す（outline-offset 相当の少し外側に出す）。
  imageBoxEye: {
    borderWidth: 3, borderColor: colors.accent, margin: -3,
  },
  ripple: {
    position: 'absolute',
    width: EYE_RIPPLE_R * 2, height: EYE_RIPPLE_R * 2, borderRadius: EYE_RIPPLE_R,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(255,255,255,0.25)',
  },

  // ── 道具のカード ───────────────────────────────────────────────────────────
  card: {
    marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden',
    ...shadow.sm,
  },
  disclosure: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  disclosureTxt: { flex: 1, fontSize: 17, color: colors.label },
  tools: { padding: spacing.sm, gap: spacing.sm },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tabs: {
    flex: 1, flexDirection: 'row', gap: 3, padding: 3, minWidth: 0,
    borderRadius: radius.md, backgroundColor: colors.fill,
  },
  tab: {
    flex: 1, minWidth: 0, minHeight: 44, padding: spacing.xs,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  tabOn: { backgroundColor: colors.card, ...shadow.xs },
  tabTxt: { fontSize: 15, lineHeight: 18, textAlign: 'center', color: colors.label2 },
  tabTxtOn: { fontWeight: '600', color: colors.label },
  doneBtn: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  doneTxt: { fontSize: 17, fontWeight: '600', color: colors.accent },
  panel: { minHeight: 136, paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  panelCol: { gap: spacing.sm },
  dimmed: { opacity: 0.45 },

  eyeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 52, paddingVertical: 10, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, backgroundColor: colors.fill,
  },
  eyeBtnOn: { backgroundColor: colors.accent },
  eyeBtnTxt: { fontSize: 17, fontWeight: '600', textAlign: 'center', color: colors.label },
  eyeBtnTxtOn: { color: '#FFF' },
  editRow: { flexDirection: 'row', gap: spacing.sm },
  editBtn: {
    flex: 1, minHeight: 56, paddingVertical: 6, paddingHorizontal: spacing.xs, gap: 2,
    borderRadius: radius.md, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
  },
  editBtnTxt: { fontSize: 15, lineHeight: 18, textAlign: 'center', color: colors.label },

  strengthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  strengthTitle: { flexShrink: 1, fontSize: 17, fontWeight: '600', color: colors.label },
  // 設定画面の rowValue / rowValueDefaultTag と同じ見た目。
  strengthValue: { fontSize: 22, fontWeight: '600', color: colors.accent, minWidth: 36, textAlign: 'right' },
  strengthDefaultTag: { fontSize: 12, fontWeight: '600', color: colors.secondary },
  note: { fontSize: 15, lineHeight: 22, color: colors.secondary },

  seg: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: radius.md, backgroundColor: colors.fill },
  segBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 44, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: 10,
  },
  segBtnOn: { backgroundColor: colors.card, ...shadow.xs },
  segTxt: { fontSize: 17, lineHeight: 21, textAlign: 'center', color: colors.label2 },
  segTxtOn: { fontWeight: '600', color: colors.label },

  // ── 分割へ進む ─────────────────────────────────────────────────────────────
  footer: {
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.bg,
  },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 52, paddingVertical: 14, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  nextTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },
});
