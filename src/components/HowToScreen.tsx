/**
 * HowToScreen — 使い方。画面ごとのタブ。
 * 「？」からは initialTab でその画面の説明を開く。
 */

import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Icon from 'react-native-vector-icons/MaterialIcons';
import CommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';

import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import Card      from './ui/Card';
import { colors, spacing, typography, radius } from './ui/theme';
import { useT } from '../i18n';
import type { TKey } from '../i18n';
import { TOOL_ICONS } from './ui/ToolHint';

export type HowToTab = 'flow' | 'auto' | 'editor' | 'result' | 'trouble';

const TABS: { id: HowToTab; labelKey: TKey }[] = [
  { id: 'flow',    labelKey: 'howto.tabFlow' },
  { id: 'auto',    labelKey: 'howto.tabAuto' },
  { id: 'editor',  labelKey: 'howto.tabEditor' },
  { id: 'result',  labelKey: 'howto.tabResult' },
  { id: 'trouble', labelKey: 'howto.tabTrouble' },
];

type IconSpec = { name: string; family?: 'material' | 'community' };

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.section}>{text}</Text>;
}

function StepLine({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.toolRow}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumTxt}>{n}</Text>
      </View>
      <Text style={[styles.toolBody, styles.stepTxt]}>{text}</Text>
    </View>
  );
}

function ToolLine({ icon, title, body, warn }: { icon?: IconSpec; title: string; body: string; warn?: string }) {
  const Comp = icon?.family === 'community' ? CommunityIcon : Icon;
  return (
    <View style={styles.toolRow}>
      {icon ? (
        <View style={styles.iconWrap}>
          <Comp name={icon.name} size={20} color={colors.accent} />
        </View>
      ) : (
        <View style={styles.iconSpacer} />
      )}
      <View style={styles.toolTexts}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.toolBody}>{body}</Text>
        {warn ? <Text style={styles.warn}>{warn}</Text> : null}
      </View>
    </View>
  );
}

interface Props {
  onClose: () => void;
  onPolygonTutorial?: () => void;
  onComplexTutorial?: () => void;
  initialTab?: HowToTab;
  mode?: 'onboarding' | 'help';
  onStart?: () => void;
}

