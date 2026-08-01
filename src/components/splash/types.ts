/**
 * splash/types.ts — スプラッシュ演出パターンの共通インターフェース
 *
 * 演出は「1本の経過時間(ms)」で駆動する。withSequence を積み上げず、
 * elapsed: 0→total を流して各要素が interpolate で自分の値を決める方式にしてある。
 * パターン追加＝このインターフェースを満たすオブジェクトを1つ書くだけで済む。
 *
 * 共通フロー(9フェーズ):
 *   enter  … シマエナガ登場
 *   idle   … 待機(ちょこんと止まって呼吸・まばたき)
 *   notice … 気づき(背景の方をちらっと見る)
 *   action … パターン固有のアクション
 *   reveal … アクションが原因で背景が透明チェッカーへ変化
 *   react  … リアクション(透明になったことに驚いて跳ねる)
 *   settle … 余韻(ゆっくり落ち着く)
 *   logo   … ロゴ(app.name の文字ロゴ)表示
 *   exit   … 全体フェードアウト → ホームへ
 *
 * idle/notice/react/settle の動きは全パターン共通で splash/character.ts が
 * 付け足す。各パターンは自分の見せ場(enter/action)だけを書けばよい。
 */
import type { ViewStyle } from 'react-native';

export type SplashAnimationType =
  | 'fly'
  | 'sleep'
  | 'drop'
  | 'cross'
  | 'peel'
  | 'shake';

/** 2次元の点。reveal の起点計算に使う。 */
export interface SplashPoint {
  x: number;
  y: number;
}

/**
 * 背景の透明チェッカー化の「出方」。
 *
 * キャラのアクションが原因で透明化が起きるように見せるため、パターンごとに
 * どこから・どう広がるかを変えられるようにしてある。
 *
 *   linear … 帯状の境目が from → to へ流れる(端から剥がれる)
 *   radial … ある一点から円状に広がる(羽ばたきの風・着地の衝撃・衝突)
 *   fade   … 全体が一様に薄れて消える(眠気が晴れる)
 *
 * いずれも progress=0 で全面シーン色、progress=1 で**全面チェッカー**になる。
 * アイコンのように色を残す指定は持たない(スプラッシュは透明になりきる)。
 */
export type RevealSpec =
  | {
      kind: 'linear';
      /** 境目のぼかし幅(0〜1)。小さいほど「ペリッ」と剥がれる感じになる。 */
      band: number;
      from: (l: SplashLayout) => SplashPoint;
      to: (l: SplashLayout) => SplashPoint;
    }
  | {
      kind: 'radial';
      band: number;
      center: (l: SplashLayout) => SplashPoint;
      radius: (l: SplashLayout) => number;
    }
  | { kind: 'fade' };

/** BirdMascot の variant（＝配色）。動き(SplashAnimationType)とは直交させる。 */
export type BirdVariant = 'day' | 'night' | 'sleep';

/** 各フェーズの長さ(ms)。 */
export interface SplashPhases {
  enter: number;
  idle: number;
  notice: number;
  action: number;
  reveal: number;
  react: number;
  settle: number;
  logo: number;
  exit: number;
}

/** フェーズ境界を絶対時刻(ms)に直したもの。worklet からはこれだけを見る。 */
export interface SplashMarks {
  enterEnd: number;
  idleEnd: number;
  /** 気づきの終わり ＝ パターン固有アクションの開始。 */
  noticeEnd: number;
  actionEnd: number;
  revealEnd: number;
  reactEnd: number;
  settleEnd: number;
  logoEnd: number;
  total: number;
}

/** 画面と描画サイズ。画面外から飛ばす距離などの基準に使う。 */
export interface SplashLayout {
  width: number;
  height: number;
  birdSize: number;
  /**
   * 動きの大きさの倍率(1 = 従来どおり)。
   *
   * OS のモーション低減が ON の時に 1 未満が入る想定の受け口。移動量・回転量・
   * バウンス量・羽ばたきの振れ幅にこれを掛ければ、演出の構成(フェーズ進行・
   * 背景の透明化・ロゴ表示)は保ったまま「動きの大きさ」だけ抑えられる。
   * 時間進行の方は常に流す(SplashAnimationView の master clock 参照)。
   *
   * 現状はどのパターンもまだ参照しておらず、常に 1。
   */
  motionScale: number;
}

export interface SplashPattern {
  /** 既定の配色。呼び出し側の variant プロップで上書きできる。 */
  variant: BirdVariant;
  phases: SplashPhases;
  /** 汎用の羽ばたき(振れ幅・周期)。wingAngle を持つパターンはそちらが優先。 */
  wing: { amplitudeRad: number; periodMs: number };
  /** 背景の透明チェッカー化の出方。アクションの結果に見えるよう起点を合わせる。 */
  reveal: RevealSpec;
  /**
   * 透明化を走らせる時間帯。省略時は reveal フェーズそのもの
   * (actionEnd → revealEnd)。
   *
   * 「原因になった瞬間」がアクション終わりとは限らないパターン用。
   * 例: cross はぶつかった瞬間(enterEnd)から広がってほしい。
   */
  revealWindow?: (m: SplashMarks) => { from: number; to: number };
  /**
   * キャラを包む View の transform を返す **worklet**。
   * t は経過ms。位置・拡縮・回転はすべてここで決める(BirdMascot は触らない)。
   */
  birdStyle: (t: number, m: SplashMarks, l: SplashLayout) => ViewStyle;
  /**
   * 翼の角度(ラジアン)を返す **worklet**。省略時は wing の等速羽ばたき。
   * 目をこするなど、羽ばたき以外の翼の動きを作るパターンだけ実装する。
   */
  wingAngle?: (t: number, m: SplashMarks) => number;
  /**
   * ロゴの表示位置(画面中央からの縦オフセット px)。
   * 既定はキャラの下(birdSize*0.45)。キャラが画面下に居座るパターン(drop)など、
   * 下に置くと重なる場合に上へ出すために使う。
   */
  logoOffset?: (l: SplashLayout) => number;
  /**
   * 目を閉じておく時間(ms)。経過がこれを超えると目が開く。
   * 省略時は variant 既定（sleep のみ閉眼）に従う。
   */
  eyesClosedUntil?: (m: SplashMarks) => number;
}

/** フェーズ長 → 絶対時刻。 */
export function marksOf(p: SplashPhases): SplashMarks {
  const enterEnd = p.enter;
  const idleEnd = enterEnd + p.idle;
  const noticeEnd = idleEnd + p.notice;
  const actionEnd = noticeEnd + p.action;
  const revealEnd = actionEnd + p.reveal;
  const reactEnd = revealEnd + p.react;
  const settleEnd = reactEnd + p.settle;
  const logoEnd = settleEnd + p.logo;
  return {
    enterEnd,
    idleEnd,
    noticeEnd,
    actionEnd,
    revealEnd,
    reactEnd,
    settleEnd,
    logoEnd,
    total: logoEnd + p.exit,
  };
}
