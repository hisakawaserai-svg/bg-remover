/**
 * patterns/drop.ts — C. 落下
 *
 * 逆さまのまま上から落ちてきて「ぽすっ」と着地。着地の瞬間に潰れ(スカッシュ)、
 * その反動でくるっと起き上がり、小さく2回跳ねてから収まる。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, easeInQuad, hump, damped } from '../ease';

/** 着地位置(画面中央からの下方向オフセット比)。波紋の中心もここに合わせる。 */
const LANDING_Y = 0.18;

/**
 * 落下の開始位置(画面中央からの上方向オフセット比)。
 *
 * ここを深くしすぎると、加速カーブのせいで**画面外にいる時間ばかり長くなり**、
 * 見えた瞬間にはもう着地間際＝「急に出てくる」ように見える。
 * 画面の上端をわずかに出た位置から落とし、落下のほぼ全区間を画面内で見せる。
 */
const START_Y = 0.64;

/** 起き上がりにかける時間(着地からのms)。ここでひっくり返る。 */
const FLIP_MS = 260;

/**
 * 落下の加速カーブ。純粋な p*p(自由落下)だと出だしが止まって見えるので、
 * 初速を少し持たせた混合にする(0.35*p + 0.65*p*p)。
 */
function fallCurve(p: number) {
  'worklet';
  return 0.35 * p + 0.65 * p * p;
}

const drop: SplashPattern = {
  variant: 'day',
  // 落下は「着地の衝撃」が落下直後に来ないと嘘になるので、squash/bounce は
  // enter 直後から始める(idle/notice はそのバウンドの中で消化される)。
  // そのぶん idle/notice は短め。
  phases: {
    enter: 620,
    idle: 160,
    notice: 160,
    action: 440,
    reveal: 380,
    react: 260,
    settle: 260,
    logo: 320,
    exit: 700,
  },
  wing: { amplitudeRad: 0.2, periodMs: 240 },
  // 着地の衝撃が波紋になって広がる。中心は着地位置(画面やや下)。
  reveal: {
    kind: 'radial',
    band: 0.25,
    center: l => ({ x: l.width / 2, y: l.height / 2 + l.height * LANDING_Y }),
    radius: l => Math.sqrt(l.width * l.width + l.height * l.height) * 0.75,
  },

  // 透明化は着地した瞬間から。波紋なので、衝撃と同時でないと嘘になる。
  revealWindow: m => ({ from: m.enterEnd, to: m.actionEnd }),

  // 着地して画面下に居座るので、ロゴは頭の上へ出す(下だと体に重なる)。
  logoOffset: l => -(l.height * LANDING_Y + l.birdSize * 0.55),

  // 退場: 一度ぴょんと沈んで跳ね、その勢いで斜め上へ飛び去る。
  exitStyle(t, m, l) {
    'worklet';
    const crouch = hump(phase(t, m.logoEnd, m.logoEnd + 160));
    const go = easeInQuad(phase(t, m.logoEnd + 160, m.total));
    // シマエナガの絵は尾が右下に伸びている＝**左向き**が正面。右へ飛ぶ時は
    // そのままだと尾から進んで「逆走」して見えるので、飛び出す前に体を反転する。
    // 0 を通るので、その一瞬が「くるっと向きを変えた」ように見える。
    const turn = mix(phase(t, m.logoEnd + 120, m.logoEnd + 260), 1, -1);
    return {
      transform: [
        { translateX: go * l.width * 0.7 },
        { translateY: crouch * l.birdSize * 0.12 - go * l.height * 0.9 },
        { rotate: `${-go * 0.3}rad` },
        { scaleX: turn },
        { scaleY: 1 - crouch * 0.12 },
      ],
    };
  },

  birdStyle(t, m, l) {
    'worklet';
    // 落下: 画面上端の少し外から、加速しながら着地位置まで。
    const pRaw = phase(t, 0, m.enterEnd);
    const pIn = fallCurve(pRaw);
    const y0 = mix(pIn, -l.height * START_Y, l.height * LANDING_Y);

    // 落下中は縦に伸びる(ストレッチ)。落ちていることが読み取りやすくなる。
    const stretch = (1 - pRaw) * 0.12 * l.motionScale;

    // 逆さま落下 → 着地の反動でくるっと起き上がる。
    // 落ちている間は上下逆(π)、着地から FLIP_MS かけて 0 へ戻す。
    const flip = mix(easeOutCubic(phase(t, m.enterEnd, m.enterEnd + FLIP_MS)), Math.PI, 0);

    // 着地後のバウンド: 減衰する往復。上向き(負)だけ使いたいので絶対値を取る。
    const pAct = phase(t, m.enterEnd, m.actionEnd);
    const bounce = -Math.abs(damped(pAct, 2, 3.2)) * l.birdSize * 0.16;

    // スカッシュ&ストレッチ: 着地直後だけ横に潰れる。
    const squash = hump(phase(t, m.enterEnd, m.enterEnd + 180));
    const scaleX = 1 + squash * 0.18 - stretch * 0.5;
    const scaleY = 1 - squash * 0.18 + stretch;

    // 着地したまま(＝画面下)で余韻を見せるので、他パターンのような lift は無し。

    return {
      transform: [
        { translateY: y0 + bounce },
        { rotate: `${flip}rad` },
        { scaleX },
        { scaleY },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    // 退場: 踏み切ってから羽ばたく。
    if (t >= m.logoEnd) {
      return Math.sin((t / 120) * Math.PI * 2) * 0.45;
    }

    if (t < m.enterEnd) {
      // 落ちている間は翼を開いたまま踏ん張る。
      return -0.5 * phase(t, 0, m.enterEnd);
    }
    // 着地でばたつき、すぐ収まる。
    const p = phase(t, m.enterEnd, m.actionEnd);
    return damped(p, 3, 3.0) * 0.4;
  },
};

export default drop;
