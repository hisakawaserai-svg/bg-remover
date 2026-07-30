/**
 * PreviewScreen — ポリゴン切り取り結果のサムネイル一覧 + 保存確認画面
 *
 * フロー:
 *   1) マウント時に各ポリゴンをクロップ+マスクしてサムネイル(base64)を生成
 *   2) ScrollView で 2列グリッド表示（市松模様で透過部分を可視化）
 *   3) 「保存」タップ → savePolygons でギャラリーへ書き出し → onSave() を呼ぶ
 *   4) 「編集に戻る」→ onBack() でポリゴンは保持したまま PolygonEditor に戻る
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import CheckerboardBg from './ui/CheckerboardBg';
import ImageZoomModal from './ui/ImageZoomModal';
import { useThumbBg } from '../hooks/useThumbBg';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import { savePolygons } from '../imaging';
import { pointInPolygon } from '../imaging/maskPolygon';
import type { RemoveBgResult } from '../imaging';
import type { Polygon } from './PolygonEditor';

// サムネイル表示サイズ (px)
const THUMB_SIZE = 140;

interface Props {
  bgResult: RemoveBgResult;
  polygons: Polygon[];
  onBack: () => void;             // 編集に戻る（polygons はApp側で保持済み）
  onSave: (count: number) => void; // 保存完了後に App.tsx の state を 'done' へ
  onRequestSave: () => Promise<boolean>; // 保存前の権限確認。App.tsx の requestSave をそのまま渡してもらう
}

// ── サムネイル生成 ────────────────────────────────────────────────────────────

/**
 * 1ポリゴン分を切り出し・マスクして base64 data URI を返す（プレビュー専用）。
 * imaging/index.ts の cropAndMask と同じアルゴリズムだが、
 * サムネイルサイズへのリサイズも行う。
 * 画像範囲外の頂点は外接矩形計算でクランプされ、
 * ポリゴン外のピクセルは alpha=0 になる。
 */
