/**
 * settings/store.ts — アプリ設定の永続化
 *
 * セッション store（src/session/store.ts）と同じ「単一キー JSON」方式。
 * 設定項目が増えたら AppSettings に追加して writeSettings を呼ぶだけでよい。
 *
 * 現在の設定項目:
 *   tolerance: flood-fill の許容色差（removeBackground に渡す値）
 *              デフォルト 30 / 範囲 0〜100
 *   eyedropperTolerance: スポイトの許容色差（removeColorAt に渡す値）
 *              デフォルト 30 / 範囲 0〜100
 *   splitTolerance: 「分割の細かさ」（列検出のしきい値に変換して使う値）
 *              デフォルト 30 / 範囲 0〜100
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LanguageSetting } from '../i18n';

const STORAGE_KEY = 'app_settings';

export type ThumbBg = 'white' | 'gray' | 'checker' | 'black';

export type SplitLineColor = '#007AFF' | '#FF9500' | '#FF3B30';

/**
 * アプリアイコン。'auto' は時間帯に合わせて切り替える。
 * それ以外を選んだ場合は自動判定を使わず固定する。
 */
export type AppIconSetting = 'day' | 'night' | 'sleep';

/**
 * 起動アニメーション。'auto' は時間帯に合わせて選び、'off' は演出なしで
 * すぐホームへ入る。それ以外は毎回そのパターンを固定で再生する
 * (通常はレア枠の 'drop' も、明示指定なら毎回出る)。
 *
 * 値は splash 側の SplashAnimationType と揃えてある。ずれるとコンパイル
 * エラーになるよう、splash/patterns/index.ts で相互チェックしている。
 */
export type SplashAnimationSetting =
  | 'auto'
  | 'off'
  | 'fly'
  | 'peel'
  | 'cross'
  | 'sleep'
  | 'shake'
  | 'drop';

export interface AppSettings {
  tolerance: number;
  /**
   * スポイトの許容色差。tolerance とは別に持つ。
   * 四隅からの自動背景除去は上げすぎるとキャラ本体を食うので保守的な値が要るのに対し、
   * スポイトは狙って押す操作でアンチエイリアスやグラデを拾うため高めが欲しく、
   * 求める値の方向が逆になるため共有しない。
   */
  eyedropperTolerance: number;
  /**
   * 「分割の細かさ」スライダー専用の値。tolerance とは別に持つ。
   * eyedropperTolerance を分けているのと同じ理由で、tolerance が「色をどこまで
   * 背景とみなすか」なのに対し、こちらは「どれくらいの隙間を列の切れ目とみなすか」で
   * 対象そのものが別物のため。以前は tolerance を共有していたので、分割の細かさを
   * 動かすと以後に読み込む画像の背景除去の強さまで変わる副作用があった
   * （0付近にすると背景が抜けきらず 1×1 に潰れた）。
   */
  splitTolerance: number;
  /**
   * 輪郭のフェザリング。透過した領域の境界1pxを、背景の混ざり具合に応じて
   * 半透明にし、混入した背景色を差し引く。ONだと白フチが出にくくなる。
   * アンチエイリアスの無い絵では効果が薄いのでOFFにできるようにしてある。
   */
  featherEdges: boolean;
  /**
   * 「文字の穴を透過する」（上級者向け）。既定 false。
   *
   * ON にすると、線で囲まれていて画像端と繋がっていない背景（「あ」「ロ」の内側や
   * 細い隙間）も透過する。抜くのは「細い」閉領域だけに限っているが、それでも
   * 背景と同じ色の細い被写体を消してしまう可能性は残る。
   * スタンプ作成では誤除去のほうが痛いので、既定は OFF。
   */
  fillTextHoles: boolean;
  gridColumns: 2 | 3 | 4;
  thumbBg: ThumbBg;
  splitLineColor: SplitLineColor;
  /** エクスポート完了後にセッション（画像ファイル含む）を自動削除するか */
  autoDeleteOnExport: boolean;
  /** 範囲を調整のチュートリアルをスキップするか */
  skipPolygonTutorial: boolean;
  /** 全体オンボーディングを表示済みか（false = 未表示 = 初回） */
  hasSeenOnboarding: boolean;
  /**
   * 写真アルバムの名前。**初回保存時に決まり、以後変わらない。**
   *
   * null = まだ一度も保存していない（＝アルバム未作成）。
   * 初回保存の直前に、その時の表示言語の名前（t('app.albumName')）を焼き付ける。
   *
   * 言語設定に追従させない理由: アルバム名を変えると写真アプリ側に別アルバムが
   * でき、それまでに保存した画像がアプリの「保存先」から見えなくなる。
   * 一度決めたら固定することで、アプリの表示と写真アプリの実体が常に一致する。
   */
  albumName: string | null;
  /**
   * これまでに使ったアルバム名の履歴（albumName も含む、古い順）。
   *
   * 「保存先」画面はこの全部から画像を集める。保存先は常に albumName の1つだけ。
   *
   * 何のためか:
   *   - ユーザーが写真アプリ側でアルバムを手で改名すると、保存済みの名前では
   *     引けなくなり「保存先」が空になる。次の保存で同名アルバムが作り直され、
   *     古い画像だけ取り残される。履歴を全部引けば両方見える。
   *   - 将来アルバム名を変える必要が出ても、過去の画像を見失わずに済む。
   */
  albumNameHistory: string[];
  /**
   * 表示言語。'auto' は端末の言語に追従する。
   * 既定を 'auto' にしているので、既存ユーザーの保存済み設定にこのキーが
   * 無くても（下の loadSettings のマージで）端末の言語で表示される。
   */
  language: LanguageSetting;
  /** ホーム画面のアプリアイコン。既定は時間帯連動。 */
  appIcon: AppIconSetting;
  /**
   * 起動アニメーションを出すか。既定 true。
   *
   * パターン選択(splashAnimation)とは分けてある。OFF にしてから ON に戻した時、
   * 選んでいたパターンが失われないようにするため。
   */
  splashEnabled: boolean;
  /**
   * 起動アニメーションのパターン。既定は時間帯連動。
   *
   * 'off' は splashEnabled 導入前の保存値との互換のために型に残してある。
   * 新しく書き込むことはない(OFF は splashEnabled=false で表す)。
   */
  splashAnimation: SplashAnimationSetting;
}