export default function HowToScreen({
  onClose,
  onPolygonTutorial,
  onComplexTutorial,
  initialTab = 'flow',
  mode = 'help',
  onStart,
}: Props) {
  const { t } = useT();
  const isOnboarding = mode === 'onboarding';
  const [tab, setTab] = useState<HowToTab>(initialTab);
  const album = t('app.albumName');

  const header = (
    <AppHeader
      title={t('howto.title')}
      onBack={isOnboarding ? undefined : onClose}
      backLabel={isOnboarding ? undefined : t('common.back')}
    />
  );

  return (
    <Screen header={header} bg={colors.bg} scrollable={false}>
      <View style={styles.tabRow}>
        {TABS.map(item => {
          const on = tab === item.id;
          return (
            <AnimatedPressable
              key={item.id}
              style={[styles.tabBtn, on && styles.tabBtnOn]}
              onPress={() => setTab(item.id)}
              pressedScale={0.96}
            >
              <Text style={[styles.tabTxt, on && styles.tabTxtOn]} numberOfLines={1}>
                {t(item.labelKey)}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'flow' && (
          <>
            <Card style={styles.card}>
              <Text style={styles.lead}>{t('howto.flowLead')}</Text>
              <SectionLabel text={t('howto.flowAutoTitle')} />
              <StepLine n={1} text={t('howto.flowAuto1')} />
              <StepLine n={2} text={t('howto.flowAuto2')} />
              <StepLine n={3} text={t('howto.flowAuto3')} />
              <StepLine n={4} text={t('howto.flowAuto4')} />
              <Text style={styles.footNote}>{t('howto.flowAutoNote')}</Text>
            </Card>
            <Card style={styles.card}>
              <SectionLabel text={t('howto.flowManualTitle')} />
              <Text style={styles.warn}>{t('howto.flowManualWarn')}</Text>
              <StepLine n={1} text={t('howto.flowManual1')} />
              <StepLine n={2} text={t('howto.flowManual2')} />
              <StepLine n={3} text={t('howto.flowManual3')} />
              <StepLine n={4} text={t('howto.flowManual4')} />
              <StepLine n={5} text={t('howto.flowManual5')} />
              <StepLine n={6} text={t('howto.flowManual6')} />
            </Card>
            {!isOnboarding && onPolygonTutorial && (
              <AnimatedPressable style={styles.linkRow} onPress={onPolygonTutorial} pressedScale={0.98}>
                <Icon name="gesture" size={20} color={colors.accent} />
                <View style={styles.linkText}>
                  <Text style={styles.linkLabel}>{t('howto.polygonTitle')}</Text>
                  <Text style={styles.linkSub}>{t('howto.polygonDescription')}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.secondary} />
              </AnimatedPressable>
            )}
          </>
        )}

        {tab === 'auto' && (
          <Card style={styles.card}>
            <Text style={styles.lead}>{t('howto.autoLead')}</Text>
            <SectionLabel text={t('howto.sectionBasics')} />
            <ToolLine icon={{ name: 'view-headline' }} title={t('setup.rows')} body={t('howto.autoRows')} />
            <ToolLine icon={{ name: 'view-week' }} title={t('setup.columns')} body={t('howto.autoCols')} />
            <ToolLine icon={{ name: 'remove' }} title={t('setup.moveLines')} body={t('howto.autoLines')} />
            <ToolLine icon={{ name: 'tune' }} title={t('granularity.label')} body={t('howto.autoDetail')} />
            <ToolLine icon={{ name: TOOL_ICONS.eyedropper }} title={t('editor.modeEyedropper')} body={t('howto.autoEyedrop')} />
            <ToolLine icon={{ name: 'crop' }} title={t('setup.noSplit')} body={t('howto.autoNoSplit')} />
            <SectionLabel text={t('howto.sectionWhere')} />
            <ToolLine icon={{ name: 'image' }} title={t('common.originalImage')} body={t('howto.autoOriginal')} />
            <ToolLine
              icon={{ name: 'auto-awesome' }}
              title={t('settings.bgEngine')}
              body={t('howto.autoEngine')}
              warn={t('howto.autoEngineWarn')}
            />
            <Text style={styles.footNote}>{t('howto.autoToManual')}</Text>
          </Card>
        )}

        {tab === 'editor' && (
          <>
            <Card style={styles.card}>
              <Text style={styles.lead}>{t('howto.editorPremise')}</Text>
              <ToolLine icon={{ name: 'zoom-out-map' }} title={t('howto.editorPinchTitle')} body={t('howto.editorPinch')} />
              <SectionLabel text={t('howto.sectionTools')} />
              <ToolLine icon={{ name: TOOL_ICONS.draw }} title={t('editor.modeAdd')} body={t('howto.editorAddWhere')} />
              <ToolLine icon={{ name: 'dashboard' }} title={t('editor.drawMethodPickTitle')} body={t('howto.editorPick')} />
              <ToolLine icon={{ name: TOOL_ICONS.draw }} title={t('editor.drawMethodTapTitle')} body={t('editor.drawMethodTapDesc')} />
              <ToolLine icon={{ name: 'gesture' }} title={t('editor.drawMethodTraceTitle')} body={t('editor.drawMethodTraceDesc')} />
              <SectionLabel text={t('howto.sectionFix')} />
              <ToolLine icon={{ name: TOOL_ICONS.move }} title={t('editor.modeMove')} body={t('editor.modeMoveHint')} />
              <ToolLine icon={{ name: TOOL_ICONS.eyedropper }} title={t('editor.modeEyedropper')} body={t('editor.modeEyedropperHint')} />
              <ToolLine icon={{ name: 'healing' }} title={t('editor.modeRestore')} body={t('editor.modeRestoreHint')} />
              <ToolLine icon={{ name: 'eraser', family: 'community' }} title={t('editor.modeErase')} body={t('howto.editorEraseWhere')} />
              <SectionLabel text={t('howto.sectionScreen')} />
              <ToolLine icon={{ name: 'pan-tool' }} title={t('settings.loupeMode')} body={t('howto.editorLoupe')} />
              <ToolLine icon={{ name: 'grid-on' }} title={t('settings.thumbBg')} body={t('howto.editorBg')} />
              <ToolLine icon={{ name: 'image' }} title={t('common.originalImage')} body={t('howto.editorOriginal')} />
              <ToolLine icon={{ name: 'layers' }} title={t('editor.ghost')} body={t('howto.editorGhost')} />
              <ToolLine icon={{ name: 'auto-fix-high' }} title={t('editor.retransTitle')} body={t('howto.editorRetrans')} />
              <ToolLine icon={{ name: 'visibility-off' }} title={t('howto.editorHideChromeTitle')} body={t('howto.editorHideChrome')} />
              <ToolLine icon={{ name: 'save-alt' }} title={t('editor.goToSaveLabel')} body={t('howto.editorPreview')} />
            </Card>
            {!isOnboarding && onPolygonTutorial && (
              <AnimatedPressable style={styles.linkRow} onPress={onPolygonTutorial} pressedScale={0.98}>
                <Icon name="gesture" size={20} color={colors.accent} />
                <View style={styles.linkText}>
                  <Text style={styles.linkLabel}>{t('howto.polygonTitle')}</Text>
                  <Text style={styles.linkSub}>{t('howto.polygonDescription')}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.secondary} />
              </AnimatedPressable>
            )}
          </>
        )}

        {tab === 'result' && (
          <>
            <Card style={styles.card}>
              <ToolLine icon={{ name: 'touch-app' }} title={t('editor.title')} body={t('howto.resultTap')} />
              <ToolLine icon={{ name: 'merge-type' }} title={t('result.longPressHint')} body={t('howto.resultLongPress')} />
              <SectionLabel text={t('howto.sectionScreen')} />
              <ToolLine icon={{ name: 'image' }} title={t('common.originalImage')} body={t('howto.resultOriginal')} />
              <ToolLine icon={{ name: 'looks-one' }} title={t('howto.resultNumbersTitle')} body={t('howto.resultNumbers')} />
              <ToolLine icon={{ name: 'grid-on' }} title={t('settings.thumbBg')} body={t('howto.resultBg')} />
              <ToolLine icon={{ name: 'refresh' }} title={t('common.reset')} body={t('howto.resultReset')} />
              <ToolLine icon={{ name: 'save-alt' }} title={t('common.save')} body={t('howto.resultSave', { album })} />
            </Card>
            {!isOnboarding && onComplexTutorial && (
              <AnimatedPressable style={styles.linkRow} onPress={onComplexTutorial} pressedScale={0.98}>
                <Icon name="grid-view" size={20} color={colors.accent} />
                <View style={styles.linkText}>
                  <Text style={styles.linkLabel}>{t('howto.complexTitle')}</Text>
                  <Text style={styles.linkSub}>{t('howto.complexDescription')}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.secondary} />
              </AnimatedPressable>
            )}
          </>
        )}

        {tab === 'trouble' && (
          <Card style={styles.card}>
            <ToolLine icon={{ name: 'call-split' }} title={t('howto.troubleSplitTitle')} body={t('howto.troubleSplit')} />
            <ToolLine icon={{ name: TOOL_ICONS.eyedropper }} title={t('howto.troubleBgTitle')} body={t('howto.troubleBg')} />
            <ToolLine icon={{ name: 'save-alt' }} title={t('howto.troubleSaveTitle')} body={t('howto.troubleSave')} />
            <ToolLine icon={{ name: 'photo' }} title={t('howto.troubleFormatTitle')} body={t('howto.troubleFormat')} />
            <ToolLine icon={{ name: 'hourglass-empty' }} title={t('howto.troubleProcessTitle')} body={t('howto.troubleProcess')} />
            <ToolLine icon={{ name: 'auto-awesome' }} title={t('howto.troubleEngineTitle')} body={t('howto.troubleEngine')} />
          </Card>
        )}

        {isOnboarding && (
          <AnimatedPressable style={styles.startBtn} onPress={() => onStart?.()} pressedScale={0.97}>
            <Text style={styles.startBtnTxt}>{t('common.start')}</Text>
          </AnimatedPressable>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  tabBtn: {
    flexGrow: 1,
    minWidth: 64,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.fill2,
  },
  tabBtnOn: { backgroundColor: colors.accentMuted },
  tabTxt: { ...typography.caption, fontWeight: '600', color: colors.secondary, textAlign: 'center' },
  tabTxtOn: { color: colors.accent },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { gap: spacing.md },
  lead: { ...typography.body, color: colors.secondary, lineHeight: 22 },
  section: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  toolRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  iconWrap: {
    width: 36, height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSpacer: { width: 36 },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumTxt: { ...typography.callout, fontWeight: '700', color: colors.accent },
  stepTxt: { flex: 1, ...typography.callout, color: colors.label, lineHeight: 22 },
  toolTexts: { flex: 1, gap: 2 },
  toolTitle: { ...typography.callout, fontWeight: '600', color: colors.label },
  toolBody: { ...typography.caption, color: colors.secondary, lineHeight: 18 },
  warn: { ...typography.caption, color: '#FF3B30', lineHeight: 18, fontWeight: '600' },
  footNote: { ...typography.caption, color: colors.label2, lineHeight: 18 },
  trouble: { ...typography.body, color: colors.label2, lineHeight: 22 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  linkText: { flex: 1, gap: 2 },
  linkLabel: { ...typography.callout, fontWeight: '600', color: colors.label },
  linkSub: { ...typography.caption, color: colors.secondary },
  startBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },
});
