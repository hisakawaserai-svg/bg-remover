/**
 * SetupScreen.tsx — 自動分割の行数確認 + 分割境界線プレビュー画面
 *
 * removeBackground 完了後、実際に分割する前に表示する。
 * 横線: calcRowBoundaries による行境界（等分割）
 * 縦線: calcColEdgesPerRow による列境界（行ごとに独立した実検出位置）
 * 行数ステッパーで変更するたびに縦横両線がリアルタイムで更新される。
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Image,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';

import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import HeaderActions from './ui/HeaderActions';
import Card from './ui/Card';
import ToleranceSlider from './ui/ToleranceSlider';
import { calcRowBoundaries, calcColEdgesPerRow } from '../imaging/splitObjects';
import { useSettings } from '../settings/SettingsContext';
import type { RemoveBgResult } from '../imaging';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type SetupMode = 'auto' | 'manual';

interface Props {
  bgResult: RemoveBgResult;
  initialRows: number;
  initialMode?: SetupMode;
  onConfirm: (rows: number, mode: SetupMode) => void;
  onBack: () => void;
  onSettings?: () => void;
}

export default function SetupScreen({ bgResult, initialRows, initialMode = 'auto', onConfirm, onBack, onSettings }: Props) {
  const { settings } = useSettings();
  const [rows, setRows] = useState(initialRows);
  const [mode, setMode] = useState<SetupMode>(initialMode);
  const [viewSize, setViewSize] = useState<{ width: number; height: number } | null>(null);

  // bgResult.rgba → base64 PNG URI（変換は1回だけ）
  const imageUri = useMemo(() => {
    const data = Skia.Data.fromBytes(bgResult.rgba);
    const img = Skia.Image.MakeImage(
      {
        width: bgResult.width,
        height: bgResult.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      data,
      bgResult.width * 4,
    );
    if (!img) return null;
    const b64 = img.encodeToBase64();
    img.dispose();
    return `data:image/png;base64,${b64}`;
  }, [bgResult]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  // contain フィット変換パラメータ（横・縦両線で共用）
  const fitParams = useMemo(() => {
    if (!viewSize) return null;
    const { width: vW, height: vH } = viewSize;
    const { width: imgW, height: imgH } = bgResult;
    const scale = Math.min(vW / imgW, vH / imgH);
    return {
      scale,
      padX: (vW - imgW * scale) / 2,
      padY: (vH - imgH * scale) / 2,
    };
  }, [viewSize, bgResult]);

  // 横線: 行境界 y 座標（display 座標）
  const lineYs = useMemo(() => {
    if (!fitParams) return [];
    const { scale, padY } = fitParams;
    return calcRowBoundaries(bgResult.height, rows).map(y => padY + y * scale);
  }, [fitParams, bgResult.height, rows]);

  // 縦線: 行ごとの列境界（display 座標）— 行の帯の範囲内にだけ引く
  const colLines = useMemo(() => {
    if (!fitParams) return [];
    const { scale, padX, padY } = fitParams;
    const perRow = calcColEdgesPerRow(bgResult.rgba, bgResult.width, bgResult.height, rows);
    return perRow.flatMap(({ bandTop, bandBot, edges }) => {
      const top = padY + bandTop * scale;
      const height = (bandBot - bandTop) * scale;
      // edges の先頭 (0) と末尾 (width) は画像端なので省く
      return edges.slice(1, -1).map(x => ({ left: padX + x * scale, top, height }));
    });
  }, [fitParams, bgResult, rows]);

  const lineColor = settings.splitLineColor ?? '#007AFF';

  const header = (
    <AppHeader
      title="分割設定"
      onBack={onBack}
      backLabel="戻る"
      right={onSettings ? (
        <HeaderActions showSettings onSettings={onSettings} />
      ) : undefined}
    />
  );

  return (
    <Screen bg={IOS.bg} header={header}>
      <View style={styles.wrap}>
        {/* モードセレクタ */}
        <View style={styles.modeRow}>
          <AnimatedPressable
            style={[styles.modeBtn, mode === 'auto' && styles.modeBtnOn]}
            onPress={() => setMode('auto')}
            pressedScale={0.96}
          >
            <Text style={[styles.modeTxt, mode === 'auto' && styles.modeTxtOn]}>自動分割</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.modeBtn, mode === 'manual' && styles.modeBtnOn]}
            onPress={() => setMode('manual')}
            pressedScale={0.96}
          >
            <Text style={[styles.modeTxt, mode === 'manual' && styles.modeTxtOn]}>手動で囲む</Text>
          </AnimatedPressable>
        </View>

        {/* プレビュー + 分割境界線オーバーレイ（自動モードのみ線を表示）*/}
        <View style={styles.previewBox} onLayout={handleLayout}>
          {imageUri && (
            <Image
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          )}

          {mode === 'auto' && (
            <>
              {/* 横線（行境界）*/}
              {lineYs.map((y, i) => (
                <React.Fragment key={`h${i}`}>
                  <View style={[styles.hLineBg, { top: y - 2 }]} />
                  <View style={[styles.hLine, { top: y - 1, backgroundColor: lineColor }]} />
                </React.Fragment>
              ))}

              {/* 縦線（列境界: 各行の帯内だけに描く）*/}
              {colLines.map((seg, i) => (
                <React.Fragment key={`v${i}`}>
                  <View style={[styles.vLineBg, { left: seg.left - 2, top: seg.top, height: seg.height }]} />
                  <View style={[styles.vLine, { left: seg.left - 1, top: seg.top, height: seg.height, backgroundColor: lineColor }]} />
                </React.Fragment>
              ))}
            </>
          )}
        </View>

        {/* 自動モード: 行数ステッパー + 許容値スライダー */}
        {mode === 'auto' && (
          <>
            <Card style={styles.card}>
              <View style={styles.rowInput}>
                <Text style={styles.rowLabel}>行数（段数）</Text>
                <View style={styles.stepper}>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    onPress={() => setRows(v => clamp(v - 1, 1, 20))}
                  >
                    <Text style={styles.stepTxt}>−</Text>
                  </AnimatedPressable>
                  <Text style={styles.stepVal}>{rows}</Text>
                  <AnimatedPressable
                    style={styles.stepBtn}
                    onPress={() => setRows(v => clamp(v + 1, 1, 20))}
                  >
                    <Text style={styles.stepTxt}>+</Text>
                  </AnimatedPressable>
                </View>
              </View>
            </Card>
            <ToleranceSlider />
          </>
        )}

        {/* 手動モード: 説明テキスト */}
        {mode === 'manual' && (
          <Card style={styles.card}>
            <Text style={styles.manualDesc}>
              背景除去済みの画像に自由にポリゴンを描いてカットします。
            </Text>
          </Card>
        )}

        <AnimatedPressable style={styles.primaryBtn} onPress={() => onConfirm(rows, mode)} pressedScale={0.97}>
          <Text style={styles.btnTxt}>
            {mode === 'auto' ? 'この行数で分割' : 'ポリゴン編集へ'}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.secondaryBtn} onPress={onBack} pressedScale={0.97}>
          <Text style={styles.secondaryBtnTxt}>画像を選び直す</Text>
        </AnimatedPressable>
      </View>
    </Screen>
  );
}

