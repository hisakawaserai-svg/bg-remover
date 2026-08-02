/**
 * patterns/peel.ts — E. めくり
 *
 * 「背景を剥がすアプリ」であることをそのまま見せるパターン。
 *   中央にいるまま右上をちらっと見る → くちばしでつまんで斜め下へ引っぱる →
 *   その方向へ背景がペリッと剥がれ、下のホーム画面が出てくる。
 *
 * キャラは端まで移動させない(REACH_X/REACH_Y)。端に張り付くと可愛さが落ち、
 * ロゴの表示位置とも干渉するため、身を乗り出す程度に留めている。
 *
 * 何をしているか分かるようにするための作り:
 *   - 剥がれの**起点をキャラがつまんだ位置そのもの**にする(reveal.from)
 *   - 剥がれるのは**引っぱっている間だけ**にする(revealWindow)
 *   - つまむ/引っぱるの傾きを大きく取り、動作の向きを読めるようにする
 * 境目は band を小さくして硬いエッジにしてある(紙をめくる感じ)。
 */
import type { SplashPattern } from '../types';
import { phase, mix, easeOutCubic, easeInQuad, hump, damped } from '../ease';

/**
 * つまみに行く位置(画面サイズに対する比)。
 * 端まで移動させず「中央にいるまま、ちょっと端へ身を乗り出す」程度に留める。
 * 大きく動かすとキャラが端に張り付いてロゴとも喧嘩するため。
 */
const REACH_X = 0.16;
const REACH_Y = -0.11;
/** 引っぱる量(同じく画面比)。つまんだ所から斜め下へ大きく引く。 */
const PULL_X = -0.12;
const PULL_Y = 0.15;
/** つまむ動作の長さ(気づき終わりからのms)。 */
const PINCH_MS = 300;

const peel: SplashPattern = {
  variant: 'day',
  // つまむ→引っぱるの2ビートがあるので action/reveal は長め。
  phases: {
    enter: 360,
    idle: 220,
    notice: 240,
    action: 480,
    reveal: 420,
    react: 260,
    settle: 220,
    logo: 300,
    exit: 700,
  },
  wing: { amplitudeRad: 0.3, periodMs: 200 },
  // **つまんだ場所そのもの**を起点にして、引っぱる方向(左下)へ剥がれる。
  // 起点を REACH_X/REACH_Y から算出しているので、キャラの動きを変えれば
  // 剥がれ始める場所も自動で追従する。
  reveal: {
    kind: 'linear',
    band: 0.05,
    from: l => ({
      x: l.width * (0.5 + REACH_X),
      y: l.height * (0.5 + REACH_Y),
    }),
    to: l => ({ x: 0, y: l.height }),
  },

  // 引っぱっている間だけ剥がれる(引く動作と背景の変化を一致させる)。
  revealWindow: m => ({ from: m.noticeEnd + PINCH_MS, to: m.revealEnd }),

  // 退場: 仕事を終えて満足げに一度うなずき、右端へ帰っていく。
  exitStyle(t, m, l) {
    'worklet';
    const nod = hump(phase(t, m.logoEnd, m.logoEnd + 220));
    const go = easeInQuad(phase(t, m.logoEnd + 220, m.total));
    // シマエナガの絵は尾が右下に伸びている＝**左向き**が正面。右へ飛ぶ時は
    // そのままだと尾から進んで「逆走」して見えるので、飛び出す前に体を反転する。
    // 0 を通るので、その一瞬が「くるっと向きを変えた」ように見える。
    const turn = mix(phase(t, m.logoEnd + 180, m.logoEnd + 320), 1, -1);
    return {
      transform: [
        { translateX: go * l.width * 0.95 },
        { translateY: nod * l.birdSize * 0.07 - go * l.height * 0.2 },
        { rotate: `${nod * 0.18 - go * 0.2}rad` },
        { scaleX: turn },
      ],
    };
  },

  birdStyle(t, m, l) {
    'worklet';
    // 登場: 下から中央へ。
    const pIn = easeOutCubic(phase(t, 0, m.enterEnd));
    const yIn = mix(pIn, l.height * 0.35, 0);

    // アクション前半: 中央にいたまま、右上をちらっと見て身を乗り出す。
    const pGo = easeOutCubic(phase(t, m.noticeEnd, m.noticeEnd + PINCH_MS));
    // アクション後半〜reveal: くちばしでつまんで斜め下へ引っぱる。
    const pPull = easeInQuad(phase(t, m.noticeEnd + PINCH_MS, m.revealEnd));

    // 引っぱりの手応え: 一定に引くのではなく2回グッと来る。
    const tug = damped(phase(t, m.noticeEnd + PINCH_MS, m.revealEnd), 2, 2.2) * 0.35;

    const x = (mix(pGo, 0, REACH_X) + pPull * PULL_X) * l.width + tug * l.birdSize * 0.05;
    // ロゴのぶんだけ上へ譲る(これが無いと最後に文字とキャラが重なる)。
    const lift = phase(t, m.actionEnd, m.revealEnd) * -l.height * 0.05;
    const y = yIn + (mix(pGo, 0, REACH_Y) + pPull * PULL_Y) * l.height + lift;

    // つまみに行く時はくちばしを右上へ向けて大きく傾き、
    // 引っぱる時は逆へ踏ん張る。動作が読み取れるよう角度は大きめに取る。
    const rotate = mix(pGo, 0, -0.3) + pPull * 0.5 + tug * 0.08;
    // 身を乗り出す時に軽く伸び上がる。
    const reach = hump(phase(t, m.noticeEnd, m.noticeEnd + PINCH_MS));

    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${rotate}rad` },
        { scale: 1 + reach * 0.04 },
      ],
    };
  },

  wingAngle(t, m) {
    'worklet';
    // 退場: うなずいてから羽ばたいて帰る。
    if (t >= m.logoEnd) {
      return Math.sin((t / 140) * Math.PI * 2) * 0.42;
    }

    const flap = Math.sin((t / 200) * Math.PI * 2) * 0.3;
    if (t < m.noticeEnd) {
      return flap;
    }
    // つまむ: 翼を大きく後ろへ引いて「掴んだ」形を作る。
    const pGo = phase(t, m.noticeEnd, m.noticeEnd + PINCH_MS);
    const pPull = phase(t, m.noticeEnd + PINCH_MS, m.revealEnd);
    // 引っぱる間は翼をばたつかせて踏ん張っているように見せる。
    const strain = Math.sin(pPull * Math.PI * 6) * 0.18 * (1 - pPull);
    return mix(pGo, flap, -0.75) - pPull * 0.3 + strain;
  },
};

export default peel;
