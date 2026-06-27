/**
 * SettingsScreen.tsx — iOS 設定アプリ風のアプリ設定画面
 *
 * 構成（セクション分けリスト）:
 *   1. 透過設定  : tolerance スライダー（flood-fill の許容色差）
 *   2. 書き出し  : 保存先アルバム名（読み取り専用）
 *   3. このアプリ: バージョン表示
 *
 * Props:
 *   settings    — 現在の設定値（App.tsx が AsyncStorage からロード済みのもの）
 *   onClose     — 「完了」ボタンで呼ぶコールバック
 *   onSave      — 設定変更時に呼ぶコールバック（App.tsx 側で AsyncStorage 保存 + state 更新）
 *
 * このコンポーネント自身は AsyncStorage を直接呼ばない。
 * 保存責務を App.tsx に委譲することで、設定反映のタイミングを一元管理できる。
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Screen from './ui/Screen';
import ToleranceSlider from './ui/ToleranceSlider';
import AppHeader from './ui/AppHeader';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Card from './ui/Card';
import OnboardingScreen from './OnboardingScreen';
import { ALBUM_NAME } from '../imaging';
import { useSettings } from '../settings/SettingsContext';
import type { SplitLineColor } from '../settings/store';

// ── package.json からバージョンを取得 ─────────────────────────────────────────
// require は TS の moduleResolution によっては型エラーになる場合がある。
// その場合は直値にフォールバックしてコメントで TODO を残す。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (require('../../package.json') as { version: string }).version;

interface Props {
  onClose: () => void;
  onHowTo: () => void;
}

export default function SettingsScreen({ onClose, onHowTo }: Props) {
  // Context から設定を取得。props 経由の受け渡しは不要になった。
  const { settings, updateSettings } = useSettings();

  // スライダーの操作中の値を local state で持ち、
  // スライド完了（onSlidingComplete）時だけ updateSettings を呼ぶことで
  // AsyncStorage への書き込み回数を最小化する
  const [tolerance, setTolerance] = useState(settings.tolerance);

  // [仮] SVGオンボーディングの表示確認用。初回ゲート接続時にこのデバッグ導線は撤去する。
  const [showOnboarding, setShowOnboarding] = useState(false);

  const header = (
    <AppHeader
      title="設定"
      right={
        <AnimatedPressable onPress={onClose} style={styles.doneBtn}>
          <Text style={styles.doneBtnTxt}>完了</Text>
        </AnimatedPressable>
      }
    />
  );

  // [仮] オンボーディングを全画面オーバーレイで表示。完了/「はじめる」で閉じる。
  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <Screen header={header} style={styles.container}>

        {/* ════════════════════════════════════════
            セクション 1: 透過設定
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>透過設定</Text>
        <Card style={styles.card} padding={0}>
          {/* tolerance 行: ラベル左・値+スライダー右 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>許容値</Text>
              <Text style={styles.rowSub}>背景色との色差しきい値（大きいほど広く抜ける）</Text>
            </View>
            {/* 現在値を数値でリアルタイム表示 */}
            <Text style={styles.rowValue}>{Math.round(tolerance)}</Text>
          </View>
          {/* 共通スライダー（連続値＋弱/中/強ソフトスナップ）。
              セットアップ画面と同一コンポーネントを使う。Card 内なので bare 指定。 */}
          <ToleranceSlider
            bare
            showLabel={false}
            value={tolerance}
            onChange={setTolerance}
            onComplete={v => void updateSettings({ tolerance: v })}
          />
        </Card>

        {/* ════════════════════════════════════════
            セクション 2: 書き出し
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>書き出し</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>保存先アルバム</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValueMuted}>{ALBUM_NAME}</Text>
              <Icon name="lock" size={14} color={IOS.secondary} style={{ marginLeft: 4 }} />
            </View>
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>保存後に作業データを自動削除</Text>
              <Text style={styles.rowSub}>エクスポート完了後、カット画像と作業データを削除します</Text>
            </View>
            <Switch
              value={settings.autoDeleteOnExport}
              onValueChange={v => void updateSettings({ autoDeleteOnExport: v })}
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>
        </Card>

        {/* ════════════════════════════════════════
            セクション 2.5: 保存先の表示設定
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>保存先の表示</Text>
        <Card style={styles.card} padding={0}>
          {/* グリッドの列数 */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>列数</Text>
            <View style={styles.presets}>
              {([2, 3, 4] as const).map(v => (
                <AnimatedPressable
                  key={v}
                  style={[styles.presetBtn, settings.gridColumns === v && styles.presetBtnOn]}
                  onPress={() => void updateSettings({ gridColumns: v })}
                >
                  <Text style={[styles.presetTxt, settings.gridColumns === v && styles.presetTxtOn]}>
                    {v}列
                  </Text>
                </AnimatedPressable>
              ))}
            </View>
          </View>
          <View style={styles.separator} />
          {/* サムネの下地色: 透過PNGの見た目確認用。画像自体は加工しない。 */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>サムネ背景</Text>
            <View style={styles.presets}>
              {([
                { val: 'white',   label: '白'   },
                { val: 'gray',    label: 'グレー' },
                { val: 'checker', label: '市松'  },
              ] as const).map(({ val, label }) => (
                <AnimatedPressable
                  key={val}
                  style={[styles.presetBtn, settings.thumbBg === val && styles.presetBtnOn]}
                  onPress={() => void updateSettings({ thumbBg: val })}
                >
                  <Text style={[styles.presetTxt, settings.thumbBg === val && styles.presetTxtOn]}>
                    {label}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>
          </View>
        </Card>

        {/* ════════════════════════════════════════
            セクション 2.8: 分割線の色
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>分割線の色</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>境界線の色</Text>
            <View style={styles.presets}>
              {([
                { val: '#007AFF' as SplitLineColor, label: '青' },
                { val: '#FF9500' as SplitLineColor, label: 'オレンジ' },
                { val: '#FF3B30' as SplitLineColor, label: '赤' },
              ]).map(({ val, label }) => {
                const isOn = (settings.splitLineColor ?? '#007AFF') === val;
                return (
                  <AnimatedPressable
                    key={val}
                    style={[styles.colorBtn, isOn && styles.colorBtnOn]}
                    onPress={() => void updateSettings({ splitLineColor: val })}
                  >
                    <View style={[styles.swatch, { backgroundColor: val }]} />
                    <Text style={[styles.presetTxt, isOn && styles.presetTxtOn]}>
                      {label}
                    </Text>
                  </AnimatedPressable>
                );
              })}
            </View>
          </View>
        </Card>

        {/* ════════════════════════════════════════
            セクション 3: このアプリ
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>このアプリについて</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>バージョン</Text>
            <Text style={styles.rowValueMuted}>{APP_VERSION}</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>アルバム名（内部）</Text>
            <Text style={styles.rowValueMuted}>{ALBUM_NAME}</Text>
          </View>
          <View style={styles.separator} />
          {/* 使い方: ホームから移動。既存の row スタイルをそのまま流用 */}
          <AnimatedPressable style={styles.row} onPress={onHowTo} pressedScale={0.98}>
            <Text style={styles.rowLabel}>使い方</Text>
            <Icon name="chevron-right" size={20} color={IOS.secondary} />
          </AnimatedPressable>
          <View style={styles.separator} />
          {/* [仮] SVGオンボーディング表示確認用。初回ゲート接続時に撤去する。 */}
          <AnimatedPressable style={styles.row} onPress={() => setShowOnboarding(true)} pressedScale={0.98}>
            <Text style={styles.rowLabel}>オンボーディング(SVG)を表示(仮)</Text>
            <Icon name="chevron-right" size={20} color={IOS.secondary} />
          </AnimatedPressable>
        </Card>

    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  doneBtn:    { paddingHorizontal: 4 },
  doneBtnTxt: { fontSize: 17, fontWeight: '600', color: IOS.blue },

  // ── スクロール本体 ─────────────────────────────────────────────────────────
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  // ── セクションタイトル（iOS 設定アプリ風の大文字グレーラベル）──────────────
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: IOS.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingLeft: 4,
  },

  // ── カード ────────────────────────────────────────────────────────────────
  card: {
    width: '100%',
    marginBottom: 24,
    overflow: 'hidden', // 内側の行が borderRadius をはみ出さないように
  },

  // ── リスト行（左: ラベル、右: 値/コントロール）──────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowLabel:     { fontSize: 16, color: IOS.label },
  rowSub:       { fontSize: 12, color: IOS.secondary, marginTop: 2 },
  rowValue:     { fontSize: 22, fontWeight: '600', color: IOS.blue, minWidth: 36, textAlign: 'right' },
  rowValueMuted:{ fontSize: 16, color: IOS.secondary },

  // ── セパレータ（Card 内の行区切り）─────────────────────────────────────────
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: IOS.separator,
    marginLeft: 16, // 左端のラベルと揃える
  },

  // ── プリセットボタン行 ───────────────────────────────────────────────────────
  presets: {
    flexDirection: 'row',
    gap: 6,
  },
  presetBtn: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: IOS.fill,
  },
  presetBtnOn: {
    backgroundColor: IOS.blue,
  },
  presetTxt: {
    fontSize: 13,
    fontWeight: '500',
    color: IOS.secondary,
  },
  presetTxtOn: {
    color: '#FFF',
  },

  // ── 分割線の色ボタン ─────────────────────────────────────────────────────────
  colorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: IOS.fill,
  },
  colorBtnOn: {
    backgroundColor: IOS.blue,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.15)',
  },
});
