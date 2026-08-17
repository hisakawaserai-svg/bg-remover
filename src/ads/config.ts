/**
 * config.ts — 広告ユニットIDとテスト設定の一元管理
 *
 * 本番のユニットIDを書く場所はここだけ。画面側は BANNER_UNIT_ID を参照する。
 *
 * __DEV__ では PROD 値を無視して必ずテストIDを返す。開発中に自分の本番ユニットを
 * 表示・タップすると AdMob の「無効なトラフィック」としてアカウント停止になり得るため、
 * 「開発ビルドからは本番IDに到達できない」構造にしてある（フラグ切り替えにしない）。
 *
 * 注意: アプリID（ca-app-pub-XXX~YYY、~ 区切り）とユニットID（ca-app-pub-XXX/YYY、
 * / 区切り）は別物。アプリIDは app.json 側で管理する。
 */
import { Platform } from 'react-native';
import { TestIds } from 'react-native-google-mobile-ads';

// TODO: AdMob 管理画面で発行したバナーのユニットIDを入れる。空のままならテストIDが使われる。
const PROD_BANNER_UNIT_ID = Platform.select({
  android: '',
  ios: 'ca-app-pub-3194046005390900/4765091103',
  default: '',
}) as string;

/**
 * Google が公開しているテスト用ユニットID。
 * ライブラリの TestIds がプラットフォーム別に公式値を持っているので、
 * 自分で文字列を書かずにこれを経由する（値が変わっても追従できる）。
 *
 * どのサイズで試すかを切り替えられるようにしてある。表示側の BannerAdSize と
 * 揃えること（アダプティブ表示なら ADAPTIVE_BANNER、固定320x50なら BANNER）。
 */
export const TEST_BANNER_UNIT_IDS = {
  /** アダプティブ（アンカー型・インライン型）用 */
  adaptive: TestIds.ADAPTIVE_BANNER,
  /** 固定サイズ（BANNER / LARGE_BANNER / MEDIUM_RECTANGLE など）用 */
  fixed: TestIds.BANNER,
} as const;

/**
 * テスト時にどちらのテストユニットを使うか。**表示サイズと必ず対応させる。**
 *
 * ここが AdBanner の BannerAdSize とずれると、その形に合わせて作られた
 * クリエイティブが違う寸法の枠に入り、広告内の文字が見切れる。
 * 実際 'adaptive' のまま表示側だけ固定320x50にしていた期間があり、
 * 端末幅前提のテスト広告が320ptに押し込まれて右端が切れていた。
 *
 * 現在の表示側: BannerAdSize.BANNER（固定320x50）→ 'fixed'
 */
const TEST_BANNER_KIND: keyof typeof TEST_BANNER_UNIT_IDS = 'fixed';

/** バナー用ユニットID。__DEV__ か本番ID未設定なら Google のテストIDになる。 */
export const BANNER_UNIT_ID =
  __DEV__ || !PROD_BANNER_UNIT_ID
    ? TEST_BANNER_UNIT_IDS[TEST_BANNER_KIND]
    : PROD_BANNER_UNIT_ID;

/**
 * 広告枠の動作モード。
 *
 *   'live'        — 実際に BannerAd を読み込む。__DEV__ ならユニットIDはテストIDになる。
 *                   開発ビルドで読み込みに失敗した場合だけ、代わりに枠を描く
 *                   （配信が来ない環境でも位置を確認できるようにするため）。
 *   'placeholder' — 広告をリクエストせず、常に固定枠だけを描く。レイアウト確認用。
 *                   「枠が出るまで数秒かかる」「画面を離れると出ない」という
 *                   タイミング依存が無くなるので、配置の検証はこちらが確実。
 *
 * リリースビルドでは常に 'live' に落とす。'placeholder' が本番に漏れると
 * 空の帯だけが居座って壊れて見えるため、__DEV__ を掛けて封じている。
 */
// 実機でテスト広告の表示を確認するため 'live' 固定にしている。
// ユニットIDは __DEV__ の間 Google のテストIDのままなので、自分の本番広告を
// 叩いてしまう事故（無効なトラフィック扱い）は起きない。
// レイアウトだけ確認したい時は 'placeholder' に戻す。
export const AD_MODE: 'live' | 'placeholder' = 'live';

/**
 * ※ 暫定対応（テスト期間中のみ true）
 *
 * true の間は、広告が取得できなくても枠を消さずに出しっぱなしにする。
 * リリースビルドでも枠を確認したいという要望のため、__DEV__ を掛けずに true にしてある。
 *
 * テストが終わったら false に戻すこと。true のまま公開すると、広告が配信されない
 * 端末やオフライン時に「広告」とだけ書かれた空の帯が常に居座り、壊れて見える。
 */
export const KEEP_EMPTY_SLOT_VISIBLE = false;

/**
 * バナー枠の高さ（固定）。
 *
 * BannerAdSize.BANNER = 320×50 の固定サイズを使うので、実寸は必ず 50。
 * それに「広告」ラベル行と上下の余白を足した値がこの定数。
 *   paddingTop 8 + ラベル 14 + 間 2 + バナー 50 = 74
 *
 * アダプティブバナーをやめて固定サイズにしたのは、アダプティブだと SDK が
 * 端末幅から高さを決めるため実寸が読めず、確保した枠と食い違って
 * 読み込み時にガクッと伸び縮みし、直上のボタンが動いて誤タップを招くため。
 */
export const AD_PLACEHOLDER_HEIGHT = 74;
