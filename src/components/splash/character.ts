/**
 * splash/character.ts — 全パターン共通の「キャラらしさ」レイヤー
 *
 * 待機・気づき・リアクション・余韻の4フェーズぶんの動きをここに集約し、
 * 各パターンの transform に**上乗せ**する。パターン側は自分の見せ場
 * (enter とアクション)だけを書けばよく、既存4パターンの動きは変わらない。
 *
 * まばたきも時間から決める(SplashAnimationView が eyesClosed に反映する)。
 */
import type { SplashLayout, SplashMarks } from './types';
import { phase, hump, damped } from './ease';

export interface CharacterExtras {
  tx: number;
  ty: number;
  rotate: number;
  scale: number;
}

/** まばたき1回の長さ(ms)。 */
const BLINK_MS = 90;

/**
 * 上乗せする動きを返す **worklet**。
 *
 *   待機     … ゆっくりした呼吸(上下＋わずかな拡縮)
 *   気づき   … 背景の方へ首を傾けるような傾き＋少し身を寄せる
 *   リアク   … 透明になったことに驚いてぴょんと跳ねる(＋一瞬伸びる)
 *   余韻     … 揺れが減衰して静かに収まる
 */
export function characterExtras(
  t: number,
  m: SplashMarks,
  l: SplashLayout,
): CharacterExtras {
  'worklet';
  const s = l.motionScale;

  // 待機: 呼吸。1周期ぶんだけ入れて「ふぅ」と一息つく感じにする。
  const idle = phase(t, m.enterEnd, m.idleEnd);
  const breathe = Math.sin(idle * Math.PI * 2) * l.birdSize * 0.014 * s;
  const breatheScale = Math.sin(idle * Math.PI * 2) * 0.012 * s;

  // 気づき: 行って戻る山。傾いて、そちらへ少し寄る。
  const notice = hump(phase(t, m.idleEnd, m.noticeEnd));
  const tilt = notice * 0.16 * s;
  const lean = notice * l.birdSize * 0.05 * s;

  // リアクション: 跳ねる。上向きだけ使いたいので絶対値を取る。
  const react = phase(t, m.revealEnd, m.reactEnd);
  const hop = -Math.abs(damped(react, 2, 3.0)) * l.birdSize * 0.13 * s;
  const pop = hump(phase(t, m.revealEnd, m.revealEnd + (m.reactEnd - m.revealEnd) * 0.35));

  // 余韻: 収まりきるまでの小さな揺れ。
  const settle = phase(t, m.reactEnd, m.settleEnd);
  const settleBob = damped(settle, 1.5, 2.6) * l.birdSize * 0.022 * s;

  return {
    tx: lean,
    ty: breathe + hop + settleBob,
    rotate: tilt,
    scale: 1 + breatheScale + pop * 0.05 * s,
  };
}

/**
 * その時刻に目を閉じているか(まばたき)を返す **worklet**。
 *
 * 待機中に1回、驚いた瞬間に1回。パターン側の閉眼(sleep)とは OR で合成する。
 */
export function isBlinking(t: number, m: SplashMarks): boolean {
  'worklet';
  const first = m.enterEnd + (m.idleEnd - m.enterEnd) * 0.55;
  const second = m.revealEnd + 40;
  return (
    (t >= first && t < first + BLINK_MS) ||
    (t >= second && t < second + BLINK_MS)
  );
}
