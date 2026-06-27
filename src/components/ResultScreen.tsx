/**
 * ResultScreen.tsx — 自動分割の結果確認画面
 *
 * インタラクション:
 *   通常モード  : 短押し → セル編集(PolygonEditor)  / 長押し → 選択モード突入
 *   選択モード  : 短押し/長押し → 選択トグル
 *   フッター    : 通常=保存、選択モード=合体+キャンセル
 *
 * 選択 state(selectingMode / selectedIndices) と画像ソース(imgSource) は完全に独立。
 * selectedIndices が変わっても Image の source prop は再生成されない。
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import { colors, spacing, radius, shadow, typography } from './ui/theme';
import CheckerboardBg from './ui/CheckerboardBg';
import { useThumbBg } from '../hooks/useThumbBg';
import type { Cell } from '../cellTypes';
import type { BBox } from '../imaging';

// ── 定数 ─────────────────────────────────────────────────────────────────────

/** 位置ベースレイアウト: セルの最小表示サイズ(px) */
const MIN_CELL = 44;

// ── 隣接判定 ─────────────────────────────────────────────────────────────────

/**
 * 選択セルの union bbox 内に「選択外の auto セル」が一切入らないことを確認する。
 *
 * 旧実装(BFS 連結性)はギャップ許容値で隣接を判定していたため、
 * 離れた2枚でも「連結」と判定されて union bbox に選択外カットが写り込む問題があった。
 * 本実装は union bbox への侵入そのものを禁止することで写り込みを根本的に防ぐ。
 *
 * poly セル(bbox なし)が選択に含まれると false を返す。
 */
function noUnselectedInUnion(cells: Cell[], indices: number[]): boolean {
  if (indices.some(i => cells[i]?.kind !== 'auto')) return false;

  type AutoCell = Cell & { kind: 'auto' };
  const selected = indices.map(i => cells[i] as AutoCell);
  const minX = Math.min(...selected.map(c => c.bbox.minX));
  const minY = Math.min(...selected.map(c => c.bbox.minY));
  const maxX = Math.max(...selected.map(c => c.bbox.maxX));
  const maxY = Math.max(...selected.map(c => c.bbox.maxY));

  const idxSet = new Set(indices);
  for (let i = 0; i < cells.length; i++) {
    if (idxSet.has(i)) continue;
    const c = cells[i];
    if (c.kind !== 'auto') continue; // poly は bbox なし: 判定外
    const b = c.bbox;
    // 行ごとに列境界が独立検出されるため、隣接列の bbox が union bbox と
    // 数px重なる（false positive）が発生する。bbox 境界ではなく中心点で
    // 「このセルが union 内に位置するか」を判定することで境界のノイズを除去する。
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
      return false;
    }
  }
  return true;
}

// ── 定数 ─────────────────────────────────────────────────────────────────────

/** poly セル用フォールバックサイズ */
const POLY_CELL_SIZE = 100;

// ── CellItem ────────────────────────────────────────────────────────────────

