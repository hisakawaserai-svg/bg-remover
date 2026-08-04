/**
 * shared.ts — オンボーディング全ステップ共通の定数 & タイムライン用ワークレット
 *
 * レイアウト(フレーム/キャラサイズ/キャプション枠)を1か所に集約し、
 * 全ステップが同じ値を使う(= ステップ1基準で統一)。
 * アニメ用の小ワークレット(間・ジャンプ・フェード)もここに集約する。
 *
 * 白化回避方針: 各ステップは transform/opacity のみで動かす。
 */
import { Dimensions, StyleSheet } from 'react-native';

// ── レイアウト定数(single source) ───────────────────────────────────────────
/** ナビゲーターキャラ(吹き出しの話し手)の大きさ。空いた側を埋めるよう大きめに。 */
export const NAV_MASCOT = 88;
/** キャプション(キャラ＋吹き出し)スロットの高さ。キャラ＋吹き出しで側を埋める。 */
export const CAPTION_SLOT_H = 128;

// フレーム幅は画面基準で固定する(flex で高さを奪われて幅が痩せるのを断つ)。
// 高さは frame の aspectRatio から導出する(= スマホ比率を維持)。
const SCREEN_W = Dimensions.get('window').width;
/** フレーム左右マージン */
export const FRAME_MARGIN = 24;
/** フレーム幅(固定px) = 画面幅 − 左右マージン */
export const FRAME_W = SCREEN_W - FRAME_MARGIN * 2;
/** フレームのスライド量(px)。上下対称に動かし、寄せた側と反対に1帯(=CAPTION_SLOT_H)空ける。
 *  既定で上下に半帯ぶん余白を取り、±この量スライドして片側を満タン(128)に開ける。 */
export const FRAME_SLIDE = CAPTION_SLOT_H / 2;

// ブランド配色(吹き出し=案B)
export const COLORS = {
  brandBlue: '#1E6FF0',
  blue:      '#007AFF',
  bubbleText:'#FFFFFF',
  frameBg:   '#F2F2F7',
  cardBg:    '#FFFFFF',
  border:    '#E3E3E8',
  ink:       '#000000',
  secondary: '#8E8E93',
} as const;

// ── 共通スタイル断片(フレーム=画面再現カード) ───────────────────────────────
export const shared = StyleSheet.create({
  // フレームを上詰めで置く器。キャプションは overlay なので flow の子はフレームだけ。
  root: {
    flex: 1,
    alignItems: 'center',
  },
  // キャプション枠(overlay)。フレームの箱から高さを奪わないよう position:absolute で
  // フレームの上/下の空き領域に重ねる。中身(キャラ＋吹き出し)は中央寄せ。
  captionTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CAPTION_SLOT_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CAPTION_SLOT_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 実画面の枠(全ステップ共通)。幅は固定px(=幅が痩せない)。
  // 高さは flex:1。上下に半帯ぶん(CAPTION_SLOT_H/2)の余白を取り、各ステップが
  // translateY で ±FRAME_SLIDE スライドして、キャラの出る側と反対へ寄せる(上下対称)。
  // width が固定px なので flex で高さを取っても幅は痩せない(aspectRatio も使わない)。
  frame: {
    width: FRAME_W,
    flex: 1,
    marginVertical: CAPTION_SLOT_H / 2,
    backgroundColor: COLORS.frameBg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
});

// ── ワークレットユーティリティ ────────────────────────────────────────────────
export function norm(p: number, a: number, b: number) {
  'worklet';
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}
export function easeIO(t: number) {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// 表示窓 [start,end] のフェード付き opacity。窓外は 0(=無音/非表示)。
// fade は立ち上がり/立ち下がりに使う進行量。
export function fadeHold(p: number, start: number, end: number, fade: number) {
  'worklet';
  if (p <= start || p >= end) return 0;
  if (p < start + fade) return norm(p, start, start + fade);
  if (p > end - fade)   return 1 - norm(p, end - fade, end);
  return 1;
}

/** 吹き出しの立ち上がり/立ち下がり進行量 */
export const SPEAK_FADE = 0.02;

/** キャラの「ピョン」: start から JUMP_DUR かけて上→下に1バウンス(translateY) */
export const JUMP_DUR = 0.028;
export const JUMP_H = 7;
export function jumpY(p: number, start: number) {
  'worklet';
  const t = norm(p, start, start + JUMP_DUR);
  if (t <= 0 || t >= 1) return 0;
  return -Math.sin(t * Math.PI) * JUMP_H;
}

/**
 * 「この線は指でドラッグできる」を示す小刻みな左右(上下)ゆれ。
 * 窓[start,end]の外は0、窓の頭と尻尾は sin envelope で滑らかに0へ収める
 * (段差なし)。cycles は窓内で何往復するか。
 */
export function wiggle(p: number, start: number, end: number, amplitude: number, cycles = 2) {
  'worklet';
  if (p <= start || p >= end) return 0;
  const t = norm(p, start, end);
  const envelope = Math.sin(t * Math.PI);
  return Math.sin(t * Math.PI * 2 * cycles) * envelope * amplitude;
}
