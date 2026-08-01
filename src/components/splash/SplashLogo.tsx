/**
 * SplashLogo.tsx — スプラッシュ末尾に出す文字ロゴ
 *
 * 画像アセットは持たず、i18n の app.name をそのまま出す。
 * useT() を使うので日本語/英語の切り替えにそのまま追従する。
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import type { AnimatedProps } from 'react-native-reanimated';
import type { ViewProps } from 'react-native';
import { useT } from '../../i18n';

interface Props {
  /** 親から渡すアニメーションスタイル(フェード＋せり上がり)。 */
  style?: AnimatedProps<ViewProps>['style'];
}

export default function SplashLogo({ style }: Props) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  // 画面幅なりの大きさにする。英語の 'Sticker Cutout' は日本語より長いので、
  // 1行に収まるよう numberOfLines と adjustsFontSizeToFit で縮める。
  const fontSize = Math.round(Math.min(44, Math.max(28, width * 0.105)));

  return (
    <Animated.View style={style} pointerEvents="none">
      <Text
        style={[styles.text, { fontSize }]}
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {t('app.name')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  text: {
    // 実際の大きさは画面幅から決める(上の fontSize)。
    paddingHorizontal: 24,
    fontWeight: '800',
    // チェッカー(白〜薄グレー)の上に出るので濃い文字色で固定する。
    color: '#1C1C1E',
    letterSpacing: 2,
    textAlign: 'center',
  },
});
