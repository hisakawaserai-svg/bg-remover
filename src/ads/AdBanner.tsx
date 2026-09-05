/**
 * AdBanner.tsx — 画面下に固定するアンカー型バナー
 *
 * 置き場所は Screen の footer（ScrollView の外）に限定する。スクロール領域内に
 * 置くとコンテンツと一緒に流れてしまい、アンカー型の想定から外れる。
 * ホームインジケータ分の下端余白は Screen 側が footer に付けているので、
 * ここでは持たない（二重に空けない）。
 *
 * 設計上の判断:
 *   - **ウィンドウ幅のアンカー型アダプティブ**を使う。頼む幅と枠の幅を同じに
 *     しないと、全幅向けクリエイティブが狭い枠に押し込まれて文字が切れる
 *     （以前、テストIDが adaptive のまま表示だけ 320×50 にしていた事故）。
 *     逆に 320 を scale で引き伸ばすのも同じ壊れ方をするのでやらない。
 *   - 高さは端末ごとにほぼ一定。先に 50 を確保し、onAdLoaded の実寸だけ枠を
 *     合わせる。読み込み前から 90 を空けると、多くの端末で空洞が目立つ。
 *   - 上に区切り線、左上に「広告」ラベルを常時出して、アプリの UI と
 *     見分けが付くようにする（広告と分からない配置はポリシー上の懸念になる）。
 *   - BannerAd は style を転送しない仕様なので、余白・区切り線は外側の View で持つ。
 *   - 広告の一部を隠すのはポリシー違反なので overflow:'hidden' は付けない。
 *   - 更新間隔はアプリでタイマーしない。AdMob 管理画面の自動更新（Google最適化）に任せる。
 */

import React, { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import {
  AD_MODE,
  BANNER_UNIT_ID,
  KEEP_EMPTY_SLOT_VISIBLE,
} from './config';
import { useAdsConsent } from './consent';
import { colors } from '../components/ui/theme';
import { useT } from '../i18n';

/** ラベル行と上下余白。バナー本体の高さは実寸で足す。 */
const CHROME_H = 8 + 14 + 2;
/** アンカー型アダプティブの典型的な高さ（スマホ縦）。実寸が来るまでこれで枠を取る。 */
const DEFAULT_BANNER_H = 50;

export default function AdBanner() {
  const { t } = useT();
  const { width: winW } = useWindowDimensions();
  // 整数幅で頼む。端数のまま渡すと、枠とクリエイティブが 1px ずれて切れやすい。
  const bannerW = Math.max(1, Math.floor(winW));
  const [bannerH, setBannerH] = useState(DEFAULT_BANNER_H);

  const { ready: consentReady, npa } = useAdsConsent();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed && !KEEP_EMPTY_SLOT_VISIBLE) return null;

  const showBanner = AD_MODE === 'live' && !failed && consentReady;

  return (
    <View style={[styles.wrap, { height: CHROME_H + bannerH }]}>
      <Text style={[styles.label, { width: bannerW }]}>{t('ads.label')}</Text>

      <View style={[styles.slot, { width: bannerW, height: bannerH }, !loaded && styles.slotEmpty]}>
        {showBanner && (
          <BannerAd
            // 幅が変わったら作り直す。古い幅で取った広告を新しい枠に入れない。
            key={bannerW}
            unitId={BANNER_UNIT_ID}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            width={bannerW}
            requestOptions={{ requestNonPersonalizedAdsOnly: npa }}
            onAdLoaded={dim => {
              setLoaded(true);
              if (dim.height > 0) setBannerH(dim.height);
            }}
            onSizeChange={dim => {
              if (dim.height > 0) setBannerH(dim.height);
            }}
            onAdFailedToLoad={error => {
              console.warn('[AdBanner] failed to load:', error.message);
              setFailed(true);
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingTop: 8,
    backgroundColor: colors.bg,
    flexShrink: 0,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.secondary,
    textAlign: 'left',
  },
  slot: {
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotEmpty: {
    backgroundColor: colors.fill2,
    borderRadius: 4,
  },
});
