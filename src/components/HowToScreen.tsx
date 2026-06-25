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
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

import Screen    from './ui/Screen';
import AppHeader from './ui/AppHeader';
import Card      from './ui/Card';
import FadeInView from './ui/FadeInView';
import { colors, spacing, typography, radius } from './ui/theme';

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
    note:  '完璧でなくても「保存する」で透過PNGとして「アイコン抜き」アルバムに保存されます。',
  },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function HowToScreen({ onClose }: Props) {

  // stagger の起点delay。各ステップは STAGGER_INTERVAL ずつずれて登場する。
  // FadeInView に delay を渡すだけで stagger を実現している（ループは親が担当）。
  const STAGGER_INTERVAL = 80; // ms

  const header = (
    <FadeInView delay={0}>
      <AppHeader
        title="使い方"
        right={
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.doneBtn}
          >
            <Text style={styles.doneBtnTxt}>完了</Text>
          </TouchableOpacity>
        }
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

      {/* コツ */}
      <FadeInView delay={STAGGER_INTERVAL * 5}>
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
      <FadeInView delay={STAGGER_INTERVAL * 6}>
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
  doneBtn:    { paddingHorizontal: 4 },
  doneBtnTxt: { ...typography.headline, color: colors.accent },

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
});
