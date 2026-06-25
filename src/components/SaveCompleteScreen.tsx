/**
 * SaveCompleteScreen — 保存完了ダッシュボード
 *
 * 保存(camera-roll 書き出し)成功後に表示する独立画面。
 * CameraRoll から最新 savedCount 枚を取得してサムネグリッドで見せる。
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ImagePreviewModal from './ui/ImagePreviewModal';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import { ALBUM_NAME } from '../imaging';

// グリッドの最大表示枚数
const MAX_GRID = 9;
// 市松タイルサイズ
const TILE = 30;

// ── 市松模様 ─────────────────────────────────────────────────────────────────

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

// ── LINE Sticker Maker を開く ─────────────────────────────────────────────────

async function openLineStickerMaker() {
  const appScheme = Platform.OS === 'android'
    ? 'linestickercreator://'
    : 'linestickercreator://';
  const storeUrl = Platform.OS === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.linecorp.LSMS'
    : 'https://apps.apple.com/app/line-sticker-maker/id1239310100';
  const canOpen = await Linking.canOpenURL(appScheme).catch(() => false);
  Linking.openURL(canOpen ? appScheme : storeUrl);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  savedCount: number;
  onNewImage: () => void;
  onSaved: () => void;
  onHome: () => void;
  onSettings: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function SaveCompleteScreen({ savedCount, onNewImage, onSaved, onHome, onSettings }: Props) {
  /** グリッド表示用: 最大 MAX_GRID 枚 */
  const [thumbUris, setThumbUris] = useState<string[]>([]);
  /** プレビュー用: 全 savedCount 枚 */
  const [allUris,   setAllUris]   = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  // 保存直後なので最新 savedCount 枚が目的の画像
  useEffect(() => {
    (async () => {
      try {
        const result = await CameraRoll.getPhotos({
          first: Math.max(savedCount, 1),
          groupName: ALBUM_NAME,
          assetType: 'Photos',
        });
        const uris = result.edges.map(e => e.node.image.uri);
        setAllUris(uris);                      // 全枚数を保持
        setThumbUris(uris.slice(0, MAX_GRID)); // グリッドは最大 MAX_GRID 枚
      } catch {
        setAllUris([]);
        setThumbUris([]);
      } finally {
        setLoading(false);
      }
    })();
  // マウント時1回だけ実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overflow = savedCount > MAX_GRID ? savedCount - MAX_GRID : 0;

  const header = (
    <AppHeader
      title="保存完了"
      right={<HeaderActions showHome showSettings onHome={onHome} onSettings={onSettings} />}
    />
  );

  return (
    <Screen header={header} bg={IOS.bg}>

      {/* ── 完了サマリ ────────────────────────────────────────────────── */}
      <View style={styles.summary}>
        <View style={styles.iconCircle}>
          <Icon name="check" size={28} color="#0F6E56" />
        </View>
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle}>{savedCount}枚 保存しました</Text>
          <Text style={styles.summaryAlbum}>「{ALBUM_NAME}」アルバム</Text>
        </View>
      </View>

      {/* ── サムネグリッド ────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.gridLoading}>
          <ActivityIndicator color={IOS.blue} />
        </View>
      ) : (
        <View style={styles.grid}>
          {thumbUris.map((uri, i) => {
            // 最後のセルで overflow がある場合は "+N" バッジを重ねる
            const isLast  = i === thumbUris.length - 1;
            const showAdd = isLast && overflow > 0;
            return (
              <AnimatedPressable
                key={uri}
                style={styles.cell}
                onPress={() => setPreviewIdx(showAdd ? MAX_GRID : i)}
                pressedScale={0.93}
              >
                <Checkerboard size={CELL_SIZE} />
                <Image source={{ uri }} style={styles.cellImg} resizeMode="contain" />
                {showAdd && (
                  <View style={styles.overflowOverlay}>
                    <Text style={styles.overflowTxt}>+{overflow + 1}</Text>
                  </View>
                )}
              </AnimatedPressable>
            );
          })}
          {/* 欠損時プレースホルダー */}
          {!loading && thumbUris.length === 0 && (
            <View style={styles.empty}>
              <Icon name="photo-library" size={32} color={IOS.secondary} />
            </View>
          )}
        </View>
      )}

      {/* ── アクション ────────────────────────────────────────────────── */}
      <View style={styles.actions}>

        {/* 主ボタン: 別の画像を処理する → image picker を直接起動 */}
        <AnimatedPressable style={styles.primaryBtn} onPress={onNewImage} pressedScale={0.97}>
          <Text style={styles.primaryBtnTxt}>別の画像を処理する</Text>
        </AnimatedPressable>

        {/* 保存先 */}
        <AnimatedPressable style={styles.subBtn} onPress={onSaved} pressedScale={0.97}>
          <Icon name="photo-library" size={16} color={IOS.blue} />
          <Text style={styles.subBtnTxt}>保存先を確認する</Text>
        </AnimatedPressable>

        {/* LINE Sticker Maker */}
        <AnimatedPressable style={styles.lineBtn} onPress={openLineStickerMaker} pressedScale={0.97}>
          <Text style={styles.lineBtnTxt}>LINE Sticker Maker を開く</Text>
          <Icon name="open-in-new" size={16} color="#FFF" />
        </AnimatedPressable>

      </View>

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

// ── 定数 ─────────────────────────────────────────────────────────────────────

const CELL_SIZE = 96;

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  fill:      '#E5E5EA',
} as const;

// ── スタイル ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── 完了サマリ ──────────────────────────────────────────────────────────────
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: IOS.card,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconCircle: {
    width: 52, height: 52,
    borderRadius: 26,
    backgroundColor: '#E1F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  summaryAlbum: { fontSize: 13, color: IOS.secondary },

  // ── サムネグリッド ──────────────────────────────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
    justifyContent: 'center',
  },
  gridLoading: {
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  cell: {
    width: CELL_SIZE, height: CELL_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: IOS.separator,
  },
  cellImg: { width: CELL_SIZE, height: CELL_SIZE },
  overflowOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowTxt: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  empty: { width: CELL_SIZE, height: CELL_SIZE, alignItems: 'center', justifyContent: 'center' },

  // ── アクション ──────────────────────────────────────────────────────────────
  actions: {
    marginHorizontal: 16,
    marginTop: 28,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: IOS.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  subBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: IOS.fill,
    borderRadius: 14,
    paddingVertical: 14,
  },
  subBtnTxt: { fontSize: 15, fontWeight: '600', color: IOS.blue },

  lineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#3D3D3D',
    borderRadius: 14,
    paddingVertical: 16,
  },
  lineBtnTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
