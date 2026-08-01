/**
 * patterns/index.ts — パターンの一覧と選択ロジック
 *
 * **どのパターンを出すかの判断はこのファイルだけで完結する。**
 * SplashAnimationView は resolveSplash の戻り値しか見ない。
 *
 * 選択の優先順位:
 *   1. 呼び出し側が animationType を明示していればそれ(確認・デバッグ用)
 *   2. レア枠(初回起動 or 抽選に当たった時)の drop
 *   3. 時間帯スケジュール(端末のローカル時刻)
 */
import type {
  BirdVariant,
  SplashAnimationType,
  SplashPattern,
} from '../types';
import type { SplashAnimationSetting } from '../../../settings/store';
import fly from './fly';
import sleepPattern from './sleep';
import drop from './drop';
import cross from './cross';
import peel from './peel';
import shake from './shake';

export const PATTERNS: Record<SplashAnimationType, SplashPattern> = {
  fly,
  sleep: sleepPattern,
  drop,
  cross,
  peel,
  shake,
};

/**
 * 時間帯スケジュール。時刻は**端末のローカル時刻**で判定するので、
 * 海外のユーザーでもその土地の朝・昼・夜に合う。
 *
 *   05:00–11:59  fly   / day    朝: 元気に飛んでくる
 *   12:00–17:59  peel  / day    昼: 仕事する感じ(背景を剥がす)
 *   18:00–22:59  cross / night  夕〜夜: 急いで帰ってきて「あ、いた」と振り返る
 *   23:00–04:59  sleep / sleep  深夜: 寝る前なので眠そう
 */
export function scheduleFor(hour: number): {
  animationType: SplashAnimationType;
  variant: BirdVariant;
} {
  if (hour >= 23 || hour < 5) {
    return { animationType: 'sleep', variant: 'sleep' };
  }
  if (hour >= 18) {
    return { animationType: 'cross', variant: 'night' };
  }
  if (hour >= 12) {
    return { animationType: 'peel', variant: 'day' };
  }
  return { animationType: 'fly', variant: 'day' };
}

/**
 * レア枠。時間帯には割り当てず、たまに出るご褒美として扱う。
 * 配色は時間帯のものを引き継ぐ(深夜に当たれば sleep 配色の drop になる)。
 */
export const RARE_ANIMATION: SplashAnimationType = 'drop';

/** レア枠を引く確率。 */
export const RARE_CHANCE = 0.08;

/** 何も判断材料がない時のフォールバック。 */
export const DEFAULT_ANIMATION: SplashAnimationType = 'fly';

/**
 * 設定値の 'auto'/'off' を除いた部分が SplashAnimationType と一致していることを
 * 型レベルで保証する。どちらかに演出を足して片方を忘れるとここで落ちる。
 */
type SettingPattern = Exclude<SplashAnimationSetting, 'auto' | 'off'>;
type AssertSame<A extends B, B> = A;
export type _SettingCoversPatterns = AssertSame<SettingPattern, SplashAnimationType>;
export type _PatternsCoverSetting = AssertSame<SplashAnimationType, SettingPattern>;

export interface SplashChoiceInput {
  /** 明示指定。確認・デバッグ用で、指定があれば時間帯より優先する。 */
  animationType?: SplashAnimationType;
  /**
   * ユーザー設定。'auto' なら時間帯＋レア判定、'off' は呼び出し側で
   * スプラッシュ自体を出さない(ここへは渡ってこない想定)。
   */
  setting?: SplashAnimationSetting;
  /** 配色の明示指定。省略時は時間帯 → パターン既定の順。 */
  variant?: BirdVariant;
  /** 判定に使う時刻。省略時は端末のローカル時刻。テスト用の差し込み口。 */
  now?: Date;
  /**
   * 初回起動かどうか。true ならレア枠(drop)を必ず出す。
   *
   * 呼び出し側からはまだ渡していない。スプラッシュは設定のロード完了を待たずに
   * 表示するため、起動直後は「初回かどうか」が確定していないため。
   * 渡すなら AsyncStorage とは別の同期的な判定手段が要る。
   */
  firstLaunch?: boolean;
  /** レア枠の抽選確率。0 にすると抽選を止められる。 */
  rareChance?: number;
}

export interface SplashChoice {
  animationType: SplashAnimationType;
  pattern: SplashPattern;
  variant: BirdVariant;
}

/**
 * 表示するパターンと配色を決める。
 *
 * 優先順位:
 *   1. animationType の明示指定(確認・デバッグ用)
 *   2. ユーザー設定が 'auto' 以外 → そのパターンで固定(レア抽選はしない。
 *      'drop' を選んだ場合も毎回再生される)
 *   3. 'auto' → 時間帯スケジュール。ただしレア抽選に当たれば RARE_ANIMATION
 *
 * 配色は「固定指定ならそのパターンの既定色 / 自動なら時間帯の色」。
 */
export function resolveSplash(input?: SplashChoiceInput): SplashChoice {
  const hour = (input?.now ?? new Date()).getHours();
  const scheduled = scheduleFor(hour);

  const setting = input?.setting ?? 'auto';
  const fixed: SplashAnimationType | undefined =
    input?.animationType ??
    (setting !== 'auto' && setting !== 'off' ? setting : undefined);

  // レア判定は自動の時だけ。ユーザーが選んだ演出を勝手に上書きしない。
  const rare =
    fixed === undefined &&
    (input?.firstLaunch === true ||
      Math.random() < (input?.rareChance ?? RARE_CHANCE));

  const animationType =
    fixed ?? (rare ? RARE_ANIMATION : scheduled.animationType);

  const pattern = PATTERNS[animationType] ?? PATTERNS[DEFAULT_ANIMATION];

  return {
    animationType,
    pattern,
    variant:
      input?.variant ?? (fixed ? pattern.variant : scheduled.variant),
  };
}
