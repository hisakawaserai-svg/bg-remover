/**
 * SavedScreen — 「アイコン抜き」アルバムの保存済み画像グリッド表示
 *
 * フロー:
 *   1) マウント時に CameraRoll からアルバム画像を取得し、3列(設定変更可)グリッドで表示
 *   2) サムネ背景は設定値（白/グレー/市松）。透過PNGの下に色を敷くだけで画像は加工しない。
 *   3) サムネをタップすると全画面モーダルで拡大プレビュー（左右矢印で前後移動）
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useGridMetrics } from '../hooks/useGridMetrics';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import EmptyState from './ui/EmptyState';
import { ALBUM_NAME } from '../imaging';
import { useSettings } from '../settings/SettingsContext';

// ── 市松模様コンポーネント ────────────────────────────────────────────────────
// TILE を大きくして View 数を抑える。
// 旧実装: TILE=12 → cellSize(130px) で 11×11=121 View/セル → グリッド全体で1000+ View
// 新実装: TILE=40 → cellSize(130px) で  4× 4= 16 View/セル → グリッド全体で144 View
// Lightbox では Checkerboard を使わない（後述）。
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

// グリッドの余白・隙間定数。スタイル側の grid.padding / columnWrapperStyle.gap と一致させる。
const GRID_PADDING = 8;
const GRID_GAP     = 8;

export default function SavedScreen({ onClose }: Props) {
  // Context から設定を取得。props 経由の受け渡しは不要になった。
  const { settings } = useSettings();

  // アルバムから取得した画像URI一覧
  const [uris,    setUris]    = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // 拡大プレビュー: null = 非表示、数値 = 表示中のインデックス
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  // 多重実行ガード用 ref。
  // useCallback の deps を [] にするため、state の loading ではなくクロージャに依存しない ref を使う。
  // state(loading) をガードに使うと deps に入れる必要が生じ useEffect が無限ループする。
  const fetchingRef = useRef(false);

  const fetchPhotos = useCallback(async () => {
    if (fetchingRef.current) return; // 取得中に連打されても無視
    fetchingRef.current = true;
    setLoading(true);
    try {
      const result = await CameraRoll.getPhotos({
        first: 200,
        groupName: ALBUM_NAME,
        assetType: 'Photos',
      });
      setUris(result.edges.map(e => e.node.image.uri));
    } catch (e) {
      console.warn('[SavedScreen] CameraRoll.getPhotos failed:', e);
      setUris([]);
    } finally {
      fetchingRef.current = false; // 必ず解除（例外でも）
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPhotos(); }, [fetchPhotos]);

  const cols = settings.gridColumns;
  // useGridMetrics: 画面幅から1セルサイズを計算。
  // 旧実装は horizontalPadding を考慮していなかったため、grid の padding(8px×2) 分だけ
  // 計算が広すぎて右端がわずかにはみ出していた。フックで一括補正する。
  const { itemSize: cellSize } = useGridMetrics({
    columns:           cols,
    gap:               GRID_GAP,
    horizontalPadding: GRID_PADDING,
  });

  // ── ヘッダー ────────────────────────────────────────────────────────────────
  const header = (
    <AppHeader
      title={`保存先  ${loading ? '…' : `${uris.length} 枚`}`}
      onBack={onClose}
      right={
        <TouchableOpacity onPress={fetchPhotos} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.reloadBtn}>
          <Icon name="refresh" size={22} color={IOS.blue} />
        </TouchableOpacity>
      }
    />
  );

  // ── サムネイル1枚 ────────────────────────────────────────────────────────────
  const renderCell = useCallback(({ item, index }: { item: string; index: number }) => {
    const bg = settings.thumbBg;
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setPreviewIdx(index)}
        style={[styles.cell, { width: cellSize, height: cellSize }]}
      >
        {/* 透過PNGの下地。白/グレーは View の背景色、市松は Checkerboard コンポーネントで描画。
            画像自体には手を加えず、見た目の背景だけを変えている。 */}
        {bg === 'checker'
          ? <Checkerboard size={cellSize} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: bg === 'gray' ? '#888888' : '#FFFFFF' }]} />
        }
        <Image
          source={{ uri: item }}
          style={{ width: cellSize, height: cellSize }}
          resizeMode="contain"
        />
      </TouchableOpacity>
    );
  }, [cellSize, settings.thumbBg]);

  // ── 本体 ────────────────────────────────────────────────────────────────────
  return (
    <Screen header={header} scrollable={false} bg={IOS.bg}>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={IOS.blue} />
        </View>
      ) : uris.length === 0 ? (
        <EmptyState
          icon={<Icon name="photo-library" size={56} color={IOS.secondary} />}
          title="まだ書き出した画像はありません"
          description="「アイコン抜き」で処理・保存した画像がここに表示されます"
        />
      ) : (
        // FlatList でグリッド表示。numColumns を変えるだけで列数が変わる。
        <FlatList
          data={uris}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          renderItem={renderCell}
          numColumns={cols}
          // key を変えると numColumns 変更時にリストが再生成される（FlatList の制約）
          key={cols}
          // 列間: columnWrapperStyle.gap、行間: ItemSeparatorComponent で管理。
          // contentContainerStyle.gap を使うと行間が二重になるため使わない。
          columnWrapperStyle={cols > 1 ? { gap: GRID_GAP } : undefined}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── 拡大プレビューモーダル ──────────────────────────────────────────── */}
      {previewIdx !== null && (
        <LightboxModal
          uris={uris}
          initial={previewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </Screen>
  );
}

// ── 拡大プレビューモーダル ────────────────────────────────────────────────────
// 市松模様の全画面背景に画像を中央表示。左右矢印で前後に移動できる。

function LightboxModal({
  uris,
  initial,
  onClose,
}: {
  uris: string[];
  initial: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initial);
  const total = uris.length;
  const { width: w, height: h } = useWindowDimensions();

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      {/*
       * 背景: 旧実装は Checkerboard size={max(w,h)*2} = 約1700px → TILE=12 で
       *   ceil(1700/12)=142 → 142×142 = 20,164 View を一度に生成 → フリーズ確定。
       * 修正: 暗い不透明背景に変更。透過部分は黒背景で十分視認できる。
       *   全画面の checker が必要な場合は TILE を大きくした Checkerboard を
       *   画面サイズ(w×h)に対してのみ使うこと（*2 は絶対に使わない）。
       */}
      <View style={styles.lightboxBg}>

        {/* 閉じるボタン */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Icon name="close" size={26} color="#FFF" />
        </TouchableOpacity>

        {/* 画像本体 */}
        <Image
          source={{ uri: uris[idx] }}
          style={{ width: w, height: h }}
          resizeMode="contain"
        />

        {/* 前後ナビ */}
        <View style={styles.navRow} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.navBtn, idx === 0 && styles.navBtnDisabled]}
            disabled={idx === 0}
            onPress={() => setIdx(i => i - 1)}
          >
            <Icon name="chevron-left" size={32} color="#FFF" />
          </TouchableOpacity>

          <Text style={styles.navCounter}>{idx + 1} / {total}</Text>

          <TouchableOpacity
            style={[styles.navBtn, idx === total - 1 && styles.navBtnDisabled]}
            disabled={idx === total - 1}
            onPress={() => setIdx(i => i + 1)}
          >
            <Icon name="chevron-right" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
} as const;

