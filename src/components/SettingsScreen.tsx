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
  Alert,
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
import { ALBUM_ID } from '../imaging';
import { useSettings } from '../settings/SettingsContext';
import type { SplitLineColor } from '../settings/store';
import Divider from './ui/Divider';
import { useT } from '../i18n';

// ── package.json からバージョンを取得 ─────────────────────────────────────────
// require は TS の moduleResolution によっては型エラーになる場合がある。
// その場合は直値にフォールバックしてコメントで TODO を残す。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (require('../../package.json') as { version: string }).version;

interface Props {
  onClose: () => void;
  onHowTo: () => void;
  /**
   * 「作業データをすべて削除」。セッション削除は currentSessionId 等の状態にも
   * 関わるので、実処理は App 側に持たせる（この画面は確認ダイアログまで）。
   * 省略すると行自体を出さない。
   */
  onDeleteAllData?: () => void | Promise<void>;
}

export default function SettingsScreen({ onClose, onHowTo, onDeleteAllData }: Props) {
  // Context から設定を取得。props 経由の受け渡しは不要になった。
  const { settings, updateSettings } = useSettings();
  const { t } = useT();

  // スライダーの操作中の値を local state で持ち、
  // スライド完了（onSlidingComplete）時だけ updateSettings を呼ぶことで
  // AsyncStorage への書き込み回数を最小化する
  const [tolerance, setTolerance] = useState(settings.tolerance);
  // スポイトの許容値。背景除去の tolerance とは別のツマミ（store.ts のコメント参照）。
  const [eyeTolerance, setEyeTolerance] = useState(settings.eyedropperTolerance);

  // [仮] SVGオンボーディングの表示確認用。初回ゲート接続時にこのデバッグ導線は撤去する。
  const [showOnboarding, setShowOnboarding] = useState(false);

  const header = (
    <AppHeader
      title={t('settings.title')}
      right={
        <AnimatedPressable onPress={onClose} style={styles.doneBtn}>
          <Text style={styles.doneBtnTxt}>{t('common.done')}</Text>
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
        <Text style={styles.sectionTitle}>{t('settings.sectionTransparency')}</Text>
        <Card style={styles.card} padding={0}>
          {/* tolerance 行: ラベル左・値+スライダー右 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.autoTolerance')}</Text>
              <Text style={styles.rowSub}>{t('settings.autoToleranceHint')}</Text>
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
          <Divider />
          
          {/* スポイトの許容値。上の「許容値」とは独立して調整する。 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.eyedropperTolerance')}</Text>
              <Text style={styles.rowSub}>{t('settings.eyedropperToleranceHint')}</Text>
            </View>
            <Text style={styles.rowValue}>{Math.round(eyeTolerance)}</Text>
          </View>
          <ToleranceSlider
            bare
            showLabel={false}
            value={eyeTolerance}
            onChange={setEyeTolerance}
            onComplete={v => void updateSettings({ eyedropperTolerance: v })}
          />

          {/* 輪郭のフェザリング */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.feather')}</Text>
              <Text style={styles.rowSub}>{t('settings.featherHint')}</Text>
            </View>
            <Switch
              value={settings.featherEdges}
              onValueChange={v => void updateSettings({ featherEdges: v })}
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>
        </Card>

        {/* ════════════════════════════════════════
            セクション 2: 書き出し
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>{t('settings.sectionExport')}</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.album')}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValueMuted}>{ALBUM_ID}</Text>
              <Icon name="lock" size={14} color={IOS.secondary} style={{ marginLeft: 4 }} />
            </View>
          </View>
          <Divider />
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.autoDelete')}</Text>
              <Text style={styles.rowSub}>{t('settings.autoDeleteHint')}</Text>
            </View>
            <Switch
              value={settings.autoDeleteOnExport}
              onValueChange={v => void updateSettings({ autoDeleteOnExport: v })}
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>

          {/* 作業データの一括削除。自動削除OFFのまま使い続けると「最近の作業」が
              溜まり続け、元画像とサムネのファイルも残る。1件ずつ消すのは現実的で
              ないので逃げ道をここに置く（破壊的なのでホームには置かない）。*/}
          {onDeleteAllData && (
            <>
              <Divider />
              <AnimatedPressable
                style={styles.row}
                onPress={() => {
                  Alert.alert(
                    t('settings.deleteAllData'),
                    t('settings.deleteAllDataMessage', { album: ALBUM_ID }),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('common.deleteAll'), style: 'destructive', onPress: () => void onDeleteAllData() },
                    ],
                  );
                }}
              >
                <View style={styles.rowLeft}>
                  <Text style={[styles.rowLabel, styles.dangerLabel]}>{t('settings.deleteAllData')}</Text>
                  <Text style={styles.rowSub}>{t('settings.deleteAllDataHint')}</Text>
                </View>
                <Icon name="delete-outline" size={20} color={IOS.danger} />
              </AnimatedPressable>
            </>
          )}
        </Card>

        {/* ════════════════════════════════════════
            セクション 2.5: 保存先の表示設定
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>{t('settings.showDestination')}</Text>
        <Card style={styles.card} padding={0}>
          {/* グリッドの列数 */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.columns')}</Text>
            <View style={styles.presets}>
              {([2, 3, 4] as const).map(v => (
                <AnimatedPressable
                  key={v}
                  style={[styles.presetBtn, settings.gridColumns === v && styles.presetBtnOn]}
                  onPress={() => void updateSettings({ gridColumns: v })}
                >
                  <Text style={[styles.presetTxt, settings.gridColumns === v && styles.presetTxtOn]}>
                    {t('settings.columnsValue', { count: v })}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>
          </View>
          <Divider />
          {/* サムネの下地色: 透過PNGの見た目確認用。画像自体は加工しない。 */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.thumbBg')}</Text>
            <View style={styles.presets}>
              {/* 'gray' は選択肢から外した（白と市松があれば足りるため）。
                  ThumbBg 型自体には残してあるので、PolygonEditor の作業用背景
                  「灰」は引き続き使える。保存済みの 'gray' は下の useThumbBg で
                  白に寄せるので、この3択のどれも選択中に見えない状態にはならない。*/}
              {([
                { val: 'checker', label: t('colors.checker') },
                { val: 'white',   label: t('colors.white') },
                { val: 'black',   label: t('colors.black') },
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
          <Divider />
          {/* 表示言語。'auto' は端末の言語に追従する。
              切り替えると i18n のモジュール状態が更新され、useT() を使っている
              画面がその場で描き直される（アプリの再起動は不要）。*/}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.language')}</Text>
            <View style={styles.presets}>
              {([
                { val: 'auto', label: t('settings.languageAuto') },
                { val: 'ja',   label: '日本語' },
                { val: 'en',   label: 'English' },
              ] as const).map(({ val, label }) => (
                <AnimatedPressable
                  key={val}
                  style={[styles.presetBtn, settings.language === val && styles.presetBtnOn]}
                  onPress={() => void updateSettings({ language: val })}
                >
                  <Text style={[styles.presetTxt, settings.language === val && styles.presetTxtOn]}>
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
        <Text style={styles.sectionTitle}>{t('settings.splitLineColor')}</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.boundaryColor')}</Text>
            <View style={styles.presets}>
              {([
                { val: '#007AFF' as SplitLineColor, label: t('colors.blue') },
                { val: '#FF9500' as SplitLineColor, label: t('colors.orange') },
                { val: '#FF3B30' as SplitLineColor, label: t('colors.red') },
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
        <Text style={styles.sectionTitle}>{t('settings.sectionAbout')}</Text>
        <Card style={styles.card} padding={0}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.version')}</Text>
            <Text style={styles.rowValueMuted}>{APP_VERSION}</Text>
          </View>
          <Divider />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.albumInternal')}</Text>
            <Text style={styles.rowValueMuted}>{ALBUM_ID}</Text>
          </View>
          <Divider />
          {/* 使い方: ホームから移動。既存の row スタイルをそのまま流用 */}
          <AnimatedPressable style={styles.row} onPress={onHowTo} pressedScale={0.98}>
            <Text style={styles.rowLabel}>{t('settings.howTo')}</Text>
            <Icon name="chevron-right" size={20} color={IOS.secondary} />
          </AnimatedPressable>
          <Divider />
          {/* [仮] SVGオンボーディング表示確認用。初回ゲート接続時に撤去する。 */}
          <AnimatedPressable style={styles.row} onPress={() => setShowOnboarding(true)} pressedScale={0.98}>
            <Text style={styles.rowLabel}>{t('settings.replayTutorial')}</Text>
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
  danger:    '#FF3B30',  // 破壊的アクション（theme.ts の danger と同値）
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
    // 英語はラベルもボタンも日本語より長く、1行に収まらないと右端が
    // 画面外へ切れてしまう（「Boundary line color」＋色3つで実際に切れていた）。
    // 折り返しを許可して、入らない場合はコントロールを次の行へ落とす。
    flexWrap: 'wrap',
    rowGap: 8,
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // flexShrink: ラベル側を先に縮める。ボタンは縮むと文字が切れるので固定。
  rowLabel:     { fontSize: 16, color: IOS.label, flexShrink: 1, marginRight: 12 },
  dangerLabel:  { color: IOS.danger },
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
    // 折り返して2行目に落ちたときは右寄せにして、行の右端に揃える。
    marginLeft: 'auto',
    flexShrink: 0,
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
