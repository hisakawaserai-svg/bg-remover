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
import ToleranceSlider, { REMOVAL_SNAPS, SPOT_SNAPS } from './ui/ToleranceSlider';
import AppHeader from './ui/AppHeader';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Card from './ui/Card';
import OnboardingScreen from './OnboardingScreen';
import { useSettings } from '../settings/SettingsContext';
import type { SplitLineColor } from '../settings/store';
import { DEFAULTS, isSplashEnabled } from '../settings/store';
import SplashAnimationView from './SplashAnimationView';
import Divider from './ui/Divider';
import SelectRow from './ui/SelectRow';
import LoupeMagnifySlider from './ui/LoupeMagnifySlider';
import LoupeSizeSlider from './ui/LoupeSizeSlider';
import type { AppIconSetting, LoupeMode, LoupeZoomMode, SplashAnimationSetting } from '../settings/store';
import { useT } from '../i18n';
import { useAlbumName } from '../settings/useAlbumName';
import { useStats } from '../stats/StatsContext';

// ── package.json からバージョンを取得 ─────────────────────────────────────────
// require は TS の moduleResolution によっては型エラーになる場合がある。
// その場合は直値にフォールバックしてコメントで TODO を残す。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (require('../../package.json') as { version: string }).version;

/**
 * 作業時間（累計ミリ秒）を「N時間M分」等の表示文字列にする。
 * 1分未満はまとめて「1分未満」にする（0分と表示すると「計測されていない」ように見えるため）。
 */
