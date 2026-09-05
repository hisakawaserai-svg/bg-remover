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

/**
 * 復元ブラシ等の太さ(px)の範囲。設定の brushDefaultPx（初期値）と
 * PolygonEditor 側のスライダー（セッション中の一時調整）で共有する。
 */
export const BRUSH_MIN_PX = 1;
export const BRUSH_MAX_PX = 80;

export type ThumbBg = 'white' | 'gray' | 'checker' | 'black';

/** 初期背景除去の方式。'flood' = 色ベースフラッドフィル（従来）、'vision' = iOS Vision。 */
export type BgEngine = 'flood' | 'vision';

export type SplitLineColor = '#007AFF' | '#FF9500' | '#FF3B30';

/**
 * アプリアイコン。'auto' は時間帯に合わせて切り替える。
 * それ以外を選んだ場合は自動判定を使わず固定する。
 */
export type AppIconSetting = 'day' | 'night' | 'sleep';

/**
 * ルーペのレティクル（照準）の扱い。復元ブラシ・スポイト・ポリゴン編集で共通。
 *
 *   'fixed'  … 従来どおり。指を置いている場所がそのまま編集位置で、
 *              指を離した時点で確定する。ルーペはドラッグ中だけ出る。
 *   'adjust' … レティクル（照準）が常に画面上にあり、指・ドラッグ・十字ボタンの
 *              どれでも動かせる。指を離しても確定せず、決定ボタンで確定する。
 *              十字ボタン1回＝元画像1ドットなので、拡大しても縮小しても
 *              「押した回数＝動いたドット数」が変わらない。
 *   'drag'   … 設定画面からは選択不可（v1で非表示化）。実装自体は残っている
 *              （PolygonEditor.tsx の drag_reticle/drag_vertex_free/
 *              drag_poly_free 等）。保存済み設定が 'drag' の場合は
 *              loadSettings() で 'adjust' へフォールバックする。
 */
export type LoupeMode = 'fixed' | 'adjust' | 'drag';

/**
 * LoupeMode の各値に対応するアイコン名（MaterialIcons）。
 * 設定画面と編集画面のドロップダウンで同じアイコンを使い、
 * 「どのアイコンがどのモードか」を利用者が対応付けられるようにする。
 * fixed は実態が「指の位置をそのままドラッグして狙う」操作なので、
 * 「固定」を連想させる 'gps-fixed' ではなく 'pan-tool'（旧 drag のアイコン）
 * を使う。
 */
export const LOUPE_MODE_ICONS: Record<LoupeMode, string> = {
  fixed: 'pan-tool',
  adjust: 'control-camera',
  drag: 'pan-tool',
};

/**
 * ルーペの倍率が、キャンバスのズーム（ピンチ／スライダー）にどう追従するか。
 *
 *   'fixed'      … 従来どおり。ルーペ内の拡大率は常に一定（ズームしても
 *                  ルーペの中の大きさは変わらない）。
 *   'matchZoom'  … キャンバスを拡大するほど、ルーペの倍率も一緒に上がる
 *                  （さらに大きく拡大して見たい時向け）。
 *   'inverse'    … キャンバスを拡大するほど、ルーペの倍率は逆に下がる
 *                  （キャンバス側で既に十分拡大されているので、ルーペまで
 *                  過剰倍率にして粗いモザイクになるのを防ぐ）。
 */
export type LoupeZoomMode = 'fixed' | 'matchZoom' | 'inverse';

/**
 * ルーペの基準倍率（TouchLoupe の LOUPE_MAGNIFY 相当）。既定は 24。
 * loupeZoomMode が 'matchZoom'/'inverse' の時も、この値が拡大・縮小の
 * 基準点になる（PolygonEditor 側で LOUPE_MAGNIFY の代わりに使う）。
 * 設定画面の LoupeMagnifySlider で 12〜64 の範囲を 1 刻みの連続値として選ぶ
 * （プリセットへの丸め込みはしない）。
 */
