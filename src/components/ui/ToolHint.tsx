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
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  /**
   * 説明の下に追加のコントロール（スライダーやボタン等）を差し込みたい時に渡す。
   * 渡すと、説明行との間に横線(divider)を挟んで縦に積む。
   *
   * 渡した場合、通常の「1行に収まる細長いピル」の見た目（自動幅・角丸20・
   * pointerEvents="none"）ではタップ操作ができないので、幅いっぱい・角丸14の
   * カード寄りの見た目に切り替え、タップも通す。渡さない時（他画面での通常
   * 利用）は今まで通りの見た目・挙動のまま変えない。
   */
  children?: React.ReactNode;
  /**
   * 渡すと見出し行の右端に×ボタンを出す。children とセットで使う想定
   * （children 無しの通常表示は pointerEvents="none" で操作を一切受け付け
   * ないため、閉じるボタンだけ出しても押せない）。
   */
  onClose?: () => void;
  /**
   * タイトルのすぐ右（区切り線・説明の前）に差し込む小さなコントロール。
   * 「収納中（畳んだ状態）でも値と増減ボタンだけは同じ行に出したい」
   * ケース向け（例: 復元ブラシの太さ・スポイトの許容値）。
   * children と違って行を増やさない・見た目もピルのまま変えない。
   */
  titleExtra?: React.ReactNode;
}

export default function ToolHint({ icon, title, desc, bottom = 12, children, onClose, titleExtra }: Props) {
  const interactive = children != null || titleExtra != null || onClose != null;
  return (
    <View
      style={[styles.wrap, children != null && styles.wrapExpanded, { bottom }]}
      pointerEvents={interactive ? 'box-none' : 'none'}
    >
      <View style={styles.headRow}>
        <Icon name={icon} size={15} color="#FFF" />
        <Text style={styles.title}>{title}</Text>
        {titleExtra}
        <View style={styles.sep} />
        <Text style={styles.desc}>{desc}</Text>
        {onClose != null && (
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="close" size={16} color="rgba(255,255,255,0.8)" />
          </Pressable>
        )}
      </View>
      {children != null && (
        <>
          <View style={styles.divider} />
          {children}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    maxWidth: '92%',
    // 再透過のなぞり用透明レイヤー(PolygonEditor 側 zIndex:1)より必ず
    // 上に来るように。無いと children ありの時にタップが奪われることがある
    // （詳しくは PolygonEditor.tsx の busyOverlay/panelSlot の zIndex コメント参照）。
    zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  // children がある時だけ効く見た目の上書き。ピル(自動幅・丸め強め)から
  // カード(幅いっぱい・丸め弱め)へ。
  wrapExpanded: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    paddingVertical: 10,
    // 文字が読みやすいよう、通常のピルよりほんの少しだけ濃くする。
    backgroundColor: 'rgba(0,0,0,0.74)',
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeBtn: { marginLeft: 'auto', flexShrink: 0 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 8,
  },
  title: { fontSize: 13, fontWeight: '700', color: '#FFF', letterSpacing: 0.2 },
  sep: { width: StyleSheet.hairlineWidth, height: 12, backgroundColor: 'rgba(255,255,255,0.45)' },
  desc: { fontSize: 12, color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
});
