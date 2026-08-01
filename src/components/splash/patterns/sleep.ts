/**
 * patterns/sleep.ts — B. 眠そう
 *
 * 閉じ目のまま下からゆっくり浮かび上がり、翼を顔へ寄せて目をこすり、
 * 一拍おいて目を開ける(＝起きる)。配色は sleep のまま、目だけ eyesClosed で開ける。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, hump } from '../ease';

/** 目を開けるタイミング(アクション終了からの相対ms)。 */
const WAKE_AFTER_ACTION = 80;

const sleep: SplashPattern = {
  variant: 'sleep',
  // 眠そうな間を作るため enter/action を長めに、そのぶん logo を詰める。
  // 眠そうな間を作るため enter/idle/action を長めに。
  phases: {
    enter: 440,
    idle: 300,
    notice: 220,
    action: 480,
    reveal: 360,
    react: 240,
    settle: 240,
    logo: 300,
    exit: 200,
  },
  wing: { amplitudeRad: 0.12, periodMs: 520 },
  // 目が覚めて眠気が晴れるように、背景が一様に薄れて消える。
  reveal: { kind: 'fade' },

  birdStyle(t, m, l) {
    'worklet';
    // 登場: 下からゆっくり。眠そうに見えるよう速度は控えめ。
    const pIn = easeOutCubic(phase(t, 0, m.enterEnd));
    const y0 = mix(pIn, l.height * 0.12, 0);

    // うとうと: ゆっくりした上下＋わずかな傾き。
    const drowsy = Math.sin((t / 900) * Math.PI * 2);
    const bob = drowsy * l.birdSize * 0.03;
    const tilt = drowsy * 0.05;

    // 起きる瞬間に軽く伸び上がる。
    const wake = hump(phase(t, m.actionEnd, m.actionEnd + 220));
    const lift = phase(t, m.actionEnd, m.revealEnd) * -l.height * 0.05;

    return {
      transform: [
        { translateY: y0 + bob + lift - wake * l.birdSize * 0.06 },
        { rotate: `${tilt}rad` },
        { scale: 1 + wake * 0.04 },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    if (t < m.enterEnd) {
      // 登場中はほぼ動かさない(眠っている)。
      return Math.sin((t / 520) * Math.PI * 2) * 0.12;
    }
    const p = phase(t, m.noticeEnd, m.actionEnd);
    // 目をこする: 翼を顔の高さまで持ち上げ(-1.0rad付近)、小刻みに往復させる。
    const raise = hump(p) * -1.0;
    const rub = hump(p) * Math.sin(p * Math.PI * 8) * 0.18;
    return raise + rub;
  },

  eyesClosedUntil(m) {
    return m.actionEnd + WAKE_AFTER_ACTION;
  },
};

export default sleep;