export type LoupeBaseMagnify = number;

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
  /**
   * 初期背景除去の方式。既定 'flood'（従来の色ベースフラッドフィル）。
   * 'vision' は iOS Vision (VNGenerateForegroundInstanceMaskRequest, iOS17+実機のみ)。
   * スポイト・復元ブラシ・再透過・セル単位の調整はどちらを選んでも常に色ベースのまま
   * （Visionが関わるのは最初の1回の除去だけ）。
   */
  bgEngine: BgEngine;
  /**
   * 画像を選ぶたびに背景除去の方式をアクションシートで確認するか。既定 true。
   * falseにすると確認せず bgEngine をそのまま使う（Visionが使えない場合は
   * 呼び出し側が自動でflood-fillへフォールバックする）。
   */
  confirmBgEngineEachTime: boolean;
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
   * 復元ブラシ内の「消しゴム」トグルに一度でも触れたか。既定 false。
   * 復元ブラシの中に隠れている新機能なので、触るまでバッジで気づかせる。
   */
  hasSeenEraserTool: boolean;
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
  /**
   * ルーペのレティクル操作。既定は 'fixed'（従来の挙動）。
   *
   * 普段変える設定ではないので設定画面にだけ置く。編集中のドロップダウンに
   * 出すと、ツール切り替えのたびに目に入る割に押されない項目が増える。
   */
  loupeMode: LoupeMode;
  /** ルーペ倍率のズーム追従モード。既定は 'fixed'（従来の挙動）。 */
  loupeZoomMode: LoupeZoomMode;
  /**
   * ルーペにドットグリッド（マス目＋中央セルのハイライト）を出すか。
   * 1ドットが画面上で十分大きく見える時だけ自動で出る（常時ではない）ので、
   * この設定は「その自動表示機能自体を使うか」のON/OFF。既定 true。
   */
  loupeDotGrid: boolean;
  /** ルーペの基準倍率。既定 '24'（従来の LOUPE_MAGNIFY 固定値と同じ）。 */
  loupeBaseMagnify: LoupeBaseMagnify;
  /**
   * ルーペ基準サイズ（＝収納段階「大」の一辺 px）。範囲 80〜220。
   *
   * 「中」「収納」はここから比率で計算する（LoupeMagnifySlider ではなく
   * PolygonEditor 側で MEDIUM = 基準×0.75 / MINI = 基準×0.35 を都度算出する
   * ————固定値をそれぞれ持たないのは、切り替えロジック(大→中→収納)を
   * 一切変えずに済ませるため。将来 端末ごとに既定値を変える(iPhone SE は
   * 小さめ、iPad は大きめ等)場合も、この1値を差し替えるだけでよい）。
   */
  loupeBaseSize: number;
  /**
   * 復元ブラシ等の初期の太さ（画像px・直径）。範囲 1〜80。
   * PolygonEditor の BRUSH_MIN_PX/BRUSH_MAX_PX と同じ範囲を使う。
   */
  brushDefaultPx: number;
  /**
   * 編集開始時に元画像の透かし（ゴースト表示）をONにしておくか。既定 true。
   * セッション中はツールバーからいつでも切り替えられる。この設定はその初期値のみを決める。
   */
  ghostDefaultOn: boolean;
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
  bgEngine:       'flood',
  confirmBgEngineEachTime: true,
  gridColumns:    3,
  thumbBg:        'checker',
  splitLineColor: '#007AFF',
  autoDeleteOnExport: true,
  skipPolygonTutorial: false,
  hasSeenOnboarding: false,
  hasSeenEraserTool: false,
  albumName: null,
  albumNameHistory: [],
  language: 'auto',
  appIcon: 'day',
  splashEnabled: true,
  splashAnimation: 'auto',
  loupeMode: 'fixed',
  loupeZoomMode: 'fixed',
  loupeDotGrid: true,
  loupeBaseMagnify: 24,
  loupeBaseSize: 160,
  brushDefaultPx: 30,
  ghostDefaultOn: true,
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
    const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    // loupeBaseMagnify は以前バージョンで文字列（'24' 等）を保存していたことがあるため、
    // 読み込み時に数値へ寄せる（壊れていたら既定値にフォールバック）。
    merged.loupeBaseMagnify = Number(merged.loupeBaseMagnify) || DEFAULTS.loupeBaseMagnify;
    // loupeBaseSize も同様に数値へ寄せつつ、スライダーの範囲(80〜220)にクランプする
    // （旧バージョンの値や手編集された値が範囲外でも安全に収める）。
    merged.loupeBaseSize = Math.min(220, Math.max(80,
      Number(merged.loupeBaseSize) || DEFAULTS.loupeBaseSize));
    // 'drag'（ドラッグ調整）は選択肢UIから外したが、型からは外していない
    // （既存ユーザーの保存済み設定が 'drag' の場合があるため）。実装
    // （PolygonEditor.tsx の drag_reticle 等）はそのまま残っているので、
    // 型を緩めずとも動作はするが、選び直す手段が無くなった利用者のために
    // 読み込み時点で 'adjust' へフォールバックしておく。
    if (merged.loupeMode === 'drag') {
      merged.loupeMode = 'adjust';
    }
    return merged;
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
