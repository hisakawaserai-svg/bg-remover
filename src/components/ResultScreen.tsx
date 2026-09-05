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
  Alert,
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
import type { ThumbBg } from '../settings/store';
import type { Cell } from '../cellTypes';
import type { BBox } from '../imaging';
import { useT } from '../i18n';
import { shareImages } from '../share/shareImages';

// ── 定数 ─────────────────────────────────────────────────────────────────────

// 位置ベースレイアウトの枠は実寸のまま描く（最低タップサイズ確保の拡大は廃止）。
// 以前は MIN_CELL=44px までセルを拡大していたが、はみ出し・位置ズレの原因になったため撤去。
// 最低タップサイズが必要になったら枠サイズではなくヒット領域だけを広げること。

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

/** 下地ごとのアイコン。PolygonEditor の下地切替と同じ見た目に揃える。 */
const BG_ICONS: Record<ThumbBg, string> = {
  checker: 'grid-on',
  white: 'wb-sunny',
  black: 'brightness-2',
  gray: 'grid-on',
};

// ── CellItem ────────────────────────────────────────────────────────────────

interface CellItemProps {
  cell: Cell;
  index: number;
  width: number;
  height: number;
  posStyle?: object;
  selected: boolean;
  selectingMode: boolean;
  /** 画面全体で揃える下地。個々のセルでは持たず親から受け取る（一括で切り替えるため）。 */
  bgMode: ThumbBg;
  /** 番号バッジを表示するか。透過確認の邪魔になる時に一時的に消せる。 */
  showNumbers: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function CellItem({
  cell, index, width, height, posStyle, selected, selectingMode, bgMode, showNumbers, onPress, onLongPress,
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
      style={[styles.cellWrap, { width, height }, posStyle]}
    >
      <CheckerboardBg mode={bgMode} tile={40} width={width} height={height} />
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
      {/* 番号バッジ。合体時に選ぶ対象を示すため必要だが、透過確認の邪魔になる
          ことがあるので showNumbers で一時的に消せるようにしてある。 */}
      {showNumbers && (
        <View style={styles.numBadge}>
          <Text style={styles.numBadgeTxt}>{index + 1}</Text>
        </View>
      )}
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
  onHelp?: () => void;
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
  onHelp,
  onSave,
  onReSplit,
  onManualSplit,
  onEditCell,
  onMerge,
}: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();

  const [saving,         setSaving]         = useState(false);
  const [zoomVisible,    setZoomVisible]    = useState(false);
  // 下地（背景色）。設定の既定値から始まり、画面内のトグルで一時的に上書きできる
  // （PolygonEditorのbgModeと同じ考え方。永続化はしない）。
  const defaultBgMode = useThumbBg();
  const [bgMode, setBgMode] = useState<ThumbBg>(defaultBgMode);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  // 番号バッジ。合体対象を選ぶ時は必要だが、透過確認中は邪魔になるので
  // 一時的に消せるようにする（永続化はしない）。
  const [showNumbers, setShowNumbers] = useState(true);
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
  //
  // 位置再現（元画像の配置を縮小再現）を維持しつつ、小さいセルが潰れる/枠が重なる/透明カットが
  // 大きな枠内に小さく浮く（＝切った後に見えない）問題をまとめて解消する。
  // 手順:
  //  1) 各セルの実寸bbox を表示px の矩形(edges)＋実寸サイズ(w/h)に変換する（元画像どおり）。
  //  2) 各セルが使えるグリッド区画を、上下左右それぞれ隣接セルとの「中点」まで広げて求める
  //     （隣同士が同じ中点で接するので重ならず・隙間なくタイル化。隣が無い端は表示領域端まで）。
  //  3) その区画内に「カットの縦横比」を保った札を最大サイズで収める(contain)。
  //     - 実寸より拡大されるので小さいカットも潰れない。区画内に収まるので重ならない。
  //     - 札＝カットの比率なので中身が枠にぴったり収まり、透明カットでも余分な余白が出ず
  //       「切った後」の見た目になる。区画中央に置くので元画像上の配置（位置再現）も保たれる。
  const cellLayouts = useMemo(() => {
    // 1) 実寸bbox → 表示px の矩形と実寸サイズ
    const rects = cells.map(cell => {
      if (cell.kind !== 'auto') return null;
      const { minX, minY, maxX, maxY } = cell.bbox;
      const left   = (minX / effectiveSrcW) * layoutW;
      const top    = (minY / effectiveSrcH) * layoutH;
      const right  = (maxX / effectiveSrcW) * layoutW;
      const bottom = (maxY / effectiveSrcH) * layoutH;
      return { left, top, right, bottom, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
    });

    // 2) 各セルのグリッド区画（隣接との中点でタイル化）= このセルが使える範囲
    const tiles = rects.map((r, i) => {
      if (!r) return null;
      let L = 0, T = 0, R = layoutW, B = layoutH;
      for (let j = 0; j < rects.length; j++) {
        if (j === i) continue;
        const o = rects[j];
        if (!o) continue;
        // 縦範囲が重なる=同じ行 → 左右の隣を中点で仕切る
        if (r.top < o.bottom && o.top < r.bottom) {
          if (o.right <= r.left) L = Math.max(L, (o.right + r.left) / 2); // 左隣
          if (o.left  >= r.right) R = Math.min(R, (r.right + o.left) / 2); // 右隣
        }
        // 横範囲が重なる=同じ列 → 上下の隣を中点で仕切る
        if (r.left < o.right && o.left < r.right) {
          if (o.bottom <= r.top) T = Math.max(T, (o.bottom + r.top) / 2); // 上隣
          if (o.top    >= r.bottom) B = Math.min(B, (r.bottom + o.top) / 2); // 下隣
        }
      }
      return { L, T, tileW: R - L, tileH: B - T };
    });

    // 3) 拡大率は全セルで統一（各区画にcontainできる率の最小値）。
    //    セルごとに最大化すると、ポリゴン編集等で歯抜けになった区画へ
    //    隣のカードが膨張して位置・サイズが崩れるため。
    const scale = Math.min(
      ...tiles.map((t, i) => {
        const r = rects[i];
        if (!t || !r) return Infinity;
        return Math.min(t.tileW / r.w, t.tileH / r.h);
      }),
    );

    return rects.map((r, i) => {
      const t = tiles[i];
      if (!r || !t) return null;
      const width  = Math.max(1, r.w * scale);
      const height = Math.max(1, r.h * scale);
      // カット自身のシート上の中心に置く（区画中央だと、ポリゴン編集で歯抜けに
      // なった空き地へ区画が広がった際にカードが引っ張られてずれる）。
      // はみ出しは区画内にクランプする。
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
      return {
        left: clamp(cx - width / 2, t.L, t.L + t.tileW - width),
        top:  clamp(cy - height / 2, t.T, t.T + t.tileH - height),
        width,
        height,
      };
    });
  }, [cells, effectiveSrcW, effectiveSrcH, layoutW, layoutH]);

  // ── 保存 ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const warningIndexes = cells
      .map((cell, index) => 
        cell.kind === 'auto' && cell.multipleObjects ? index + 1 : null
      )
      .filter((index): index is number => index !== null);

    if (warningIndexes.length > 0) {
      Alert.alert(
        t('result.confirmTitle'),
        t('result.warningMessage', { targets: warningIndexes.join('、') }),
        [
          {
            text: t('common.cancel'),
            style: 'cancel',
          },
          {
            text: t('common.save'),
            onPress: () => void executeSave(),
          },
        ],
      );
      return;
    }

    await executeSave();
  };

  // 実際の保存処理
  const executeSave = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
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

  // ── 共有 ─────────────────────────────────────────────────────────────────
  // カットのサムネはリサイズなしのフル解像度 透過 PNG なので、書き出し直さず
  // その URI をそのまま共有シートへ渡す。
  // 選択は解除しない（共有をキャンセルした時に選び直しになるのを避ける）。
  const handleSharePress = async () => {
    const uris = [...selectedArr]
      .sort((a, b) => a - b) // 表示順（カット番号順）で渡す
      .map(i => cells[i]?.thumbUri)
      .filter((u): u is string => !!u);
    await shareImages(uris);
  };

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  const header = (
    <AppHeader
      title={t('result.title')}
      onBack={onBack}
      backLabel={t('common.back')}
      right={
        <HeaderActions
          showHelp={!!onHelp}
          showSettings
          onHelp={onHelp}
          onSettings={onSettings}
        />
      }
    />
  );

  // ── レンダー ──────────────────────────────────────────────────────────────

  return (
    <Screen header={header} scrollable={false} style={{ paddingBottom: 0 }}>
      <View style={styles.stickyChrome}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>{t('result.cutsLabel', { count: cells.length })}</Text>
          <View style={styles.sectionHintRow}>
            <Text style={styles.sectionHint}>
              {selectingMode
                ? t('result.selectedCount', { count: selectedIndices.size })
                : t('result.longPressHint')}
            </Text>
            <AnimatedPressable
              style={styles.bgToggleBtn}
              onPress={() => setZoomVisible(true)}
              pressedScale={0.9}
            >
              <Icon name="image" size={16} color="#FFF" />
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.bgToggleBtn, showNumbers && styles.bgToggleBtnActive]}
              onPress={() => setShowNumbers(v => !v)}
              pressedScale={0.9}
            >
              <Icon name="looks-one" size={16} color="#FFF" />
            </AnimatedPressable>
            <View style={styles.bgToggleWrap}>
              <AnimatedPressable
                style={[styles.bgToggleBtn, bgPickerOpen && styles.bgToggleBtnActive]}
                onPress={() => setBgPickerOpen(o => !o)}
                pressedScale={0.9}
              >
                <Icon name={BG_ICONS[bgMode]} size={16} color="#FFF" />
              </AnimatedPressable>
              {bgPickerOpen && (
                <View style={styles.bgToggleColumn}>
                  {(['checker', 'white', 'black'] as const).map(mode => (
                    <AnimatedPressable
                      key={mode}
                      style={[styles.bgToggleDot, bgMode === mode && styles.bgToggleDotOn]}
                      onPress={() => setBgMode(mode)}
                      pressedScale={0.9}
                    >
                      <Icon name={BG_ICONS[mode]} size={14} color="#FFF" />
                    </AnimatedPressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >

        {/* ── カット後（位置ベースレイアウト）─────────────────────────── */}
        <View style={styles.cutSection}>
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
                  bgMode={bgMode}
                  showNumbers={showNumbers}
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
                {t('result.manualSplit')}
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
                      bgMode={bgMode}
                      showNumbers={showNumbers}
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
                    ? t('result.polygonCannotMerge')
                    : t('result.needAdjacent')}
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
                  {selectedArr.length >= 2
                    ? t('result.mergeCount', { count: selectedArr.length })
                    : t('result.needTwo')}
                </Text>
              </AnimatedPressable>
              {/* 共有は合体と違って隣接や kind の制約がないので、選択中なら常に押せる。 */}
              <AnimatedPressable
                style={styles.shareBtn}
                onPress={() => void handleSharePress()}
                pressedScale={0.97}
              >
                <Icon name="ios-share" size={18} color={colors.accent} style={{ marginRight: spacing.xs }} />
                <Text style={styles.shareBtnTxt}>
                  {t('result.shareCount', { count: selectedArr.length })}
                </Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.cancelBtn}
                onPress={exitSelectingMode}
                pressedScale={0.97}
              >
                <Text style={styles.cancelBtnTxt}>{t('common.cancel')}</Text>
              </AnimatedPressable>
            </>
          ) : (
            /* ── 通常モード: スライダー + アクション + 保存 ── */
            <>
              {/* 手動分割 */}
              <View style={styles.actionRow}>
                <AnimatedPressable
                  style={styles.actionBtn}
                  onPress={() => {
                    Alert.alert(
                      t('common.reset'),
                      t('result.resetMessage'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('common.reset'), style: 'destructive', onPress: onReSplit },
                      ],
                    );
                  }}
                >
                  <Icon name="refresh" size={18} color={colors.accent} />
                  <Text style={styles.actionBtnTxt}>{t('common.reset')}</Text>
                </AnimatedPressable>

                {/* 保存する */}
                <AnimatedPressable
                  style={styles.saveBtn}
                  onPress={() => void handleSave()}
                  disabled={saving}
                  pressedScale={0.97}
                >
                  <Icon name="save-alt" size={20} color="#FFF" style={{ marginRight: spacing.xs }} />
                  <Text style={styles.saveBtnTxt}>{saving ? t('common.saving') : t('common.save')}</Text>
                </AnimatedPressable>
              </View>
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
    paddingTop: spacing.sm,
  },
  stickyChrome: {
    zIndex: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },

  // ── 下地の切替（長押しヒントの横、ポップアップはその下に重ねて出す）───────
  sectionHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bgToggleWrap: {
    // 起点。ポップアップ(bgToggleColumn)はこれを基準に絶対配置するので、
    // 下のグリッドを押し下げずに上へ重ねて出せる。
    position: 'relative',
  },
  bgToggleBtn: {
    width: 26, height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(30,30,30,0.80)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  bgToggleBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  bgToggleColumn: {
    position: 'absolute',
    top: '100%',
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    padding: 4,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    ...shadow.md,
  },
  bgToggleDot: {
    width: 30, height: 26,
    borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bgToggleDotOn: { backgroundColor: colors.accent },

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
    // 英語は「AFTER CUTTING (1 IMAGE)」＋「Long-press to select and merge」で
    // 1行に収まらず、見出しとヒントが隙間なくくっついていた。
    // 入らない時はヒントを次の行へ落とし、最低限の間隔も確保する。
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: 2,
  },
  sectionLabel: {
    ...typography.callout,
    color: colors.secondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.accent,
    flexShrink: 1,
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
    // セルの境目を示すごく薄い枠。キャラ同士が接して見えるとどこで分かれているか
    // 判別できないため常時出す。【重要】この値は固定のまま動的に変えないこと。
    // borderWidth を選択状態などで切り替えると overflow:'hidden' + Android で
    // レイアウト再計算が走って Image が一瞬白くなる（cellWrapSelected のコメント参照）。
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
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
    flexDirection:'row',
    gap: spacing.md,
  },
  actionBtn:{
    flex:1,
    borderRadius:radius.md,
    backgroundColor:colors.card,
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
    flex: 2,
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
  shareBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  shareBtnTxt: {
    ...typography.headline,
    color: colors.accent,
  },
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
