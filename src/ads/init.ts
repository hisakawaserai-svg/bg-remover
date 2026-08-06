/**
 * init.ts — Google Mobile Ads SDK の初期化
 *
 * consent.ts の gatherAdsConsentAndInit() から、同意フロー完了後に一度だけ
 * 呼ばれる（以前は index.js から起動直後に呼んでいたが、UMP/ATT の同意を
 * 取ってから初期化する順序に変えた）。initialize() は SDK 内部で冪等だが、
 * 呼び出し箇所を1つに保つためここに閉じ込める。
 *
 * 初期化を待たずに BannerAd を描画してもよい（SDK 側でキューされる）ため、
 * await せず投げっぱなしにする。失敗しても広告が出ないだけでアプリは動くので、
 * ここで例外を外に漏らさない。
 */
import mobileAds from 'react-native-google-mobile-ads';

export function initAds(): void {
  mobileAds()
    .initialize()
    .catch(e => {
      console.warn('[ads] initialize failed:', e);
    });
}