function buildThumbnail(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  points: [number, number][],
): string | null {
  if (points.length < 3) return null;

  // 1) 外接矩形（画像範囲内にクランプ）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const left   = Math.max(0, Math.floor(minX));
  const top    = Math.max(0, Math.floor(minY));
  const right  = Math.min(srcW - 1, Math.ceil(maxX));
  const bottom = Math.min(srcH - 1, Math.ceil(maxY));
  const cropW  = right - left + 1;
  const cropH  = bottom - top + 1;
  if (cropW <= 0 || cropH <= 0) return null;

  // 2) 切り出し + ポリゴン外を透過（レイキャスティング法）
  const bytes = new Uint8Array(cropW * cropH * 4);
  for (let row = 0; row < cropH; row++) {
    for (let col = 0; col < cropW; col++) {
      const imgX = left + col;
      const imgY = top + row;
      const si = (imgY * srcW + imgX) * 4;
      const di = (row * cropW + col) * 4;
      bytes[di]     = rgba[si];
      bytes[di + 1] = rgba[si + 1];
      bytes[di + 2] = rgba[si + 2];
      // ピクセル中心(+0.5)で判定して端部誤差を最小化
      bytes[di + 3] = pointInPolygon(imgX + 0.5, imgY + 0.5, points) ? rgba[si + 3] : 0;
    }
  }

  // 3) SkImage 生成
  const data = Skia.Data.fromBytes(bytes);
  const img  = Skia.Image.MakeImage(
    { width: cropW, height: cropH, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    data, cropW * 4,
  );
  if (!img) return null;

  // 4) THUMB_SIZE に収まるようリサイズ（アスペクト比維持）
  const scale = Math.min(THUMB_SIZE / cropW, THUMB_SIZE / cropH);
  const dstW  = Math.round(cropW * scale);
  const dstH  = Math.round(cropH * scale);
  const surf  = Skia.Surface.Make(dstW, dstH)!;
  const c     = surf.getCanvas();
  c.clear(Skia.Color('transparent'));
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  c.drawImageRect(img, Skia.XYWHRect(0, 0, cropW, cropH), Skia.XYWHRect(0, 0, dstW, dstH), paint);
  const thumb = surf.makeImageSnapshot();
  const b64   = thumb.encodeToBase64();

  img.dispose();
  thumb.dispose();
  surf.dispose();

  return `data:image/png;base64,${b64}`;
}

// ── コンポーネント ──────────────────────────────────────────────────────────

export default function PreviewScreen({ bgResult, polygons, onBack, onSave, onRequestSave }: Props) {
  const bg = useThumbBg();
  // thumbs[i]: polygon[i] のサムネイル data URI（null = 生成失敗）
  const [thumbs,   setThumbs]   = useState<(string | null)[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  // タップしたサムネイルの拡大表示用。null なら非表示。
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  // マウント時にサムネイルを一括生成
  useEffect(() => {
    const { rgba, width, height } = bgResult;
    const results = polygons.map(p => buildThumbnail(rgba, width, height, p.points));
    setThumbs(results);
  // polygons・bgResult はマウント時に確定するので deps は空でよい
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ギャラリーへ保存（savePolygons は imaging/index.ts に集約）
  const handleSave = useCallback(async () => {
    const ok = await onRequestSave();
    if (!ok) {
      Alert.alert('権限エラー', '写真への保存が拒否されました。');
      return;
    }
    setIsSaving(true);
    try {
      const { rgba, width, height } = bgResult;
      const { count } = await savePolygons(rgba, width, height, polygons);
      onSave(count);
    } catch (e: unknown) {
      Alert.alert('保存エラー', e instanceof Error ? e.message : '不明なエラー');
    } finally {
      setIsSaving(false);
    }
  }, [bgResult, polygons, onSave, onRequestSave]);

  const header = (
    <AppHeader
      title="プレビュー"
      onBack={isSaving ? undefined : onBack}
      backLabel="編集に戻る"
    />
  );

  // 保存ボタンは自動分割(ResultScreen)と同じく画面下部に固定する
  const footer = (
    <View style={styles.footer}>
      <AnimatedPressable
        style={[styles.saveBtn, (isSaving || polygons.length === 0) && styles.saveBtnDisabled]}
        disabled={isSaving || polygons.length === 0}
        onPress={handleSave}
        pressedScale={0.97}
      >
        <Text style={styles.saveBtnTxt}>
          {isSaving ? '保存中...' : `保存する（${polygons.length}枚）`}
        </Text>
      </AnimatedPressable>
    </View>
  );

  return (
    // scrollable={false}: サムネイル有無で内部レイアウトが切り替わるため
    // ScrollView は内側で制御し、Screen は非スクロールの固定レイアウトとして使う。
    <Screen header={header} footer={footer} scrollable={false} bg={IOS.bg}>
      {/* ── サムネイル一覧 または ローディング ── */}
      {polygons.length === 0
        ? (
          // ポリゴンが1件も無い場合: 生成中ではなく「対象なし」を明示
          <View style={styles.loading}>
            <Text style={styles.loadingTxt}>書き出す対象がありません</Text>
          </View>
        )
        : thumbs.length === 0
        ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={IOS.blue} />
            <Text style={styles.loadingTxt}>プレビューを生成中...</Text>
          </View>
        )
        : (
          <ScrollView contentContainerStyle={styles.grid}>
            {thumbs.map((uri, idx) => (
              <View key={polygons[idx]?.id ?? idx} style={styles.cell}>
                <CheckerboardBg mode={bg} tile={14} width={THUMB_SIZE} height={THUMB_SIZE} />
                {uri
                  ? (
                    <TouchableOpacity onPress={() => setZoomUri(uri)} activeOpacity={0.8}>
                      <Image source={{ uri }} style={styles.thumb} resizeMode="contain" />
                    </TouchableOpacity>
                  )
                  : <Text style={styles.errorTxt}>×</Text>
                }
                {/* 通し番号バッジ */}
                <View style={styles.badge}>
                  <Text style={styles.badgeTxt}>{idx + 1}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )
      }

      {/* サムネイルタップ拡大用モーダル(SetupScreen/PolygonEditorと同じ共通部品を再利用) */}
      <ImageZoomModal
        visible={zoomUri != null}
        uri={zoomUri ?? ''}
        onClose={() => setZoomUri(null)}
      />
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
  // 下部固定フッター（ResultScreen の保存ボタンと同じ見た目）
  footer: { paddingHorizontal: 16, paddingTop: 12 },
  saveBtn: {
    backgroundColor: IOS.blue,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingTxt: { fontSize: 14, color: IOS.secondary },

  // 2列グリッド
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 16, padding: 16,
    justifyContent: 'center',
  },
  cell: {
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 0.5, borderColor: IOS.separator,
    alignItems: 'center', justifyContent: 'center',
  },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE },
  errorTxt: { fontSize: 24, color: IOS.secondary },

  // 番号バッジ（左上）
  badge: {
    position: 'absolute', top: 6, left: 6,
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: '#FFF' },
});
