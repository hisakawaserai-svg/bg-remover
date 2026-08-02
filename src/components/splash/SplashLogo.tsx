/**
 * SplashLogo.tsx — スプラッシュ末尾に出す文字ロゴ
 *
 * 画像アセットは持たず、i18n の app.name をそのまま出す。
 * useT() を使うので日本語/英語の切り替えにそのまま追従する。
 *
 * 背面に半透明のカードを敷く理由:
 *   演出の後半は下にホーム画面(説明文やカード)が透けて見えるため、文字だけだと
 *   背景の文字と重なって読めない。ガラス風のカードを1枚挟んで可読性を確保する。
 *
 * ぼかし(backdrop blur)について:
 *   RN 単体には backdrop-filter が無く、Skia の Canvas も配下の RN ビューを
 *   サンプリングできないため、**本物のぼかしは入れていない**。白の半透明＋
 *   上側だけ明るいハイライト＋縁取り＋影で、ガラスらしい見え方を作っている。
 */
import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
      <View style={styles.card}>
        {/* ハイライト: 上半分だけ明るくしてガラスの厚みを出す。 */}
        <View style={styles.gloss} pointerEvents="none" />
        <Text
          style={[styles.text, { fontSize }]}
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {t('app.name')}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 22,
    overflow: 'hidden',
    // 背景を完全には隠さない濃さ。下のホーム画面がうっすら透ける。
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.9)',
    // 浮いて見せる影(iOS は shadow*、Android は elevation)。
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  gloss: {
    ...StyleSheet.absoluteFill,
    bottom: '45%',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  text: {
    fontWeight: '800',
    // 明るいシーン色やホーム画面(薄グレー)の上に出るので濃い文字色で固定する。
    color: '#1C1C1E',
    letterSpacing: 2,
    textAlign: 'center',
  },
});
