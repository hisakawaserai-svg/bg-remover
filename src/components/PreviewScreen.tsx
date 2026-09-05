/**
 * PreviewScreen — ポリゴン切り取り結果の確認 + 保存画面
 *
 * フロー:
 *   1) マウント時に各ポリゴンを保存と同じ経路で PNG 化し、file:// を持つ
 *   2) 2列グリッドで見せる。背景色・番号は結果画面と同じ一時切替（永続化しない）
 *   3) タップで ImagePreviewModal（保存完了と同じピンチズーム・左右送り）
 *   4) 「保存」→ savePolygons でギャラリーへ → onSave()
 *   5) 「編集に戻る」→ onBack()（polygons は App 側で保持済み）
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import CheckerboardBg from './ui/CheckerboardBg';
import ImagePreviewModal from './ui/ImagePreviewModal';
import ImageZoomModal from './ui/ImageZoomModal';
import { useThumbBg } from '../hooks/useThumbBg';
import { clearPreviewDir, savePolygons, writePreviewPolygons } from '../imaging';
import { describeSaveError } from '../imaging/saveErrors';
import { useT } from '../i18n';
import { useAlbumName } from '../settings/useAlbumName';
import type { ThumbBg } from '../settings/store';
import type { RemoveBgResult } from '../imaging';
import type { Polygon } from './PolygonEditor';

/** 下地ごとのアイコン。ResultScreen / PolygonEditor と同じ。 */
const BG_ICONS: Record<ThumbBg, string> = {
  checker: 'grid-on',
  white: 'wb-sunny',
  black: 'brightness-2',
  gray: 'grid-on',
};

interface Props {
  bgResult: RemoveBgResult;
  polygons: Polygon[];
  onBack: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
  originalImageUri?: string;
  /** 保存完了後に App.tsx の state を 'done' へ。paths は書き出した PNG の file:// URI。 */
  onSave: (count: number, paths: string[]) => void;
  onRequestSave: () => Promise<boolean>;
}

export default function PreviewScreen({ bgResult, polygons, onBack, onSettings, onHelp, originalImageUri, onSave, onRequestSave }: Props) {
  const { t } = useT();
  const { ensureAlbumName } = useAlbumName();
  const { width: winW } = useWindowDimensions();
  const defaultBg = useThumbBg();
  const [bgMode, setBgMode] = useState<ThumbBg>(defaultBg);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [showNumbers, setShowNumbers] = useState(true);

  const cellSize = Math.floor((winW - 16 * 2 - 12) / 2);

  // null = 生成中。要素はポリゴン順。失敗は null。
  const [uris, setUris] = useState<(string | null)[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void (async () => {
      const { rgba, width, height } = bgResult;
      const results = await writePreviewPolygons(rgba, width, height, polygons, isCancelled);
      if (!cancelled) setUris(results);
    })();
    return () => {
      cancelled = true;
      void clearPreviewDir();
    };
  // polygons・bgResult はマウント時に確定するので deps は空でよい
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(async () => {
    const ok = await onRequestSave();
    if (!ok) {
      Alert.alert(t('permission.errorTitle'), t('permission.saveDenied'));
      return;
    }
    setIsSaving(true);
    try {
      const { rgba, width, height } = bgResult;
      const { count, paths } = await savePolygons(rgba, width, height, polygons, await ensureAlbumName());
      onSave(count, paths);
    } catch (e: unknown) {
      Alert.alert(t('preview.saveErrorTitle'), describeSaveError(e));
    } finally {
      setIsSaving(false);
    }
  }, [bgResult, polygons, onSave, onRequestSave, ensureAlbumName, t]);

  const previewUris = (uris ?? []).filter((u): u is string => !!u);

  const openPreview = (uri: string) => {
    const idx = previewUris.indexOf(uri);
    if (idx >= 0) setPreviewIdx(idx);
  };

  const header = (
    <AppHeader
      title={t('preview.title')}
      onBack={isSaving ? undefined : onBack}
      backLabel={t('preview.backToEdit')}
      right={
        <HeaderActions
          showHelp={!!onHelp}
          showSettings={!!onSettings}
          onHelp={onHelp}
          onSettings={onSettings}
        />
      }
    />
  );

  const footer = (
    <View style={styles.footer}>
      <AnimatedPressable
        style={[styles.saveBtn, (isSaving || polygons.length === 0) && styles.saveBtnDisabled]}
        disabled={isSaving || polygons.length === 0}
        onPress={handleSave}
        pressedScale={0.97}
      >
        <Icon name="save-alt" size={20} color="#FFF" style={{ marginRight: 8 }} />
        <Text style={styles.saveBtnTxt}>
          {isSaving ? t('common.saving') : t('preview.saveCount', { count: polygons.length })}
        </Text>
      </AnimatedPressable>
    </View>
  );

  return (
    <Screen header={header} footer={footer} scrollable={false} bg={IOS.bg}>
      {polygons.length === 0 ? (
        <View style={styles.loading}>
          <Text style={styles.loadingTxt}>{t('preview.nothingToExport')}</Text>
        </View>
      ) : uris == null ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={IOS.blue} />
          <Text style={styles.loadingTxt}>{t('loading.previewGenerating')}</Text>
        </View>
      ) : (
        <View style={styles.body}>
        <View style={styles.stickyChrome}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>{t('preview.cutsLabel', { count: polygons.length })}</Text>
            <View style={styles.sectionHintRow}>
              {originalImageUri ? (
                <AnimatedPressable
                  style={styles.bgToggleBtn}
                  onPress={() => setZoomVisible(true)}
                  pressedScale={0.9}
                >
                  <Icon name="image" size={16} color="#FFF" />
                </AnimatedPressable>
              ) : null}
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
        <ScrollView style={styles.gridScroll} contentContainerStyle={styles.gridWrap}>
          <View style={styles.grid}>
            {uris.map((uri, idx) => (
              <View key={polygons[idx]?.id ?? idx} style={[styles.cell, { width: cellSize, height: cellSize }]}>
                <CheckerboardBg mode={bgMode} tile={14} width={cellSize} height={cellSize} />
                {uri ? (
                  <AnimatedPressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => openPreview(uri)}
                    pressedScale={0.96}
                  >
                    <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  </AnimatedPressable>
                ) : (
                  <Text style={styles.errorTxt}>×</Text>
                )}
                {showNumbers && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{idx + 1}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
        </View>
      )}

      {previewIdx !== null && previewUris.length > 0 && (
        <ImagePreviewModal
          uris={previewUris}
          initial={previewIdx}
          onClose={() => setPreviewIdx(null)}
          bg={bgMode}
        />
      )}
      {originalImageUri ? (
        <ImageZoomModal visible={zoomVisible} uri={originalImageUri} onClose={() => setZoomVisible(false)} />
      ) : null}
    </Screen>
  );
}

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
} as const;

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 16, paddingTop: 12 },
  saveBtn: {
    backgroundColor: IOS.blue,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingTxt: { fontSize: 14, color: IOS.secondary },

  body: { flex: 1 },
  gridScroll: { flex: 1 },
  stickyChrome: {
    zIndex: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: IOS.bg,
  },
  gridWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 6,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  sectionHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bgToggleWrap: {
    position: 'relative',
  },
  bgToggleBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(30,30,30,0.80)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  bgToggleBtnActive: { backgroundColor: IOS.blue, borderColor: IOS.blue },
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
  },
  bgToggleDot: {
    width: 30,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bgToggleDotOn: { backgroundColor: IOS.blue },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-start',
  },
  cell: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: IOS.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTxt: { fontSize: 24, color: IOS.secondary },

  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: '#FFF' },
});
