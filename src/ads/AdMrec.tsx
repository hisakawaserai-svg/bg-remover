/**
 * AdMrec.tsx — 保存完了に置く 300×250 の中四角広告
 *
 * 全画面広告の代わり。引き伸ばさない（枠とクリエイティブの寸法を揃える）。
 * 読み込み失敗時は枠を消す（KEEP_EMPTY_SLOT_VISIBLE のときだけ残す）。
 * 広告の一部を隠すのはポリシー違反なので overflow:'hidden' は付けない。
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import {
  AD_MODE,
  KEEP_EMPTY_SLOT_VISIBLE,
  MREC_HEIGHT,
  MREC_UNIT_ID,
  MREC_WIDTH,
} from './config';
import { useAdsConsent } from './consent';
import { colors } from '../components/ui/theme';
import { useT } from '../i18n';

const CHROME_H = 8 + 14 + 2;

export default function AdMrec() {
  const { t } = useT();
  const { ready: consentReady, npa } = useAdsConsent();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!MREC_UNIT_ID) return null;
  if (failed && !KEEP_EMPTY_SLOT_VISIBLE) return null;

  const showAd = AD_MODE === 'live' && !failed && consentReady;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('ads.label')}</Text>
      <View style={[styles.slot, !loaded && styles.slotEmpty]}>
        {showAd && (
          <BannerAd
            unitId={MREC_UNIT_ID}
            size={BannerAdSize.MEDIUM_RECTANGLE}
            requestOptions={{ requestNonPersonalizedAdsOnly: npa }}
            onAdLoaded={() => setLoaded(true)}
            onAdFailedToLoad={error => {
              console.warn('[AdMrec] failed to load:', error.message);
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
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: CHROME_H + MREC_HEIGHT,
    backgroundColor: colors.bg,
    flexShrink: 0,
  },
  label: {
    width: MREC_WIDTH,
    fontSize: 10,
    lineHeight: 14,
    color: colors.secondary,
    textAlign: 'left',
  },
  slot: {
    width: MREC_WIDTH,
    height: MREC_HEIGHT,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotEmpty: {
    backgroundColor: colors.fill2,
    borderRadius: 4,
  },
});
