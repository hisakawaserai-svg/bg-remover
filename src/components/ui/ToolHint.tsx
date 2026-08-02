/**
 * ToolHint.tsx — 「今どのツールで、何ができるか」を示すピル
 *
 * プレビュー／キャンバスの下端中央に常時出す。アイコンだけだと何のツールか
 * 分からず、操作モードによっては画面に何も出ていなくて寂しかったので、
 * 「アイコン＋ツール名＋やること」を1行で示す。
 *
 * 範囲調整(PolygonEditor)と分割設定(SetupScreen)の両方で使う。
 * 同じ役割のツールには同じアイコンを割り当てること（下の TOOL_ICONS 参照）。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

/**
 * 画面をまたいで共通のアイコン。
 * 同じ操作には同じ絵を使い、画面が変わっても迷わないようにする。
 */
export const TOOL_ICONS = {
  /** 位置を動かす系（四角のドラッグ／分割線のドラッグ）*/
  move: 'pan-tool',
  /** 四角を追加する */
  draw: 'edit',
  /** スポイト（色を消す）*/
  eyedropper: 'colorize',
} as const;

interface Props {
  icon: string;
  title: string;
  desc: string;
  /**
   * 画面下端からの距離(px)。既定 12。
   * 下部に別のバー（ズームバーなど）を置く画面で、重ならないよう上へ逃がすために使う。
   */
  bottom?: number;
}

export default function ToolHint({ icon, title, desc, bottom = 12 }: Props) {
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none">
      <Icon name={icon} size={15} color="#FFF" />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.sep} />
      <Text style={styles.desc}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '92%',
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  title: { fontSize: 13, fontWeight: '700', color: '#FFF', letterSpacing: 0.2 },
  sep: { width: StyleSheet.hairlineWidth, height: 12, backgroundColor: 'rgba(255,255,255,0.45)' },
  desc: { fontSize: 12, color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
});
