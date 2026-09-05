/**
 * interstitial.ts — 全画面広告（いまは出さない）
 *
 * 保存直後に出していたが、作業の区切りで全面を奪うのが強すぎたので停止。
 * 保存完了は AdMrec（300×250）。このファイルの全画面は呼び出していない。
 *
 * 先読みしておき、閉じたら次をすぐ読み始める。アプリ側で連打防止の秒数は持たない
 * （保存自体が稀なので。頻度上限は AdMob 管理画面で掛けられる）。
 *
 * 同意完了後にだけリクエストする。consent.ts から先読みし、ここからは consent を
 * import しない（循環参照を避ける）。
 */
import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';
import { AD_MODE, INTERSTITIAL_UNIT_ID } from './config';

let ad: InterstitialAd | null = null;
let loaded = false;
let loading = false;
let lastNpa = false;

export function preloadInterstitial(npa?: boolean): void {
  if (AD_MODE !== 'live' || !INTERSTITIAL_UNIT_ID) return;
  if (npa !== undefined) lastNpa = npa;
  if (loaded || loading) return;

  const next = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
    requestNonPersonalizedAdsOnly: lastNpa,
  });
  ad = next;
  loading = true;
  loaded = false;

  const unsub = next.addAdEventListener(AdEventType.LOADED, () => {
    loaded = true;
    loading = false;
    unsub();
  });
  next.addAdEventListener(AdEventType.ERROR, error => {
    loading = false;
    loaded = false;
    ad = null;
    console.warn('[ads] interstitial failed to load:', error);
  });
  next.addAdEventListener(AdEventType.CLOSED, () => {
    loaded = false;
    ad = null;
    preloadInterstitial();
  });

  next.load();
}

/**
 * 読み込み済みなら出す。未準備・失敗なら何もしない（保存フローを待たせない）。
 */
export function showInterstitialIfReady(): void {
  if (!ad || !loaded) {
    preloadInterstitial();
    return;
  }
  loaded = false;
  ad.show().catch(e => {
    console.warn('[ads] interstitial failed to show:', e);
    ad = null;
    preloadInterstitial();
  });
}