const IOS = {
  bg:        '#F2F2F7',
  card:      '#FFFFFF',
  blue:      '#007AFF',
  label:     '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  fill:      '#E5E5EA',
} as const;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  desc: {
    fontSize: 14,
    color: IOS.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: IOS.fill,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeBtnOn: {
    backgroundColor: IOS.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  modeTxt: {
    fontSize: 14,
    fontWeight: '500',
    color: IOS.secondary,
  },
  modeTxtOn: {
    color: IOS.label,
    fontWeight: '600',
  },
  manualDesc: {
    fontSize: 14,
    color: IOS.secondary,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  previewBox: {
    width: '100%',
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
  },

  // ── 横線（行境界）──────────────────────────────────────────────────────────
  hLineBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
  },

  // ── 縦線（列境界: 行の帯内のみ）──────────────────────────────────────────
  vLineBg: {
    position: 'absolute',
    width: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  vLine: {
    position: 'absolute',
    width: 2,
  },

  // ── カード内コントロール ───────────────────────────────────────────────────
  card: {
    width: '100%',
  },
  rowInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  rowLabel: {
    fontSize: 16,
    color: IOS.label,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: IOS.separator,
    marginVertical: 4,
  },

  // ── ステッパー ─────────────────────────────────────────────────────────────
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: IOS.separator,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IOS.card,
  },
  stepTxt: {
    fontSize: 22,
    color: IOS.blue,
    lineHeight: 26,
  },
  stepVal: {
    fontSize: 17,
    fontWeight: '600',
    color: IOS.label,
    minWidth: 28,
    textAlign: 'center',
  },

  // ── ボタン ────────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: IOS.blue,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  btnTxt: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnTxt: {
    color: IOS.secondary,
    fontSize: 15,
  },
});
