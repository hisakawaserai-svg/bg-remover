/**
 * SpeechBubble.tsx — オンボーディング共通「ナビゲーターキャラ＋吹き出し」(案B)
 *
 * 見た目:
 *   - ブランドブルー塗りの角丸吹き出し。左端に白丸＋青のステップ番号。
 *   - 本文は白文字 weight 500。
 *   - しっぽ(三角)を話し手(BirdMascot)の方向へ向ける。
 *       direction='left'  : キャラが左 → しっぽ左向き  [キャラ][吹き出し]
 *       direction='right' : キャラが右 → しっぽ右向き  [吹き出し][キャラ]
 *
 * アニメは親から渡す style で制御(transform/opacity のみ・白化回避):
 *   - mascotStyle : キャラの presence(opacity) ＋「ピョン」(translateY)
 *   - bubbleStyle : 吹き出しの speak/silence(opacity)
 *   ※キャラは沈黙中も表示のまま、吹き出しだけ消す設計(opacity を別管理)。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import BirdMascot from './BirdMascot';
import { COLORS, NAV_MASCOT, FRAME_W } from './shared';

interface Props {
  stepNumber: number;
  text: string;
  direction: 'left' | 'right';
  mascotVariant?: 'day' | 'night';
  mascotSize?: number;
  mascotStyle?: AnimatedStyle<ViewStyle>;
  bubbleStyle?: AnimatedStyle<ViewStyle>;
}

export default function SpeechBubble({
  stepNumber,
  text,
  direction,
  mascotVariant = 'day',
  mascotSize = NAV_MASCOT,
  mascotStyle,
  bubbleStyle,
}: Props) {
  const mascot = (
    <Animated.View style={mascotStyle}>
      <BirdMascot variant={mascotVariant} size={mascotSize} />
    </Animated.View>
  );

  const bubble = (
    <Animated.View style={[s.bubbleWrap, bubbleStyle]}>
      {/* しっぽ(三角)は吹き出しの「兄弟」にして、row(alignItems:center)で縦中央に置く。
          absolute top:'50%' は Android で解決されず上端に寄る(=行数で位置がズレる)ため、
          flex で中央寄せして行数に依らず常に箱の縦中央へ向かせる。 */}
      <View style={s.bubbleRow}>
        {direction === 'left' && <View style={[s.tail, s.tailLeft]} />}
        <View style={s.bubble}>
          <View style={s.numCircle}>
            <Text style={s.numTxt}>{stepNumber}</Text>
          </View>
          <Text style={s.text} numberOfLines={2}>{text}</Text>
        </View>
        {direction === 'right' && <View style={[s.tail, s.tailRight]} />}
      </View>
    </Animated.View>
  );

  return (
    <View style={s.row}>
      {direction === 'left' ? mascot : bubble}
      {direction === 'left' ? bubble : mascot}
    </View>
  );
}

const TAIL = 7;

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // 幅をフレーム幅で固定する。中央寄せ(content幅)だと bubble が縮まず画面外へ
    // ずれるため、行の幅を確定させ、キャラは左固定・吹き出しは残り幅で折り返させる。
    width: FRAME_W,
    alignSelf: 'center',
    gap: 10,            // しっぽ(7px)がキャラと吹き出しの隙間に収まる幅
    paddingHorizontal: 12,
  },
  bubbleWrap: {
    flex: 1,                  // 残り幅を「上限」として使う(折り返し用)
    alignItems: 'flex-start', // 吹き出しは中身に合わせて左寄せ(横いっぱいに伸ばさない)
    justifyContent: 'center',
  },
  // しっぽ+吹き出しを横並びにし、縦中央で揃える(行数に依らずしっぽが箱中央を向く)
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',  // 中身ぶんだけの幅
    maxWidth: '100%',         // 残り幅で頭打ち → テキストが折り返す
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,            // 残り幅で頭打ち → テキストが折り返す
    gap: 10,
    backgroundColor: COLORS.brandBlue,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  // 白丸＋青番号
  numCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numTxt: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.brandBlue,
  },
  text: {
    flexShrink: 1,
    color: COLORS.bubbleText,
    fontSize: 14,
    fontWeight: '500',
  },
  // しっぽ(三角) — row の縦中央に並ぶ。左向き/右向きで色の付く辺を変える。
  tail: {
    width: 0,
    height: 0,
    borderTopWidth: TAIL,
    borderBottomWidth: TAIL,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  tailLeft: {
    marginRight: -1,          // 箱と隙間なく接する
    borderRightWidth: TAIL,
    borderRightColor: COLORS.brandBlue,
  },
  tailRight: {
    marginLeft: -1,           // 箱と隙間なく接する
    borderLeftWidth: TAIL,
    borderLeftColor: COLORS.brandBlue,
  },
});