// 設定のデフォルト値（キーが無い or 未設定項目のフォールバック）。
// export することで Context や useState の初期値として直接使える。
// App.tsx 側にデフォルト値をコピーしなくてよくなり、追加時の変更箇所が1箇所に絞られる。
export const DEFAULTS: AppSettings = {
  tolerance:      30,
  eyedropperTolerance: 30,
  // tolerance の現行デフォルトと同じ値。分離しても既存ユーザーの体感が変わらないようにする。
  splitTolerance: 30,
  featherEdges:   true,
  // 既定 OFF。誤除去を増やさないことを優先する（上級者が明示的に ON にする想定）。
  fillTextHoles:  false,
  gridColumns:    3,
  thumbBg:        'white',
  splitLineColor: '#007AFF',
  autoDeleteOnExport: true,
  skipPolygonTutorial: false,
  hasSeenOnboarding: false,
  albumName: null,
  albumNameHistory: [],
  language: 'auto',
  appIcon: 'day',
  splashEnabled: true,
  splashAnimation: 'auto',
};

/**
 * 起動アニメーションを出すべきか。
 *
 * 旧バージョンで 'off' を保存していた場合もここで OFF として扱う。
 * 判定を1か所にまとめ、呼び出し側が両方のフィールドを見なくて済むようにする。
 */
export function isSplashEnabled(s: AppSettings): boolean {
  return s.splashEnabled && s.splashAnimation !== 'off';
}

/** 設定を読み込む。失敗時はデフォルト値を返す（UI がクラッシュしないよう）。*/
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // 保存済み値とデフォルトをマージ: 未来に追加したキーも DEFAULTS で補完される
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch (e) {
    console.warn('[settings/store] loadSettings failed:', e);
    return { ...DEFAULTS };
  }
}

/** 設定を保存する。既存値との merge は呼び出し側で済ませてから渡す。*/
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[settings/store] saveSettings failed:', e);
  }
}
