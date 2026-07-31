/**
 * HowToScreen — 使い方ガイド画面
 *
 * アニメーション方針:
 *   - ヘッダーと上部3ステップは画面を開いた瞬間に順番登場（stagger）。
 *     FadeInView の delay を 0,80,160,240ms とずらして渡すだけで実現。
 *   - 下部のコツ・注意枠はスクロールして見えるタイミングでフェードインしたいが、
 *     現状は ScrollFadeIn を実装していないため、後の段階で追加する。
 *     暫定として少し大きめの delay（400ms〜）で stagger のみ適用し、
 *     スクロール連動は TODO コメントで残す。
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedPressable } from './ui/AnimatedPressable';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import Card      from './ui/Card';
import FadeInView from './ui/FadeInView';
import { colors, spacing, typography, radius } from './ui/theme';
import { ALBUM_ID } from '../imaging';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

// ── ステップデータ ──────────────────────────────────────────────────────────
// 内容を配列で持つことで、ステップ追加時に JSX を触らなくて済む。

/**
 * ステップの中身。文言そのものではなく i18n のキーを持ち、描画時に t() で解決する。
 * モジュール定数のまま文言を埋めると、初期化時の言語で固定されてしまう。
 */
const STEPS: { icon: string; titleKey: TKey; bodyKey: TKey; noteKey: TKey }[] = [
  { icon: 'add-photo-alternate',  titleKey: 'howto.step1Title', bodyKey: 'howto.step1Body', noteKey: 'howto.step1Note' },
  { icon: 'tune',                 titleKey: 'howto.step2Title', bodyKey: 'howto.step2Body', noteKey: 'howto.step2Note' },
  { icon: 'check-circle-outline', titleKey: 'howto.step3Title', bodyKey: 'howto.step3Body', noteKey: 'howto.step3Note' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onPolygonTutorial?: () => void;
  onComplexTutorial?: () => void;
  /**
   * 'help'(既定):      設定>使い方からの閲覧。右上「完了」でいつでも閉じる。
   * 'onboarding':      初回フロー。末尾CTA「はじめる」で前進。
   * PolygonTutorialScreen と命名を揃える。
   */
  mode?: 'onboarding' | 'help';
  /** onboarding 時のCTAハンドラ。フラグ保存等の副作用は呼び出し側が持つ。 */
  onStart?: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function HowToScreen({ onClose, onPolygonTutorial, onComplexTutorial, mode = 'help', onStart }: Props) {
  const { t } = useT();
  const isOnboarding = mode === 'onboarding';

  // stagger の起点delay。各ステップは STAGGER_INTERVAL ずつずれて登場する。
  // FadeInView に delay を渡すだけで stagger を実現している（ループは親が担当）。
  const STAGGER_INTERVAL = 80; // ms

  const header = (
    <FadeInView delay={0}>
      <AppHeader
        title={t('howto.title')}
        // help は「戻る」で呼び出し元へ戻る。onboarding は末尾CTAで前進するため非表示。
        onBack={isOnboarding ? undefined : onClose}
        backLabel={isOnboarding ? undefined : t('common.back')}
      />
    </FadeInView>
  );

  return (
    <Screen header={header} bg={colors.bg}>

      {/* ── リード文 ── delay=1段目 */}
      <FadeInView delay={STAGGER_INTERVAL * 1}>
        <View style={styles.lead}>
          <Text style={styles.leadTxt}>{t('howto.intro')}</Text>
        </View>
      </FadeInView>

      {/* ── ステップカード群 ── delay を STAGGER_INTERVAL ずつずらして順番登場 */}
      {STEPS.map((step, i) => (
        // i=0→delay=2段目, i=1→3段目, i=2→4段目
        <FadeInView key={step.titleKey} delay={STAGGER_INTERVAL * (i + 2)}>
          <Card style={styles.stepCard}>
            {/* アイコン + タイトル行 */}
            <View style={styles.stepHeader}>
              <View style={styles.iconWrap}>
                <Icon name={step.icon} size={22} color={colors.accent} />
              </View>
              <Text style={styles.stepTitle}>{t(step.titleKey)}</Text>
            </View>

            {/* 本文 */}
            <Text style={styles.stepBody}>{t(step.bodyKey)}</Text>

            {/* 補足ノート */}
            <View style={styles.noteRow}>
              <Icon name="lightbulb-outline" size={13} color={colors.secondary} />
              <Text style={styles.noteTxt}>{t(step.noteKey, { album: ALBUM_ID })}</Text>
            </View>
          </Card>
        </FadeInView>
      ))}

      {!isOnboarding && onComplexTutorial && (
        <AnimatedPressable
          style={styles.tutorialRow}
          onPress={onComplexTutorial}
        >
          <Icon name="grid-view" size={20} color={colors.accent}/>
          <View style={styles.tutorialText}>
            <Text style={styles.tutorialLabel}>
              {t('howto.complexTitle')}
            </Text>
            <Text style={styles.tutorialSub}>
              {t('howto.complexDescription')}
            </Text>
          </View>
          <Icon name="chevron-right" size={20}/>
        </AnimatedPressable>
      )}

      {/*
       * ── 以下は画面下部（スクロールして見える）────────────────────────────
       * TODO: ScrollFadeIn 実装後にスクロール連動フェードインへ移行する。
       * 現状は stagger の続き（遅めの delay）で代替し、
       * スクロール前から非表示・スクロール後に表示、という動きは未対応。
       */}

      {/* 範囲を調整チュートリアルへのリンク。
          初回オンボ中は踏むと help 版に化けて初回フローが分断するため非表示にする。 */}
      {!isOnboarding && onPolygonTutorial && (
        <FadeInView delay={STAGGER_INTERVAL * 5}>
          <AnimatedPressable
            style={styles.tutorialRow}
            onPress={onPolygonTutorial}
            pressedScale={0.98}
          >
            <View style={styles.tutorialIcon}>
              <Icon name="gesture" size={20} color={colors.accent} />
            </View>
            <View style={styles.tutorialText}>
              <Text style={styles.tutorialLabel}>{t('howto.polygonTitle')}</Text>
              <Text style={styles.tutorialSub}>{t('howto.polygonDescription')}</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.secondary} />
          </AnimatedPressable>
        </FadeInView>
      )}

      {/* コツ */}
      <FadeInView delay={STAGGER_INTERVAL * 6}>
        <Card style={styles.tipsCard}>
          <View style={styles.tipsHeader}>
            <Icon name="tips-and-updates" size={16} color="#FF9500" />
            <Text style={styles.tipsTitle}>{t('howto.tipsTitle')}</Text>
          </View>
          <TipRow text={t('howto.tip1')} />
          <TipRow text={t('howto.tip2')} />
          <TipRow text={t('howto.tip3')} />
        </Card>
      </FadeInView>

      {/* 注意事項 */}
      <FadeInView delay={STAGGER_INTERVAL * 7}>
        <Card style={styles.cautionCard}>
          <View style={styles.tipsHeader}>
            <Icon name="info-outline" size={16} color={colors.secondary} />
            <Text style={[styles.tipsTitle, { color: colors.secondary }]}>{t('howto.noticeTitle')}</Text>
          </View>
          {/* 「選択した写真のみ」だとアルバムへの保存が Photos 側で拒否され、
              書き出し時に PHPhotosErrorDomain エラーになる。実際に踏んだので明記する。 */}
          <TipRow text={t('howto.notice1')} />
          <TipRow text={t('howto.notice2')} />
          <TipRow text={t('howto.notice3')} />
        </Card>
      </FadeInView>

      {/* オンボーディング時のみ: 読み終えて前進するCTA */}
      {isOnboarding && (
        <FadeInView delay={STAGGER_INTERVAL * 8}>
          <AnimatedPressable style={styles.startBtn} onPress={() => onStart?.()} pressedScale={0.97}>
            <Text style={styles.startBtnTxt}>{t('common.start')}</Text>
          </AnimatedPressable>
        </FadeInView>
      )}

    </Screen>
  );
}

// ── 補足リスト行（Card 内で使う小部品）────────────────────────────────────────

function TipRow({ text }: { text: string }) {
  return (
    <View style={styles.tipRow}>
      <Text style={styles.tipBullet}>•</Text>
      <Text style={styles.tipTxt}>{text}</Text>
    </View>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  lead: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  leadTxt: {
    ...typography.body,
    color: colors.secondary,
    lineHeight: 22,
    textAlign: 'center',
  },

  stepCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 36, height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: { ...typography.headline, color: colors.label, flex: 1 },
  stepBody:  { ...typography.body, color: colors.label2, lineHeight: 22 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.fill2,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  noteTxt: { ...typography.caption, color: colors.secondary, flex: 1, lineHeight: 18 },

  tipsCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  cautionCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
    gap: spacing.xs,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  tipsTitle: { ...typography.callout, fontWeight: '600', color: '#FF9500' },

  tipRow:   { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  tipBullet: { ...typography.body, color: colors.secondary, lineHeight: 22 },
  tipTxt:   { ...typography.body, color: colors.label2, flex: 1, lineHeight: 22 },

  // 手動チュートリアルへのリンク行
  tutorialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  tutorialIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorialText: { flex: 1, gap: 2 },
  tutorialLabel: { ...typography.callout, fontWeight: '600', color: colors.label },
  tutorialSub:   { ...typography.caption, color: colors.secondary },

  // onboarding CTA（PolygonTutorialScreen の startBtn と揃える）
  startBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
  },
  startBtnTxt: { fontSize: 17, fontWeight: '600', color: '#FFF' },
});
