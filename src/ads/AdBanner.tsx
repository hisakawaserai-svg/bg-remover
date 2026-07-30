/**
 * AdBanner.tsx — アンカー型バナー広告
 *
 * 置き場所は Screen の footer（ScrollView の外）に限定する。スクロール領域内に
 * 置くとコンテンツと一緒に流れてしまい、アンカー型の想定から外れる。
 *
 * 設計上の判断:
 *   - BannerAd は style を転送しない仕様（ライブラリのコメント参照）なので、
 *     余白・区切り線は外側の View で持つ。
 *   - 上に区切り線と余白を入れて操作ボタンから離す。ボタンと広告が隣接すると
 *     誤タップを誘発し、AdMob のポリシー（accidental clicks）に触れる恐れがある。
 *
 * ※ TODO（暫定対応・テスト期間中のみ）:
 *   本来は広告が取れない時は高さ 0 で消す（空の灰色帯を残さない）べきだが、
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

export default function AdBanner() {
  // 実際に広告が描画されたか。これが true になるまでラベルを出す。
  const [loaded, setLoaded] = useState(false);
  // 読み込み失敗（ネットワーク不通・在庫なし）。以降 BannerAd は載せない。
  const [failed, setFailed] = useState(false);

  // 枠を出さない設定 かつ 失敗済み なら完全に消す（リリース時の本来の挙動）。
  if (failed && !KEEP_EMPTY_SLOT_VISIBLE) return null;

  // placeholder モードでは広告をリクエストしない（枠だけ）。
  const showBanner = AD_MODE === 'live' && !failed;

  return (
    // 未ロード中は枠の高さを確保しておく。読み込み完了を待たずに枠が見えるので、
    // 画面へ入った直後でも「広告の場所」が分かる（遷移直後に何も出ない問題の対策）。
    <View style={[styles.wrap, !loaded && styles.reserved]}>
      {showBanner && (
        <BannerAd
          unitId={BANNER_UNIT_ID}
          // アンカー型のアダプティブバナー。端末幅に対して最適な高さを SDK が決める。
          // ANCHORED_ADAPTIVE_BANNER は 16.4.0 で deprecated のため LARGE_ 側を使う。
          size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
          onAdLoaded={() => setLoaded(true)}
          onAdFailedToLoad={error => {
            // 失敗は想定内なので warn 止まりにする（Alert は出さない）。
            console.warn('[AdBanner] failed to load:', error.message);
            setFailed(true);
          }}
        />
      )}

      {/* ラベルは絶対配置にして高さに影響させない。広告が載ったら消える。 */}
      {!loaded && (
        <View style={styles.labelLayer} pointerEvents="none">
          <Text style={styles.labelTxt}>広告</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    // 上の操作ボタンと広告の間隔。誤タップ防止のため詰めすぎない。
    paddingTop: 8,
    backgroundColor: colors.bg,
    // 縮まないよう固定する。ホームのように footer に他の要素（主ボタン）が同居する
    // 画面では、これが無いと枠が押し潰されて他画面より小さく表示される。
    flexShrink: 0,
  },
  // 未ロード中に確保する高さ。アンカー型アダプティブバナーの実寸に近い値。
  // height ではなく minHeight にして、どの画面でも下限を確実に satisfy させる。
  reserved: {
    height: AD_PLACEHOLDER_HEIGHT,
    backgroundColor: colors.fill2,
  },
  labelLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelTxt: {
    color: colors.secondary,
    fontSize: 12,
  },
});
