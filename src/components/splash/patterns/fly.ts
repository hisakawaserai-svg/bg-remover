/**
 * patterns/fly.ts — A. 飛来（既定/朝）
 *
 * 流れ:
 *   右上の画面外から飛来 → 羽ばたきながら中央へ接近 → 着地前に減速 →
 *   **着地と同時に大きくブレーキの羽ばたき(ここで透明化が始まる)** →
 *   ホバリング → 羽を整える → 左上へ抜けていく(来た方へは戻らない)
 *
 * sleep との差別化:
 *   sleep は「遅い・振れ幅が小さい・目を閉じている」。こちらは逆に
 *   「速い・振れ幅が大きい・翼を止めない」で通す。ホバリング中も羽ばたきを
 *   止めないのがポイント。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, easeInQuad, hump, damped } from '../ease';

/** 飛来中の羽ばたき周期(ms)。短い＝速い。 */
const FLAP_FAST = 155;
/** ホバリング中の羽ばたき周期(ms)。 */
const FLAP_HOVER = 180;
/**
 * 着地のブレーキ(＝大きな羽ばたき)が enter のどこで始まるか(比)。
 * この羽ばたきが透明化のきっかけになるので、着地の瞬間と合わせている。
 */
const BRAKE_AT = 0.72;

const fly: SplashPattern = {
  variant: 'day',
  phases: {
    enter: 660,
    idle: 260,
    notice: 200,
    action: 520,
    reveal: 380,
    react: 240,
    settle: 200,
    logo: 300,
    exit: 700,
  },
  wing: { amplitudeRad: 0.42, periodMs: FLAP_FAST },

  // 大きな羽ばたきが起こした風が、キャラを中心に広がって背景を吹き飛ばす。
  reveal: {
    kind: 'radial',
    band: 0.45,
    center: l => ({ x: l.width / 2, y: l.height / 2 }),
    radius: l => Math.hypot(l.width, l.height) * 0.75,
  },

  // 透明化は「着地してブレーキの羽ばたきをした瞬間」から始まり、
  // 羽を整え終わるまでに広がりきる。
  revealWindow: m => ({ from: m.enterEnd, to: m.actionEnd }),

  // 退場: 来た方へ引き返すと「なぜ戻る?」と見えるので、**反対側(左上)へ抜ける**。
  // 右上から入って左上へ抜けることで、通りすがりに寄ってくれた感じになる。
  exitStyle(t, m, l) {
    'worklet';
    const p = phase(t, m.logoEnd, m.total);
    // 前半は溜め(小さく上下)、後半で一気に加速する。
    const go = easeInQuad(phase(t, m.logoEnd + (m.total - m.logoEnd) * 0.25, m.total));
    const bob = Math.sin(p * Math.PI * 6) * l.birdSize * 0.04 * (1 - go);
    return {
      transform: [
        { translateX: -go * l.width * 1.1 },
        { translateY: bob - go * l.height * 0.55 },
        { rotate: `${go * 0.45}rad` },
      ],
    };
  },

  birdStyle(t, m, l) {
    'worklet';
    const s = l.motionScale;
    const brake = m.enterEnd * BRAKE_AT;

    // 登場: 右上の外から一直線に。最後だけ強く減速する(着地前の減速)。
    const pIn = easeOutCubic(phase(t, 0, m.enterEnd));
    const x = mix(pIn, l.width * 0.85, 0) * s;
    const y = mix(pIn, -l.height * 0.5, 0) * s;
    // 突っ込んでくる間は傾き、止まる時に水平へ戻る。
    const dive = mix(pIn, -0.42, 0) * s;

    // ホバリング: 止まらずその場で細かく上下する(idle〜notice)。
    const hoverP = phase(t, m.enterEnd, m.noticeEnd);
    const hover =
      Math.sin(hoverP * Math.PI * 6) * l.birdSize * 0.035 * s * (1 - hoverP * 0.4);

    // 羽を整える: 少し前かがみになる。
    const preen = hump(phase(t, m.noticeEnd, m.actionEnd));

    // 着地のブレーキ: 反動で沈んでから浮く。
    const recoil = damped(phase(t, brake, m.idleEnd), 1.5, 2.2) * l.birdSize * 0.09 * s;

    // ロゴのぶんだけ少し上へ譲る。
    const lift = phase(t, m.actionEnd, m.revealEnd) * -l.height * 0.05;

    return {
      transform: [
        { translateX: x },
        { translateY: y + hover + recoil + lift },
        { rotate: `${dive + preen * 0.12 * s}rad` },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    // 退場: 飛び去る間はいちばん速く羽ばたく。
    if (t >= m.logoEnd) {
      return Math.sin((t / 110) * Math.PI * 2) * 0.5;
    }

    const brake = m.enterEnd * BRAKE_AT;
    // 飛来: 速く大きく羽ばたきながら近づく。
    if (t < brake) {
      return Math.sin((t / FLAP_FAST) * Math.PI * 2) * 0.42;
    }
    // 着地のブレーキ: 大きく1回振り下ろす。透明化はここから走る。
    if (t < m.enterEnd) {
      return -1.05 * hump(phase(t, brake, m.enterEnd));
    }
    // ホバリング: 速度を落としつつも止めない(ここが sleep との差)。
    if (t < m.noticeEnd) {
      return Math.sin((t / FLAP_HOVER) * Math.PI * 2) * 0.3;
    }
    // 羽を整える: 翼を体に寄せて小刻みに動かす。
    const p = phase(t, m.noticeEnd, m.actionEnd);
    return -0.2 + Math.sin(p * Math.PI * 6) * 0.12;
  },
};

export default fly;
