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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './ui/AnimatedPressable';
import ImagePreviewModal from './ui/ImagePreviewModal';
import CheckerboardBg from './ui/CheckerboardBg';
import { useThumbBg } from '../hooks/useThumbBg';
import { shareImages } from '../share/shareImages';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import { useT } from '../i18n';
import { useAlbumName } from '../settings/useAlbumName';
import AdMrec from '../ads/AdMrec';

// グリッドの最大表示枚数
const MAX_GRID = 9;
/** 「保存できました」を中央に出す時間。フッターの広告は覆わない。 */
const SAVED_BEAT_MS = 1300;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  savedCount: number;
  /**
   * 書き出したカットのローカル PNG（file:// URI）。
   *
   * 表示には CameraRoll の ph:// ではなくこちらを優先する。iOS は ph:// を
   * PHImageManager 経由で読むため**アルファが白で潰れた画像が返る**ことがあり、
   * そうなると裏の市松/黒背景が見えず「背景色設定が効かない」状態になる。
   * 元の PNG を直接読めば透過が保たれる。
   * 渡されなかった場合だけ従来どおり CameraRoll から引く。
   */
  localUris?: string[];
  onNewImage: () => void;
  onSaved: () => void;
  onHome: () => void;
  onSettings: () => void;
  onHelp?: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function SaveCompleteScreen({ savedCount, localUris, onNewImage, onSaved, onHome, onSettings, onHelp }: Props) {
  const { t } = useT();
  const { albumName } = useAlbumName();
  const bg = useThumbBg();
  /** グリッド表示用: 最大 MAX_GRID 枚 */
  const [thumbUris, setThumbUris] = useState<string[]>([]);
  /** プレビュー用: 全 savedCount 枚 */
  const [allUris,   setAllUris]   = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [showSavedBeat, setShowSavedBeat] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setShowSavedBeat(false), SAVED_BEAT_MS);
    return () => clearTimeout(id);
  }, []);

  // 保存直後なので最新 savedCount 枚が目的の画像。
  // ここは「今保存した先」だけを見ればよいので現在名で引く（履歴は使わない）。
  // 履歴をまたいで集めるのは「保存先」画面（SavedScreen）の役目。
  useEffect(() => {
    // ローカル PNG がある場合は CameraRoll を引かない（透過が保たれ、取得も速い）。
    if (localUris?.length) {
      setAllUris(localUris);
      setThumbUris(localUris.slice(0, MAX_GRID));
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const result = await CameraRoll.getPhotos({
          first: Math.max(savedCount, 1),
          // groupTypes を省くと iOS は 'All' 扱いになり groupName が無視される。
          // 保存直後は「最新 N 枚 = 保存した画像」でたまたま合っていたが、
          // 間に他アプリが写真を保存すると無関係な画像が出る。SavedScreen と同じ対処。
          groupTypes: 'Album',
          groupName: albumName,
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

  /** 拡大プレビューと共有に渡す URI 一覧。 */
  const previewUris = allUris;

  const overflow = savedCount > MAX_GRID ? savedCount - MAX_GRID : 0;

  const header = (
    <AppHeader
      title={t('saveComplete.savedCount', { count: savedCount })}
      right={<HeaderActions showHelp={!!onHelp} showSettings onHelp={onHelp} onSettings={onSettings} />}
    />
  );

  const footer = (
    <View>
      <View style={styles.dock}>
        <AnimatedPressable style={styles.primaryBtn} onPress={onNewImage} pressedScale={0.97}>
          <Text style={styles.primaryBtnTxt}>{t('saveComplete.another')}</Text>
        </AnimatedPressable>
        <View style={styles.dockRow}>
          <AnimatedPressable style={styles.dockBtn} onPress={onSaved} pressedScale={0.96}>
            <Icon name="photo-album" size={18} color={IOS.blue} />
            <Text style={styles.dockBtnTxt}>{t('saveComplete.dockDest')}</Text>
          </AnimatedPressable>
          {previewUris.length > 0 && (
            <AnimatedPressable
              style={styles.dockBtn}
              onPress={() => void shareImages(previewUris)}
              pressedScale={0.96}
            >
              <Icon name="ios-share" size={18} color={IOS.blue} />
              <Text style={styles.dockBtnTxt}>{t('saveComplete.dockShare')}</Text>
            </AnimatedPressable>
          )}
          <AnimatedPressable style={styles.dockBtn} onPress={onHome} pressedScale={0.96}>
            <Icon name="home" size={18} color={IOS.blue} />
            <Text style={styles.dockBtnTxt}>{t('saveComplete.dockHome')}</Text>
          </AnimatedPressable>
        </View>
      </View>
      <AdMrec />
    </View>
  );

  return (
    <Screen header={header} bg={IOS.bg} footer={footer} scrollable={false}>
      <View style={styles.body}>
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
                  <CheckerboardBg mode={bg} tile={30} width={CELL_SIZE} height={CELL_SIZE} />
                  <Image source={{ uri }} style={styles.cellImg} resizeMode="contain" />
                  {showAdd && (
                    <View style={styles.overflowOverlay}>
                      <Text style={styles.overflowTxt}>+{overflow + 1}</Text>
                    </View>
                  )}
                </AnimatedPressable>
              );
            })}
            {!loading && thumbUris.length === 0 && (
              <View style={styles.empty}>
                <Icon name="photo-library" size={32} color={IOS.secondary} />
              </View>
            )}
          </View>
        )}

        {/* サムネ領域だけ覆う。下のボタンと MREC は隠さない。 */}
        {showSavedBeat && (
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(280)}
            pointerEvents="none"
            style={styles.savedBeat}
          >
            <View style={styles.savedBeatIcon}>
              <Icon name="check" size={36} color="#0F6E56" />
            </View>
            <Text style={styles.savedBeatTxt}>{t('saveComplete.savedBeat')}</Text>
          </Animated.View>
        )}
      </View>

      {previewIdx !== null && (
        <ImagePreviewModal
          uris={previewUris}
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
  body: { flex: 1 },
  savedBeat: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(242,242,247,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  savedBeatIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E1F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedBeatTxt: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F6E56',
  },

  // ── サムネグリッド ──────────────────────────────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
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

  dock: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: IOS.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: IOS.separator,
    gap: 8,
  },
  primaryBtn: {
    backgroundColor: IOS.blue,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  dockRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dockBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: IOS.fill,
    borderRadius: 12,
    paddingVertical: 10,
  },
  dockBtnTxt: { fontSize: 13, fontWeight: '600', color: IOS.blue },
});
