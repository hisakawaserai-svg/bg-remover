/**
 * SavedScreen — 「スタンプ抜き」アルバムの保存済み画像グリッド表示
 *
 * フロー:
 *   1) マウント時に CameraRoll からアルバム画像を取得し、日付セクション別グリッドで表示
 *   2) 下地は設定「背景色」（白/市松/黒）。透過PNGの下に色を敷くだけで画像は加工しない。
 *   3) サムネをタップすると全画面モーダルで拡大プレビュー（左右矢印で前後移動）
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ImagePreviewModal from './ui/ImagePreviewModal';
import { useGridMetrics } from '../hooks/useGridMetrics';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import EmptyState from './ui/EmptyState';
import { ALBUM_NAME } from '../imaging';
import { useSettings } from '../settings/SettingsContext';
import { useThumbBg } from '../hooks/useThumbBg';
import { APP_NAME } from '../constants';
import AdBanner from '../ads/AdBanner';

// ── 市松模様コンポーネント ────────────────────────────────────────────────────
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

// ── 型 ────────────────────────────────────────────────────────────────────────

interface Photo {
  uri: string;
  /** Unix秒 (CameraRoll の node.timestamp) */
  timestamp: number;
  /** 全画像リスト上の通し番号 (プレビューモーダルの initial に使用) */
  globalIdx: number;
}

/** SectionList の 1行 = cols 枚の Photo */
type Row = Photo[];

interface DateSection {
  /** 表示用日付文字列: 「2026年6月25日」 */
  title: string;
  data: Row[];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

// ── 定数 ─────────────────────────────────────────────────────────────────────

const GRID_PADDING = 8;
const GRID_GAP     = 8;

// ── 日付ユーティリティ ────────────────────────────────────────────────────────

function toDateKey(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  // ローカル時刻で YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateLabel(dateKey: string): string {
  const [y, m, day] = dateKey.split('-');
  return `${y}年${Number(m)}月${Number(day)}日`;
}

function buildSections(photos: Photo[], cols: number): DateSection[] {
  // 日付キーでグループ化
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const key = toDateKey(p.timestamp);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  // 新しい日付順にソートしてセクション化
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // YYYY-MM-DD の辞書順降順
    .map(([key, dayPhotos]) => ({
      title: toDateLabel(key),
      // cols 枚ずつ行に分割
      data: chunk(dayPhotos, cols),
    }));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function SavedScreen({ onClose }: Props) {
  const { settings } = useSettings();
  const thumbBg = useThumbBg();

  const [photos,  setPhotos]  = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  const fetchingRef = useRef(false);

  const fetchPhotos = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const result = await CameraRoll.getPhotos({
        first: 200,
        groupName: ALBUM_NAME,
        assetType: 'Photos',
      });
      // timestamp も一緒に取得する。通し番号は取得順(新しい順)で付与。
      const loaded: Photo[] = result.edges.map((e, i) => ({
        uri:       e.node.image.uri,
        timestamp: e.node.timestamp,
        globalIdx: i,
      }));
      setPhotos(loaded);
    } catch (e) {
      console.warn('[SavedScreen] CameraRoll.getPhotos failed:', e);
      setPhotos([]);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPhotos(); }, [fetchPhotos]);

  const cols = settings.gridColumns;
  const { itemSize: cellSize } = useGridMetrics({
    columns:           cols,
    gap:               GRID_GAP,
    horizontalPadding: GRID_PADDING,
  });

  const sections = buildSections(photos, cols);
  const allUris  = photos.map(p => p.uri);

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  const header = (
    <AppHeader
      title={`保存先  ${loading ? '…' : `${photos.length} 枚`}`}
      onBack={onClose}
      backLabel="戻る"
      right={
        <AnimatedPressable onPress={fetchPhotos} style={styles.reloadBtn}>
          <Icon name="refresh" size={22} color={IOS.blue} />
        </AnimatedPressable>
      }
    />
  );

  // ── グリッド行のレンダー ────────────────────────────────────────────────
  const renderRow = useCallback(({ item: row }: { item: Row }) => {
    const bg = thumbBg;
    return (
      <View style={[styles.row, { gap: GRID_GAP }]}>
        {row.map(photo => (
          <AnimatedPressable
            key={photo.uri}
            onPress={() => setPreviewIdx(photo.globalIdx)}
            style={[styles.cell, { width: cellSize, height: cellSize }]}
            pressedScale={0.94}
          >
            {bg === 'checker'
              ? <Checkerboard size={cellSize} />
              // 単色時の下地。黒を白で塗ってしまっていたので CheckerboardBg と同じ色に揃えた。
              // 'gray' は設定の選択肢から外し、useThumbBg が白へ寄せるのでここでは扱わない。
              : <View style={[StyleSheet.absoluteFill, { backgroundColor: bg === 'black' ? '#1C1C1E' : '#FFFFFF' }]} />
            }
            <Image
              source={{ uri: photo.uri }}
              style={{ width: cellSize, height: cellSize }}
              resizeMode="contain"
            />
          </AnimatedPressable>
        ))}
        {/* 最終行の空きセル埋め（右揃え崩れ防止）*/}
        {Array.from({ length: cols - row.length }, (_, i) => (
          <View key={`empty-${i}`} style={{ width: cellSize, height: cellSize }} />
        ))}
      </View>
    );
  }, [cellSize, cols, thumbBg]);

  // ── セクションヘッダーのレンダー ──────────────────────────────────────────
  const renderSectionHeader = useCallback(({ section }: { section: DateSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTxt}>{section.title}</Text>
    </View>
  ), []);

  // ── 本体 ──────────────────────────────────────────────────────────────────
  return (
    <Screen header={header} scrollable={false} bg={IOS.bg} footer={<AdBanner />}>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={IOS.blue} />
        </View>
      ) : photos.length === 0 ? (
        <EmptyState
          icon={<Icon name="photo-library" size={56} color={IOS.secondary} />}
          title="まだ書き出した画像はありません"
          description={`「${APP_NAME}」で処理・保存した画像がここに表示されます`}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row, i) => row[0]?.uri ?? String(i)}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          // セクション間の余白
          SectionSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          // 行間
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* 拡大プレビュー */}
      {previewIdx !== null && (
        <ImagePreviewModal
          uris={allUris}
          initial={previewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </Screen>
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

  listContent: {
    padding: GRID_PADDING,
    paddingBottom: 32,
  },

  // セクションヘッダー
  sectionHeader: {
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  sectionHeaderTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: IOS.secondary,
    letterSpacing: 0.3,
  },

  // グリッド行
  row: {
    flexDirection: 'row',
  },

  // セル
  cell: {
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#C7C7CC',
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