interface CellItemProps {
  cell: Cell;
  index: number;
  width: number;
  height: number;
  posStyle?: object;
  selected: boolean;
  selectingMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function CellItem({
  cell, index, width, height, posStyle, selected, selectingMode, onPress, onLongPress,
}: CellItemProps) {
  const isMissing = cell.thumbUri === 'MISSING';
  const imgSource = useMemo(
    () => isMissing ? null : { uri: cell.thumbUri },
    [cell.thumbUri, isMissing],
  );
  const thumbBg = useThumbBg();

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={[styles.cellWrap, { width, height }, posStyle]}
    >
      <CheckerboardBg mode={thumbBg} tile={40} width={width} height={height} />
      {isMissing ? (
        // ファイル欠損: グレー背景 + アイコンでフォールバック表示
        <View style={[StyleSheet.absoluteFill, styles.missingOverlay]}>
          <Icon name="image-not-supported" size={24} color="#999" />
        </View>
      ) : (
        <Image
          source={imgSource!}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      )}
      {/* 複数入り警告枠（選択ハイライトより下層）*/}
      {cell.kind === 'auto' && cell.multipleObjects && !selected && (
        <View style={styles.multipleOverlay} pointerEvents="none" />
      )}
      {/* 選択ハイライト: Image の上に border overlay（borderWidth を wrapper に当てると白化するため）*/}
      {selected && <View style={styles.cellSelectedOverlay} pointerEvents="none" />}
      {/* 番号バッジ */}
      <View style={styles.numBadge}>
        <Text style={styles.numBadgeTxt}>{index + 1}</Text>
      </View>
      {/* 複数入り警告アイコン（右下）*/}
      {cell.kind === 'auto' && cell.multipleObjects && (
        <View style={styles.multipleBadge} pointerEvents="none">
          <Icon name="warning" size={13} color="#FFF" />
        </View>
      )}
      {/* チェックバッジ */}
      {selectingMode && selected && (
        <View style={styles.checkBadge}>
          <Icon name="check-circle" size={20} color="#FFF" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  cells: Cell[];
  originalImageUri: string;
  /** 元画像ピクセルサイズ。位置ベースレイアウトに使用。null=復元セッションで不明 */
  srcWidth: number | null;
  srcHeight: number | null;
  onBack: () => void;
  onHome: () => void;
  onSettings: () => void;
  onSave: () => Promise<void> | void;
  onReSplit: () => void;
  onManualSplit: () => void;
  onEditCell: (index: number) => void;   // 通常モードの短押しで呼ぶ編集フロー
  onMerge: (indices: number[]) => void;  // 選択モードで合体確定
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function ResultScreen({
  cells,
  originalImageUri,
  srcWidth,
  srcHeight,
  onBack,
  onHome,
  onSettings,
  onSave,
  onReSplit,
  onManualSplit,
  onEditCell,
  onMerge,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();

  const [saving,         setSaving]         = useState(false);
  const [zoomVisible,    setZoomVisible]    = useState(false);
  // 選択 state — 画像ソースとは完全に独立したオブジェクト
  const [selectingMode,  setSelectingMode]  = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // ── 位置ベースレイアウト計算 ────────────────────────────────────────────
  // 表示領域の幅 = 画面幅 - 左右パディング
  const layoutW = winW - spacing.lg * 2;

  // 元画像サイズが不明（復元セッション）の場合は bbox の最大値から推定
  const effectiveSrcW = useMemo((): number => {
    if (srcWidth) return srcWidth;
    let max = 0;
    for (const c of cells) {
      if (c.kind === 'auto') max = Math.max(max, c.bbox.maxX);
    }
    return max > 0 ? max : 1;
  }, [srcWidth, cells]);

  const effectiveSrcH = useMemo((): number => {
    if (srcHeight) return srcHeight;
    let max = 0;
    for (const c of cells) {
      if (c.kind === 'auto') max = Math.max(max, c.bbox.maxY);
    }
    return max > 0 ? max : 1;
  }, [srcHeight, cells]);

  // 表示領域の高さ（元画像のアスペクト比を保つ）
  const layoutH = layoutW * (effectiveSrcH / effectiveSrcW);

  // auto セルの位置情報（比率ベース → 表示px）
  const cellLayouts = useMemo(() =>
    cells.map((cell, i) => {
      if (cell.kind !== 'auto') return null;
      const { minX, minY, maxX, maxY } = cell.bbox;
      const left   = (minX / effectiveSrcW) * layoutW;
      const top    = (minY / effectiveSrcH) * layoutH;
      const width  = ((maxX - minX) / effectiveSrcW) * layoutW;
      const height = ((maxY - minY) / effectiveSrcH) * layoutH;
      // 極端に小さいセルにも最低タップサイズを確保
      return { left, top, width: Math.max(width, MIN_CELL), height: Math.max(height, MIN_CELL) };
    }),
  [cells, effectiveSrcW, effectiveSrcH, layoutW, layoutH]);

  // ── 保存 ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };

  // ── 選択 state 操作 ──────────────────────────────────────────────────────

  const toggleSelection = (i: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      // 0 枚になったら選択モードも解除
      if (next.size === 0) setSelectingMode(false);
      return next;
    });
  };

  const exitSelectingMode = () => {
    setSelectingMode(false);
    setSelectedIndices(new Set());
  };

  const handleCellPress = (i: number) => {
    if (selectingMode) {
      toggleSelection(i);
    } else {
      onEditCell(i); // 通常モード: PolygonEditor でセル編集
    }
  };

  const handleCellLongPress = (i: number) => {
    if (selectingMode) {
      toggleSelection(i); // 選択モード中は長押しもトグル
    } else {
      // 選択モードに突入し、そのセルを最初の選択に
      setSelectingMode(true);
      setSelectedIndices(new Set([i]));
    }
  };

  // ── 合体 ─────────────────────────────────────────────────────────────────

  const selectedArr = useMemo(() => Array.from(selectedIndices), [selectedIndices]);

  const anyPolySelected = useMemo(
    () => selectedArr.some(i => cells[i]?.kind !== 'auto'),
    [selectedArr, cells],
  );

  const canMerge = useMemo(() => {
    if (selectedArr.length < 2) return false;
    if (anyPolySelected) return false;
    return noUnselectedInUnion(cells, selectedArr);
  }, [selectedArr, anyPolySelected, cells]);

  const handleMergePress = () => {
    if (!canMerge) return;
    onMerge(selectedArr);
    exitSelectingMode();
  };

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  const header = (
    <AppHeader
      title="分割結果"
      onBack={onBack}
      backLabel="戻る"
      right={
        <HeaderActions
          showOriginalImage
          showHome
          showSettings
          onOriginalImage={() => setZoomVisible(true)}
          onHome={onHome}
          onSettings={onSettings}
        />
      }
    />
  );

  // ── レンダー ──────────────────────────────────────────────────────────────

  return (
    <Screen header={header} scrollable={false} style={{ paddingBottom: 0 }}>
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >

        {/* ── カット後（位置ベースレイアウト）─────────────────────────── */}
        <View style={styles.cutSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>カット後（{cells.length}枚）</Text>
            <Text style={styles.sectionHint}>
              {selectingMode
                ? `${selectedIndices.size}枚選択中`
                : '長押しで選択・合体'}
            </Text>
          </View>

          {/* 位置ベースレイアウト: auto セルを元画像内の矩形比率で絶対配置 */}
          <View style={[styles.posLayout, { width: layoutW, height: layoutH }]}>
            {cells.map((cell, i) => {
              const layout = cellLayouts[i];
              if (!layout) return null; // poly セルはここでは描画しない
              return (
                <CellItem
                  key={i}
                  cell={cell}
                  index={i}
                  width={layout.width}
                  height={layout.height}
                  posStyle={{ position: 'absolute', left: layout.left, top: layout.top }}
                  selected={selectedIndices.has(i)}
                  selectingMode={selectingMode}
                  onPress={() => handleCellPress(i)}
                  onLongPress={() => handleCellLongPress(i)}
                />
              );
            })}
          </View>

          {/* poly セル（bbox なし）は別セクションに表示 */}
          {cells.some(c => c.kind === 'poly') && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                手動分割
              </Text>
              <View style={styles.grid}>
                {cells.map((cell, i) => {
                  if (cell.kind !== 'poly') return null;
                  return (
                    <CellItem
                      key={i}
                      cell={cell}
                      index={i}
                      width={POLY_CELL_SIZE}
                      height={POLY_CELL_SIZE}
                      selected={selectedIndices.has(i)}
                      selectingMode={selectingMode}
                      onPress={() => handleCellPress(i)}
                      onLongPress={() => handleCellLongPress(i)}
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>

        {/* ── フッター ─────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          {selectingMode ? (
            /* ── 選択モード: キャンセル + 合体 ── */
            <>
              {/* 合体不可の理由を表示 */}
              {selectedArr.length >= 2 && !canMerge && (
                <Text style={styles.mergeWarning}>
                  {anyPolySelected
                    ? 'ポリゴン編集済みのカットは合体できません'
                    : 'すき間なく隣り合う2枚を選んでください'}
                </Text>
              )}
              <AnimatedPressable
                style={styles.saveBtn}
                onPress={handleMergePress}
                disabled={!canMerge}
                pressedScale={0.97}
              >
                <Icon name="merge-type" size={20} color="#FFF" style={{ marginRight: spacing.xs }} />
                <Text style={styles.saveBtnTxt}>
                  {selectedArr.length >= 2 ? `${selectedArr.length}枚を合体する` : '2枚以上選択してください'}
                </Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.cancelBtn}
                onPress={exitSelectingMode}
                pressedScale={0.97}
              >
                <Text style={styles.cancelBtnTxt}>キャンセル</Text>
              </AnimatedPressable>
            </>
          ) : (
            /* ── 通常モード: スライダー + アクション + 保存 ── */
            <>
              {/* 再分割 / 手動分割 */}
              <View style={styles.actionRow}>
                <AnimatedPressable style={styles.actionBtn} onPress={onReSplit}>
                  <Icon name="refresh" size={18} color={colors.accent} />
                  <Text style={styles.actionBtnTxt}>再分割</Text>
                </AnimatedPressable>
                <View style={styles.actionDivider} />
                <AnimatedPressable style={styles.actionBtn} onPress={onManualSplit}>
                  <Icon name="edit" size={18} color={colors.accent} />
                  <Text style={styles.actionBtnTxt}>手動分割</Text>
                </AnimatedPressable>
              </View>

              {/* 保存する */}
              <AnimatedPressable
                style={styles.saveBtn}
                onPress={() => void handleSave()}
                disabled={saving}
                pressedScale={0.97}
              >
                <Text style={styles.saveBtnTxt}>{saving ? '保存中...' : '保存する'}</Text>
              </AnimatedPressable>
            </>
          )}
        </View>

      </Animated.ScrollView>

      {/* 元画像ズームモーダル（ヘッダーの画像アイコンから呼び出し）*/}
      <Modal
        visible={zoomVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomVisible(false)}
      >
        <TouchableOpacity
          style={styles.zoomBackdrop}
          onPress={() => setZoomVisible(false)}
          activeOpacity={1}
        >
          <Image
            source={{ uri: originalImageUri }}
            style={styles.zoomImg}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── スクロール ───────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  // ── カットセクション（top / bottom border 付き）────────────────────────────
  cutSection: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    marginTop: spacing.lg,
  },

  // ── セクションヘッダー ───────────────────────────────────────────────────
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.callout,
    color: colors.secondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.accent,
  },

  // ── 位置ベースレイアウトコンテナ ─────────────────────────────────────────
  posLayout: {
    position: 'relative',
  },

  // ── グリッド（poly セルフォールバック用）────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cellWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
    ...shadow.xs,
  },
  cellWrapSelected: {
    // borderWidth を使うと overflow:'hidden' + Android でレイアウト再計算が走り
    // Image が一瞬白くなるため、枠線ではなく内側オーバーレイで選択を表現する。
  },
  cellSelectedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 2.5,
    borderColor: '#FF9500',
  },
  // 複数入り警告: オレンジ枠（選択ハイライトと色違いで薄め）
  multipleOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: '#FF6B00',
  },
  // 複数入り警告アイコン: 右下
  multipleBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: '#FF6B00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingOverlay: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadgeTxt: {
    ...typography.caption2,
    color: '#FFF',
    lineHeight: 14,
  },
  checkBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: '#FF9500',
    borderRadius: radius.pill,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── フッター ─────────────────────────────────────────────────────────────
  footer: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  // ── アクションボタン行 ───────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadow.xs,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.sm,
  },
  actionBtnTxt: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '500',
  },

  // ── 保存 / 合体ボタン ─────────────────────────────────────────────────────
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnTxt: {
    ...typography.headline,
    color: '#FFF',
  },

  // ── キャンセルボタン ──────────────────────────────────────────────────────
  cancelBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  cancelBtnTxt: {
    ...typography.headline,
    color: colors.secondary,
  },

  // ── 合体警告テキスト ─────────────────────────────────────────────────────
  mergeWarning: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
  },

  // ── 元画像ズームモーダル ──────────────────────────────────────────────────
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImg: {
    width: '100%',
    height: '100%',
  },

});