const styles = StyleSheet.create({
  reloadBtn: { padding: 6 },

  // グリッド全体: 外周に padding を設けてセルが画面端に張り付かないようにする。
  // 行間は ItemSeparatorComponent、列間は columnWrapperStyle.gap で管理するため
  // contentContainerStyle に gap は入れない（二重になるため）。
  grid: { padding: 8 },

  // セル: 市松がセルごとに独立した1枚であることを枠線で明示する。
  // borderRadius + overflow:'hidden' で市松・画像ともに角丸にクリップ。
  // 枠線は IOS.separator と同色で iOS のリスト区切りと統一感を出す。
  // ※カード型（白背景で包む）ではなく直接 border を付ける方式を選択。
  //   市松が見える設定でも枠が浮かず、白/グレー背景設定でも一貫して機能するため。
  cell: {
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#C7C7CC', // iOS border-tertiary 相当
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ── Lightbox ──────────────────────────────────────────────────────────────
  lightboxBg: {
    flex: 1,
    // 不透明な黒にすることで透過部分が視認でき、かつ Checkerboard View 生成によるフリーズを回避。
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute', top: 52, right: 20, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999, padding: 6,
  },
  navRow: {
    position: 'absolute', bottom: 48,
    left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  navBtn:         { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 6 },
  navBtnDisabled: { opacity: 0.25 },
  navCounter:     { fontSize: 14, color: '#FFF', fontWeight: '600', minWidth: 60, textAlign: 'center' },
});