function formatWorkTime(ms: number, t: ReturnType<typeof useT>['t']): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes <= 0) return t('settings.statsTimeUnderMinute');
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t('settings.statsTimeHoursMinutes', { hours, minutes })
    : t('settings.statsTimeMinutes', { minutes });
}

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
  const { albumName } = useAlbumName();
  const { stats } = useStats();

  // スライダーの操作中の値を local state で持ち、
  // スライド完了（onSlidingComplete）時だけ updateSettings を呼ぶことで
  // AsyncStorage への書き込み回数を最小化する
  const [tolerance, setTolerance] = useState(settings.tolerance);
  // スポイトの許容値。背景除去の tolerance とは別のツマミ（store.ts のコメント参照）。
  const [eyeTolerance, setEyeTolerance] = useState(settings.eyedropperTolerance);

  // [仮] SVGオンボーディングの表示確認用。初回ゲート接続時にこのデバッグ導線は撤去する。
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 起動アニメーションの試聴中フラグ。設定画面の上に重ねて1回だけ再生する。
  const [previewing, setPreviewing] = useState(false);
  const splashOn = isSplashEnabled(settings);

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
    <>
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
            {/* 現在値を数値でリアルタイム表示。既定値と一致する時だけ明示する。 */}
            <Text style={styles.rowValue}>
              {Math.round(tolerance)}
              {Math.round(tolerance) === DEFAULTS.tolerance && (
                <Text style={styles.rowValueDefaultTag}>  {t('common.default')}</Text>
              )}
            </Text>
          </View>
          {/* 共通スライダー（連続値＋弱/中/強ソフトスナップ）。
              セットアップ画面と同一コンポーネントを使う。Card 内なので bare 指定。 */}
          <ToleranceSlider
            bare
            showLabel={false}
            edgeLabels
            snaps={REMOVAL_SNAPS}
            value={tolerance}
            defaultValue={DEFAULTS.tolerance}
            onChange={setTolerance}
            onComplete={v => void updateSettings({ tolerance: v })}
          />
          {/* 文字の穴を透過する（上級者向け・既定OFF）。
            背景と同じ色の絵柄を消し得るので、注意書きを添えて既定は切ってある。 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.fillTextHoles')}</Text>
              <Text style={styles.rowSub}>{t('settings.fillTextHolesHint')}</Text>
            </View>
            <Switch
              value={settings.fillTextHoles}
              onValueChange={v => void updateSettings({ fillTextHoles: v })}
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>
          <Divider />
          {/* スポイトの許容値。上の「許容値」とは独立して調整する。 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.eyedropperTolerance')}</Text>
              <Text style={styles.rowSub}>{t('settings.eyedropperToleranceHint')}</Text>
            </View>
            <Text style={styles.rowValue}>
              {Math.round(eyeTolerance)}
              {Math.round(eyeTolerance) === DEFAULTS.eyedropperTolerance && (
                <Text style={styles.rowValueDefaultTag}>  {t('common.default')}</Text>
              )}
            </Text>
          </View>
          <ToleranceSlider
            bare
            showLabel={false}
            edgeLabels
            snaps={SPOT_SNAPS}
            value={eyeTolerance}
            defaultValue={DEFAULTS.eyedropperTolerance}
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
          {/* 保存先の案内なので翻訳した表示名を出す。
              写真アプリ上の実体名は下の「アルバム名（内部）」で確認できる。 */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.album')}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValueMuted}>{albumName}</Text>
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
                    t('settings.deleteAllDataMessage', { album: albumName }),
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
            セクション 2.7: 見た目(アイコン / 起動演出)
            選択肢が多いので、行を押すと下から選択肢が出る形にする。
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>{t('settings.sectionAppearance')}</Text>
        <Card style={styles.card} padding={0}>
          <SelectRow<AppIconSetting>
            label={t('settings.appIcon')}
            sub={t('settings.appIconHint')}
            value={settings.appIcon}
            options={[
              { value: 'day',   label: t('settings.iconDay') },
              { value: 'night', label: t('settings.iconNight') },
              { value: 'sleep', label: t('settings.iconSleep') },
            ]}
            // 実際の切り替えは App.tsx の useEffect が appIcon の変化を見て
            // applyAppIcon() を呼ぶ('auto' の時間帯判定もそちらに集約)。
            onChange={v => {
              void updateSettings({ appIcon: v });
            }}
          />
          <Divider />
          {/* ON/OFF。パターン選択とは分けてあるので、OFF にしても選んだ
              パターンは残る(store の splashEnabled 参照)。 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.splashAnimation')}</Text>
              <Text style={styles.rowSub}>{t('settings.splashAnimationHint')}</Text>
            </View>
            <Switch
              value={splashOn}
              onValueChange={v =>
                void updateSettings({
                  splashEnabled: v,
                  // 旧バージョンで 'off' を保存している場合はここで解消する。
                  ...(v && settings.splashAnimation === 'off'
                    ? { splashAnimation: 'auto' as SplashAnimationSetting }
                    : null),
                })
              }
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>

          {/* ON の時だけパターン選択と試聴を出す(項目を増やしすぎない)。 */}
          {splashOn && (
            <>
              <Divider />
              <SelectRow<SplashAnimationSetting>
                label={t('settings.splashPattern')}
                sub={t('settings.splashAutoHint')}
                value={
                  settings.splashAnimation === 'off'
                    ? 'auto'
                    : settings.splashAnimation
                }
                options={[
                  { value: 'auto',  label: t('settings.splashPatternAuto') },
                  { value: 'fly',   label: t('settings.splashFly') },
                  { value: 'peel',  label: t('settings.splashPeel') },
                  { value: 'cross', label: t('settings.splashCross') },
                  { value: 'sleep', label: t('settings.splashSleep') },
                  { value: 'shake', label: t('settings.splashShake') },
                  { value: 'drop',  label: t('settings.splashDrop') },
                ]}
                // 保存したうえで、変更後の演出をその場で1回再生して見せる。
                // 「時間帯に合わせる」を選んだ時は、今の時刻で出る演出が流れる。
                // ON/OFF の切り替えでは再生しない(意図が「消したい」なので)。
                onChange={v => {
                  void updateSettings({ splashAnimation: v });
                  setPreviewing(true);
                }}
              />
            </>
          )}
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
            セクション 2.9: ルーペ

            編集中のドロップダウンではなくここに置いている。一度決めたら
            まず変えない設定なので、編集画面の常設 UI を増やしたくない。
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>{t('settings.sectionLoupe')}</Text>
        <Card style={styles.card} padding={0}>
          <SelectRow<LoupeMode>
            label={t('settings.loupeMode')}
            sub={t('settings.loupeModeHint')}
            value={settings.loupeMode}
            options={[
              { value: 'fixed',  label: t('settings.loupeModeFixed') },
              { value: 'adjust', label: t('settings.loupeModeAdjust') },
              { value: 'drag',   label: t('settings.loupeModeDrag') },
            ]}
            onChange={v => void updateSettings({ loupeMode: v })}
          />
          <Divider />
          <SelectRow<LoupeZoomMode>
            label={t('settings.loupeZoomMode')}
            sub={t('settings.loupeZoomModeHint')}
            value={settings.loupeZoomMode}
            options={[
              { value: 'fixed',     label: t('settings.loupeZoomModeFixed') },
              { value: 'matchZoom', label: t('settings.loupeZoomModeMatch') },
              { value: 'inverse',   label: t('settings.loupeZoomModeInverse') },
            ]}
            onChange={v => void updateSettings({ loupeZoomMode: v })}
          />
          {/* loupeZoomMode の3モードすべてが、この基準値を起点に倍率を計算する
              （一定＝そのまま、拡大して見る／全体を見渡す＝ズームに応じて
              増減）ので、モードを問わず常に表示する。 */}
          <Divider />
          <LoupeMagnifySlider
            label={t('settings.loupeBaseMagnify')}
            sub={t('settings.loupeBaseMagnifyHint')}
            value={settings.loupeBaseMagnify}
            onChange={v => void updateSettings({ loupeBaseMagnify: v })}
          />
          <Divider />
          <LoupeSizeSlider
            label={t('settings.loupeBaseSize')}
            sub={t('settings.loupeBaseSizeHint')}
            value={settings.loupeBaseSize}
            onChange={v => void updateSettings({ loupeBaseSize: v })}
          />
          <Divider />
          {/* 倍率モードとは別設定（十分拡大した時だけ自動で出る）。 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.loupeDotGrid')}</Text>
              <Text style={styles.rowSub}>{t('settings.loupeDotGridHint')}</Text>
            </View>
            <Switch
              value={settings.loupeDotGrid}
              onValueChange={v => void updateSettings({ loupeDotGrid: v })}
              trackColor={{ false: IOS.fill, true: IOS.blue }}
              thumbColor="#FFF"
            />
          </View>
        </Card>

        {/* ════════════════════════════════════════
            セクション 2.95: 統計（端末内のみ保存・外部送信なし）
        ════════════════════════════════════════ */}
        <Text style={styles.sectionTitle}>{t('settings.sectionStats')}</Text>
        <Card style={styles.card} padding={0}>
          <Text style={styles.statsGroupLabel}>{t('settings.statsAchievementTitle')}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.statsStampsCreated')}</Text>
            <Text style={styles.rowValueMuted}>{t('settings.statsCountUnit', { count: stats.stampsCreated })}</Text>
          </View>
          <Divider />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.statsExportsCompleted')}</Text>
            <Text style={styles.rowValueMuted}>{t('settings.statsTimesUnit', { count: stats.exportsCompleted })}</Text>
          </View>
          <Divider />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.statsImagesEdited')}</Text>
            <Text style={styles.rowValueMuted}>{t('settings.statsImagesUnit', { count: stats.imagesEdited })}</Text>
          </View>
          <Divider />
          <Text style={styles.statsGroupLabel}>{t('settings.statsUsageTitle')}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.statsTransparencyOps')}</Text>
            <Text style={styles.rowValueMuted}>{t('settings.statsTimesUnit', { count: stats.transparencyOps })}</Text>
          </View>
          <Divider />
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>{t('settings.statsWorkTime')}</Text>
              <Text style={styles.rowSub}>{t('settings.statsWorkTimeHint')}</Text>
            </View>
            <Text style={styles.rowValueMuted}>{formatWorkTime(stats.workTimeMs, t)}</Text>
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
          {/* 「アルバム名（内部）」の行は廃止した。
              アルバム名は初回保存時に確定して以後動かさない方式にしたので、
              上の「保存先アルバム」に出している名前が写真アプリの実体名と
              常に一致する。同じ値を2行に出す意味がなくなった。 */}
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

    {/* 試聴: 現在の設定そのままで1回再生する。終わったら層を外すだけ。 */}
    {previewing && (
      <View style={StyleSheet.absoluteFill}>
        <SplashAnimationView
          isPreview
          setting={settings.splashAnimation === 'off' ? 'auto' : settings.splashAnimation}
          onFinish={() => setPreviewing(false)}
        />
      </View>
    )}
    </>
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
  rowValueDefaultTag: { fontSize: 12, fontWeight: '600', color: IOS.secondary },

  // ── 統計セクション内の小見出し（🏆 制作実績 / ⚙️ 利用状況）─────────────────
  statsGroupLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: IOS.secondary,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 4,
  },

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
