/**
 * patterns/shake.ts — F. ぶるぶる
 *
 * 中央に降りてきて、犬が水を切るように体を細かく震わせる。
 * 震えが最高潮に達したところで、振り落とした背景が自分を中心に飛び散る。
 *
 * peel(丁寧に剥がす)・fly(風で吹き飛ばす)に対して、こちらは「勢いで振り落とす」。
 * 尺が短くまとまるので、起動を軽くしたい時の候補でもある。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, hump, damped } from '../ease';

/** 震えの回数(action 全体で何往復するか)。 */
const SHAKE_CYCLES = 7;
/** 振り落とし(＝透明化の開始)が action のどこで起きるか(比)。 */
const BURST_AT = 0.7;

const shake: SplashPattern = {
  variant: 'day',
  phases: {
    enter: 340,
    idle: 200,
    notice: 180,
    action: 460,
    reveal: 340,
    react: 240,
    settle: 200,
    logo: 300,
    exit: 200,
  },
  wing: { amplitudeRad: 0.28, periodMs: 150 },

  // 振り落とした背景が体を中心に飛び散る。帯は狭めにして勢いを出す。
  reveal: {
    kind: 'radial',
    band: 0.22,
    center: l => ({ x: l.width / 2, y: l.height / 2 }),
    radius: l => Math.hypot(l.width, l.height) * 0.8,
  },

  // 震えが最高潮になった瞬間から透明化が始まる。
  revealWindow: m => ({
    from: m.noticeEnd + (m.actionEnd - m.noticeEnd) * BURST_AT,
    to: m.revealEnd,
  }),

  birdStyle(t, m, l) {
    'worklet';
    const s = l.motionScale;
    const burst = m.noticeEnd + (m.actionEnd - m.noticeEnd) * BURST_AT;

    // 登場: 上からすっと降りてくる。
    const pIn = easeOutCubic(phase(t, 0, m.enterEnd));
    const y0 = mix(pIn, -l.height * 0.3, 0) * s;

    // 震え: 横方向の細かい往復。後半ほど激しくする。
    const pShake = phase(t, m.noticeEnd, burst);
    const intensity = pShake * pShake;
    const wobble =
      Math.sin(pShake * Math.PI * 2 * SHAKE_CYCLES) *
      l.birdSize *
      0.05 *
      intensity *
      s;
    // 体もわずかにひねる。
    const twist =
      Math.sin(pShake * Math.PI * 2 * SHAKE_CYCLES + 0.6) * 0.08 * intensity * s;

    // 振り落とした瞬間: ふくらんでから戻る。
    const pop = hump(phase(t, burst, burst + (m.actionEnd - burst) * 0.6));
    // その後の余韻。
    const after = damped(phase(t, burst, m.revealEnd), 2, 3.0) * l.birdSize * 0.03 * s;

    const lift = phase(t, m.actionEnd, m.revealEnd) * -l.height * 0.05;

    return {
      transform: [
        { translateX: wobble },
        { translateY: y0 + after + lift },
        { rotate: `${twist}rad` },
        { scaleX: 1 + pop * 0.1 * s },
        { scaleY: 1 - pop * 0.06 * s },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    const burst = m.noticeEnd + (m.actionEnd - m.noticeEnd) * BURST_AT;
    if (t < m.noticeEnd) {
      return Math.sin((t / 150) * Math.PI * 2) * 0.28;
    }
    if (t < burst) {
      // 震えに合わせて翼も小刻みに。
      const p = phase(t, m.noticeEnd, burst);
      return Math.sin(p * Math.PI * 2 * SHAKE_CYCLES) * 0.35 * p;
    }
    // 振り落とし: 翼を一気に開く。
    return -0.85 * hump(phase(t, burst, m.actionEnd));
  },
};

export default shake;
