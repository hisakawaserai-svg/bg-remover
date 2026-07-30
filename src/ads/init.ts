/**
 * init.ts — Google Mobile Ads SDK の初期化
 *
 * index.js から一度だけ呼ぶ。initialize() は SDK 内部で冪等だが、
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
