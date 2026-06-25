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
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import { colors, spacing, radius, shadow, typography } from './ui/theme';
import { useGridMetrics } from '../hooks/useGridMetrics';
import { useSettings } from '../settings/SettingsContext';
import type { Cell } from '../cellTypes';
import type { BBox } from '../imaging';

// ── 定数 ─────────────────────────────────────────────────────────────────────

const ORIG_IMG_FULL_H = 180;

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

// ── チェッカー背景 ────────────────────────────────────────────────────────────

const TILE = 40;
function Checkerboard({ size }: { size: number }) {
  const n = Math.ceil(size / TILE);
  return (
    <View style={{ position: 'absolute', width: size, height: size, overflow: 'hidden' }}>
      {Array.from({ length: n }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {Array.from({ length: n }, (_, c) => (
            <View
              key={c}
              style={{
                width: TILE, height: TILE,
                backgroundColor: (r + c) % 2 === 0 ? '#CCCCCC' : '#FFFFFF',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// ── CellItem ────────────────────────────────────────────────────────────────

interface CellItemProps {
  cell: Cell;
  index: number;
  size: number;
  selected: boolean;
  selectingMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function CellItem({
  cell, index, size, selected, selectingMode, onPress, onLongPress,
}: CellItemProps) {
  const isMissing = cell.thumbUri === 'MISSING';
  const imgSource = useMemo(
    () => isMissing ? null : { uri: cell.thumbUri },
    [cell.thumbUri, isMissing],
  );

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={[styles.cellWrap, { width: size, height: size }]}
    >
      <Checkerboard size={size} />
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
      {/* 選択ハイライト: Image の上に border overlay（borderWidth を wrapper に当てると白化するため）*/}
      {selected && <View style={styles.cellSelectedOverlay} pointerEvents="none" />}
      {/* 番号バッジ */}
      <View style={styles.numBadge}>
        <Text style={styles.numBadgeTxt}>{index + 1}</Text>
      </View>
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
  onBack,
  onHome,
  onSettings,
  onSave,
  onReSplit,
  onManualSplit,
  onEditCell,
  onMerge,
}: Props) {
  const { settings, updateSettings } = useSettings();
  const insets = useSafeAreaInsets();

  const [saving,         setSaving]         = useState(false);
  const [zoomVisible,    setZoomVisible]    = useState(false);
  // 選択 state — 画像ソースとは完全に独立したオブジェクト
  const [selectingMode,  setSelectingMode]  = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // ── collapsing header (transform + opacity のみ、height 変更なし) ───────────

  // ── グリッド寸法 ─────────────────────────────────────────────────────────
  const { itemSize } = useGridMetrics({
    columns: 2,
    gap: spacing.md,
    horizontalPadding: spacing.lg,
  });

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
          showHome
          showSettings
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

        {/* ── 元の画像 ──────────────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>元の画像</Text>
          <AnimatedPressable onPress={() => setZoomVisible(true)} pressedScale={0.97}>
            <Text style={styles.sectionHint}>タップで拡大</Text>
          </AnimatedPressable>
        </View>
        <TouchableOpacity
          onPress={() => setZoomVisible(true)}
          style={styles.origImgWrap}
          activeOpacity={0.85}
        >
          <Image
            source={{ uri: originalImageUri }}
            style={styles.origImg}
            resizeMode="cover"
          />
        </TouchableOpacity>

        {/* ── カット後グリッド ──────────────────────────────────────────── */}
        <View style={styles.cutSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>カット後（{cells.length}枚）</Text>
            <Text style={styles.sectionHint}>
              {selectingMode
                ? `${selectedIndices.size}枚選択中`
                : '長押しで選択・合体'}
            </Text>
          </View>
        <View style={styles.grid}>
          {cells.map((cell, i) => (
            <CellItem
              key={i}
              cell={cell}
              index={i}
              size={itemSize}
              selected={selectedIndices.has(i)}
              selectingMode={selectingMode}
              onPress={() => handleCellPress(i)}
              onLongPress={() => handleCellLongPress(i)}
            />
          ))}
        </View>
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

      {/* ズーム拡大モーダル */}
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

  // ── 元の画像 ─────────────────────────────────────────────────────────────
  origImgWrap: {
    width: '100%',
    height: ORIG_IMG_FULL_H,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.fill,
    ...shadow.sm,
  },
  origImgInner: {
    width: '100%',
    height: ORIG_IMG_FULL_H,
  },
  origImg: {
    width: '100%',
    height: ORIG_IMG_FULL_H,
  },

  // ── グリッド ─────────────────────────────────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cellWrap: {
    borderRadius: radius.md,
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
    borderRadius: radius.md,
    borderWidth: 2.5,
    borderColor: '#FF9500',
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

  // ── ズームモーダル ────────────────────────────────────────────────────────
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
