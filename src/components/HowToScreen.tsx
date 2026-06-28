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
import { ALBUM_NAME } from '../imaging';

// ── ステップデータ ──────────────────────────────────────────────────────────
// 内容を配列で持つことで、ステップ追加時に JSX を触らなくて済む。

const STEPS = [
  {
    icon:  'add-photo-alternate',
    title: 'STEP 1  画像を選ぶ',
    body:  'ホーム画面の「画像を選択」からイラストシートを選びます。\n複数キャラが並んだ1枚の画像でOKです。',
    note:  'PNG・JPEG どちらも対応。',
  },
  {
    icon:  'tune',
    title: 'STEP 2  分割モードを選ぶ',
    body:  'セットアップ画面でモードを選びます。\n\n【自動分割】行数を確認・調整して「この行数で分割」。プレビューに分割線が表示されます。\n\n【手動で囲む】ポリゴンで各キャラを直接囲んで切り出します。自動がうまくいかないときに使います。',
    note:  'まず自動を試してみてください。自動で大半は揃います。',
  },
  {
    icon:  'check-circle-outline',
    title: 'STEP 3  結果を確認・調整する',
    body:  '分割結果を確認し、ズレや合体があれば調整します。\n\n• 合体している → フッターの「分割の強さ」を上げて「再分割」\n• 隣のカットとまとめたい → カットを長押しして選択し「合体する」\n• 1枚だけ直したい → カットをタップしてポリゴン編集\n• 全部やり直したい → 「手動分割」でポリゴンモードへ',
    note:  `完璧でなくても「保存する」で透過PNGとして「${ALBUM_NAME}」アルバムに保存されます。`,
  },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onPolygonTutorial?: () => void;
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

export default function HowToScreen({ onClose, onPolygonTutorial, mode = 'help', onStart }: Props) {
  const isOnboarding = mode === 'onboarding';

  // stagger の起点delay。各ステップは STAGGER_INTERVAL ずつずれて登場する。
  // FadeInView に delay を渡すだけで stagger を実現している（ループは親が担当）。
  const STAGGER_INTERVAL = 80; // ms

  const header = (
    <FadeInView delay={0}>
      <AppHeader
        title="使い方"
        // help は「戻る」で呼び出し元へ戻る。onboarding は末尾CTAで前進するため非表示。
        onBack={isOnboarding ? undefined : onClose}
        backLabel={isOnboarding ? undefined : '戻る'}
      />
    </FadeInView>
  );

  return (
    <Screen header={header} bg={colors.bg}>

      {/* ── リード文 ── delay=1段目 */}
      <FadeInView delay={STAGGER_INTERVAL * 1}>
        <View style={styles.lead}>
          <Text style={styles.leadTxt}>
            イラストシートの背景を除去し、キャラクターごとに切り出して透過PNGで保存するアプリです。まず自動で試し、うまくいかない部分だけ手動で直す、という流れで使います。
          </Text>
        </View>
      </FadeInView>

      {/* ── ステップカード群 ── delay を STAGGER_INTERVAL ずつずらして順番登場 */}
      {STEPS.map((step, i) => (
        // i=0→delay=2段目, i=1→3段目, i=2→4段目
        <FadeInView key={step.title} delay={STAGGER_INTERVAL * (i + 2)}>
          <Card style={styles.stepCard}>
            {/* アイコン + タイトル行 */}
            <View style={styles.stepHeader}>
              <View style={styles.iconWrap}>
                <Icon name={step.icon} size={22} color={colors.accent} />
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
            </View>

            {/* 本文 */}
            <Text style={styles.stepBody}>{step.body}</Text>

            {/* 補足ノート */}
            <View style={styles.noteRow}>
              <Icon name="lightbulb-outline" size={13} color={colors.secondary} />
              <Text style={styles.noteTxt}>{step.note}</Text>
            </View>
          </Card>
        </FadeInView>
      ))}

      {/*
       * ── 以下は画面下部（スクロールして見える）────────────────────────────
       * TODO: ScrollFadeIn 実装後にスクロール連動フェードインへ移行する。
       * 現状は stagger の続き（遅めの delay）で代替し、
       * スクロール前から非表示・スクロール後に表示、という動きは未対応。
       */}

      {/* 手動切り抜きチュートリアルへのリンク。
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
              <Text style={styles.tutorialLabel}>手動切り抜きの使い方</Text>
              <Text style={styles.tutorialSub}>四角で囲む操作のアニメーション説明</Text>
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
            <Text style={styles.tipsTitle}>きれいに抜くコツ</Text>
          </View>
          <TipRow text="白・薄グレーの単色背景イラストが最も綺麗に抜ける" />
          <TipRow text="分割の強さは「中」から始め、合体して分かれないなら「強」へ" />
          <TipRow text="自動でどうしても揃わない場合は「手動分割」でポリゴン編集" />
        </Card>
      </FadeInView>

      {/* 注意事項 */}
      <FadeInView delay={STAGGER_INTERVAL * 7}>
        <Card style={styles.cautionCard}>
          <View style={styles.tipsHeader}>
            <Icon name="info-outline" size={16} color={colors.secondary} />
            <Text style={[styles.tipsTitle, { color: colors.secondary }]}>ご注意</Text>
          </View>
          <TipRow text="写真アプリへのアクセス許可が必要です" />
          <TipRow text="出力は透過PNGのみ（JPEG は透過を保持できないため）" />
          <TipRow text="背景除去・分割の処理中はアプリを閉じないでください" />
        </Card>
      </FadeInView>

      {/* オンボーディング時のみ: 読み終えて前進するCTA */}
      {isOnboarding && (
        <FadeInView delay={STAGGER_INTERVAL * 8}>
          <AnimatedPressable style={styles.startBtn} onPress={() => onStart?.()} pressedScale={0.97}>
            <Text style={styles.startBtnTxt}>はじめる</Text>
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
