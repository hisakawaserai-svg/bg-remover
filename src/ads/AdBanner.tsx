/**
 * AdBanner.tsx — アンカー型バナー広告
 *
 * 置き場所は Screen の footer（ScrollView の外）に限定する。スクロール領域内に
 * 置くとコンテンツと一緒に流れてしまい、アンカー型の想定から外れる。
 * ホームインジケータ分の下端余白は Screen 側が footer に付けているので、
 * ここでは持たない（二重に空けない）。
 *
 * 設計上の判断:
 *   - **固定サイズ(320×50)を使う**。アダプティブバナーは SDK が端末幅から高さを
 *     決めるため実寸が事前に読めず、確保した枠と食い違って読み込み時に
 *     ガクッと伸び縮みする。直上のボタンが動くと誤タップを招き、
 *     AdMob の accidental clicks ポリシーに触れる恐れがある。
 *   - 枠の高さは読み込み状態に関わらず**常に固定**。載る前後で動かさない。
 *   - 上に区切り線、左上に「広告」ラベルを**常時**出して、アプリの UI と
 *     見分けが付くようにする（広告と分からない配置はポリシー上の懸念になる）。
 *   - BannerAd は style を転送しない仕様なので、余白・区切り線は外側の View で持つ。
 *   - 広告の一部を隠すのはポリシー違反なので overflow:'hidden' は付けない。
 *
 * ※ TODO（暫定対応・テスト期間中のみ）:
 *   本来は広告が取れない時は高さ 0 で消す（空の帯を残さない）べきだが、
 *   今は配置確認のため「広告が無くても枠を出しっぱなしにする」挙動にしている。
 *   要望により __DEV__ を掛けていないので **リリースビルドでも枠が出る**。
 *   公開前に KEEP_EMPTY_SLOT_VISIBLE を false に戻すこと。
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import {
  AD_MODE,
  AD_PLACEHOLDER_HEIGHT,
  BANNER_UNIT_ID,
  KEEP_EMPTY_SLOT_VISIBLE,
} from './config';
import { colors } from '../components/ui/theme';
import { useT } from '../i18n';

/** 固定バナーの実寸。BannerAdSize.BANNER = 320×50。 */
const BANNER_W = 320;
const BANNER_H = 50;

export default function AdBanner() {
  const { t } = useT();
  // 実際に広告が描画されたか。これが true になるまで枠に下地を敷く。
  const [loaded, setLoaded] = useState(false);
  // 読み込み失敗（ネットワーク不通・在庫なし）。以降 BannerAd は載せない。
  const [failed, setFailed] = useState(false);

  // 枠を出さない設定 かつ 失敗済み なら完全に消す（リリース時の本来の挙動）。
  if (failed && !KEEP_EMPTY_SLOT_VISIBLE) return null;

  // placeholder モードでは広告をリクエストしない（枠だけ）。
  const showBanner = AD_MODE === 'live' && !failed;

  return (
    <View style={styles.wrap}>
      {/* 「広告」ラベルは常時表示。載る前後で高さが変わらないよう固定の行にする。 */}
      <Text style={styles.label}>{t('ads.label')}</Text>

      {/* バナーの置き場。320×50 を必ず確保するので、載っても枠は動かない。 */}
      <View style={[styles.slot, !loaded && styles.slotEmpty]}>
        {showBanner && (
          <BannerAd
            unitId={BANNER_UNIT_ID}
            // 固定サイズ(320×50)。端末によらず実寸が変わらないのでレイアウトがズレない。
            size={BannerAdSize.BANNER}
            onAdLoaded={() => setLoaded(true)}
            onAdFailedToLoad={error => {
              // 失敗は想定内なので warn 止まりにする（Alert は出さない）。
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
    // 高さは常に固定。読み込み状態で変えない（load 時のガタつき防止）。
    height: AD_PLACEHOLDER_HEIGHT,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    // 上の操作ボタンと広告の間隔。誤タップ防止のため詰めすぎない。
    paddingTop: 8,
    backgroundColor: colors.bg,
    // 縮まないよう固定する。ホームのように footer に他の要素（主ボタン）が同居する
    // 画面では、これが無いと枠が押し潰されて他画面より小さく表示される。
    flexShrink: 0,
  },
  // 「広告」ラベル。バナー幅に左揃えで載せ、アプリUIとの区別を明示する。
  label: {
    width: BANNER_W,
    fontSize: 10,
    lineHeight: 14,
    color: colors.secondary,
    textAlign: 'left',
  },
  slot: {
    width: BANNER_W,
    height: BANNER_H,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 未ロード中だけ下地を敷いて枠の位置を示す（高さは動かさない）。
  slotEmpty: {
    backgroundColor: colors.fill2,
    borderRadius: 4,
  },
});
