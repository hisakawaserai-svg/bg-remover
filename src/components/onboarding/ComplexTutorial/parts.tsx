/**
 * parts.tsx — 複雑な画像チュートリアルの共有パーツ
 *
 * STEP2(合体) と STEP3(締め) で同じ見た目を使い回すための置き場。
 * ここに集約しておけば、片方だけ直して見た目がズレることがない。
 *
 * 収録:
 *   ・グリッドの寸法定数(セル幅・キャラサイズ)
 *   ・カット1枚ぶんのセル(Cell)
 *   ・ポリゴン編集画面のモック(EditorMock)
 *   ・両ステップで使う共通スタイル(ui)
 *
 * Android白化対策の方針は各ステップと同じ:
 *   height/width/borderWidth は動かさず、transform と opacity のみで動かす。
 *   選択枠は「静的な borderWidth を持つオーバーレイの opacity」で出し入れする。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialIcons';
import BirdMascot from '../BirdMascot';
import TouchIndicator from '../TouchIndicator';
import { FRAME_W } from '../shared';
import { useT } from '../../../i18n';

// ── グリッドの寸法 ────────────────────────────────────────────────────────────
// frame の内側(padding) を2列 + gap で割る。
export const BODY_PAD = 16;
export const GRID_GAP = 10;
export const INNER_W = FRAME_W - BODY_PAD * 2;
export const CELL = (INNER_W - GRID_GAP) / 2;
/** セル内のキャラ。セルより一回り小さくして余白を作る。 */
export const BIRD = Math.round(CELL * 0.62);

/**
 * カット1枚ぶんのセル。連番バッジ + 任意で選択枠(オレンジ)。
 * 選択枠は静的な borderWidth を持つオーバーレイで、opacity だけで出し入れする
 * (borderWidth を動かすと Android で再レイアウトが走って白くなるため)。
 */
export function Cell({
  index,
  selectedStyle,
  wide = false,
  children,
}: {
  index: number;
  selectedStyle?: ReturnType<typeof useAnimatedStyle>;
  /** 合体後など、下段いっぱいに広げる場合 */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[ui.cell, wide && ui.cellWide]}>
      {children}
      <View style={ui.numBadge}><Text style={ui.numBadgeTxt}>{index}</Text></View>
      {selectedStyle && (
        <>
          <Animated.View style={[ui.selOverlay, selectedStyle]} pointerEvents="none" />
          <Animated.View style={[ui.checkBadge, selectedStyle]} pointerEvents="none">
            <Icon name="check" size={12} color="#FFF" />
          </Animated.View>
        </>
      )}
    </View>
  );
}

/**
 * ポリゴン編集画面のモック。
 *
 * 描き方そのものは既存の PolygonTutorialScreen(範囲を調整の使い方)が説明しているので、
 * ここでは「分割結果からタップで入れる / 整えたらプレビューで戻る」という
 * 出入り口だけを見せる。中の操作は描かない。
 *
 * previewTap を渡すと「プレビュー」ボタンにタップ表現が出る。
 */
export function EditorMock({
  progress,
  previewTap,
  subject,
}: {
  progress?: SharedValue<number>;
  previewTap?: [number, number];
  /**
   * キャンバスの中身。省略すると「囲み済みの静止画」を出す(STEP2 の入口用)。
   * STEP3 は四角を描いていくアニメを差し込むためここを差し替える。
   */
  subject?: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <>
      <View style={ui.header}>
        <Text style={ui.headerSide}>{t('common.back')}</Text>
        <Text style={ui.headerTitle}>{t('complexTutorial.manualCrop')}</Text>
        <Icon name="settings" size={18} color="#007AFF" />
      </View>

      <View style={ui.editorCanvas}>
        {subject ?? (
          <View style={ui.editorSubject}>
            <BirdMascot variant="sleep" size={BIRD * 1.5} />
            {/* 囲みポリゴン(白枠)と頂点ハンドル */}
            {/* ハンドルは四角の角に「中心を合わせる」。polyBox は subject から
                6px 外側にあるので、12px の丸はさらに半径ぶん(6px)ずらして -12 に置く。
                -6 のままだと丸の中心が角より内側に寄ってズレて見える。*/}
            <View style={ui.polyBox} pointerEvents="none" />
            <View style={[ui.vtx, { top: -12, left: -12 }]} />
            <View style={[ui.vtx, { top: -12, right: -12 }]} />
            <View style={[ui.vtx, { bottom: -12, left: -12 }]} />
            <View style={[ui.vtx, { bottom: -12, right: -12 }]} />
          </View>
        )}
      </View>

      <View style={ui.editorBar}>
        <View style={ui.editorTool}><Icon name="undo" size={16} color="#000" /></View>
        <View style={ui.editorTool}><Icon name="redo" size={16} color="#8E8E93" /></View>
        <View style={ui.editorTool}><Icon name="delete" size={16} color="#8E8E93" /></View>
        <View style={ui.editorPreviewBtn}>
          <Icon name="save-alt" size={14} color="#FFF" />
          <Text style={ui.editorPreviewTxt}>{t('editor.goToSaveLabel')}</Text>
          {progress && previewTap && (
            <TouchIndicator progress={progress} window={previewTap} />
          )}
        </View>
      </View>
    </>
  );
}

// ── 共通スタイル ──────────────────────────────────────────────────────────────
export const ui = StyleSheet.create({
  // ヘッダー(戻る / タイトル / 設定)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E3E3E8',
  },
  headerSide: { fontSize: 14, color: '#007AFF', minWidth: 40 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },

  body: { flex: 1, padding: BODY_PAD, gap: GRID_GAP },

  // セクション見出し
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: '#8E8E93' },
  sectionHint: { fontSize: 13, color: '#007AFF' },
  sectionHintOverlay: { position: 'absolute', right: 0, top: 0 },

  // グリッド
  gridRow: { flexDirection: 'row', gap: GRID_GAP },

  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // 合体後は下段いっぱいの1枚になる
  cellWide: { width: INNER_W },

  // 連番バッジ(左上)
  numBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  // 選択枠(オレンジ) + チェック
  selOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 12,
    borderWidth: 2.5,
    borderColor: '#FF9500',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF9500',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── フッター(ResultScreen 準拠) ───────────────────────────────────────────
  // 「リセット」と「保存する」を1行に横並び。リセットが flex:1、保存が flex:2。
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  actionBtnTxt: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  // 行の中に入る保存ボタン(リセットの2倍幅)
  saveBtn: {
    flex: 2,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },

  primaryBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  mergeIcon: { marginRight: 6 },
  cancelBtn: {
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C6C6C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: { color: '#8E8E93', fontSize: 14, fontWeight: '600' },

  // ── ポリゴン編集画面(モック) ──────────────────────────────────────────────
  editorCanvas: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorSubject: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  polyBox: {
    position: 'absolute',
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  vtx: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  editorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F2F2F7',
  },
  editorTool: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPreviewBtn: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  editorPreviewTxt: { color: '#FFF', fontSize: 13, fontWeight: '600' },
});
