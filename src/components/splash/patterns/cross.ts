/**
 * patterns/cross.ts — D. 横切り
 *
 * 右の画面外から左へ画面を横切り、左端で反転(＝振り返る)して中央へ戻る。
 * 反転は scaleX の符号を反転させて表現する(BirdMascot 自体は触らない)。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, damped } from '../ease';

/** 横切ったあと、いったん止まる位置(画面幅に対する比)。 */
const TURN_X = -0.34;

const cross: SplashPattern = {
  variant: 'day',
  // 横切り→振り返り→中央へ、が長めなので logo/settle は詰める。
  phases: {
    enter: 400,
    idle: 200,
    notice: 200,
    action: 460,
    reveal: 360,
    react: 240,
    settle: 200,
    logo: 300,
    exit: 200,
  },
  wing: { amplitudeRad: 0.34, periodMs: 170 },
  // ぶつかった地点(＝横切って止まる位置)から衝撃が広がる。
  // TURN_X は画面中央からのオフセット比なので、中心座標に足して実座標にする。
  reveal: {
    kind: 'radial',
    band: 0.3,
    center: l => ({ x: l.width * (0.5 + TURN_X), y: l.height / 2 }),
    radius: l => Math.hypot(l.width, l.height) * 0.95,
  },

  // ぶつかった瞬間(enter の終わり＝止まった時)から広がり、中央へ戻るまでに
  // 広がりきる。振り返る動作は「広がっていく背景を見ている」ことになる。
  revealWindow: m => ({ from: m.enterEnd, to: m.actionEnd }),

  birdStyle(t, m, l) {
    'worklet';
    // 登場: 右外から左へ通過。減速して左寄りで止まる。
    const pIn = easeOutCubic(phase(t, 0, m.enterEnd));
    const xIn = mix(pIn, l.width * 0.8, l.width * TURN_X);

    // アクション前半で振り返り(scaleX: 1 → -1)、後半で中央へ戻る。
    const pTurn = phase(t, m.noticeEnd, m.noticeEnd + 200);
    const pBack = easeOutCubic(phase(t, m.noticeEnd + 200, m.actionEnd));
    const x = mix(pBack, l.width * TURN_X, 0);

    // 0 をまたぐと一瞬つぶれて見え、それが「振り向き」に読める。
    // 戻り始めたら正面(+1)に戻す。
    const facing = pBack > 0 ? mix(pBack, -1, 1) : mix(pTurn, 1, -1);
    // 完全な 0 は描画が消えるので最小幅を残す。
    const scaleX = Math.abs(facing) < 0.08 ? (facing < 0 ? -0.08 : 0.08) : facing;

    const bob = damped(phase(t, m.noticeEnd, m.actionEnd), 2, 2.0) * l.birdSize * 0.04;
    const lift = phase(t, m.actionEnd, m.revealEnd) * -l.height * 0.05;

    return {
      transform: [
        { translateX: t < m.enterEnd ? xIn : x },
        { translateY: bob + lift },
        { scaleX },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    const flap = Math.sin((t / 170) * Math.PI * 2) * 0.34;
    if (t < m.actionEnd) {
      return flap;
    }
    // 中央に戻ったら微風程度に落とす。
    return flap * 0.2;
  },
};

export default cross;
