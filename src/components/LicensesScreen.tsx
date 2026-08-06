/**
 * LicensesScreen.tsx — OSSライセンス表記画面
 *
 * データは scripts/generate-licenses.js が生成する2つのJSON（約490件・
 * npm本番依存＋Podfile.lock由来のネイティブSDK）をバンドルして表示する。
 * ネットワーク取得はしない。依存を追加・更新したら
 *   npx license-checker --production --json | node scripts/generate-licenses.js
 * で再生成すること。
 *
 * ## 読み込みタイミング（低スペック端末への配慮）
 * 一覧用インデックス（約40KB）と全文（約700KB）を分けてあり、require は
 * 使う関数の中で行う。Metro は require されるまでモジュールを評価しない
 * （かつ一度評価したらキャッシュする）ので:
 *   - 起動時: どちらも読まれない（この画面のモジュール自体、inline requires
 *     により初回描画まで評価されないが、それに依存せず明示的に遅延させる）
 *   - 一覧を開いた時: インデックスのみパース
 *   - 全文をタップした時: 初めて全文をパース（以後キャッシュ）
 *
 * 一覧（名前・バージョン・ライセンス種別）→ タップで全文、の2階層を
 * この画面内の state だけで切り替える（ナビゲーションライブラリは無いので
 * SettingsScreen のオンボーディング表示と同じ「出し分け」方式）。
 *
 * 件数が多いので一覧は FlatList にする（Screen は scrollable=false で
 * スクロールを FlatList に任せる）。全文表示は1件分のテキストなので
 * ScrollView（Screen の既定）でよい。
 */

import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './ui/AnimatedPressable';
import AppHeader from './ui/AppHeader';
import Screen from './ui/Screen';
import Card from './ui/Card';
import { useT } from '../i18n';

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
}

// require のパスは静的文字列なのでバンドルには含まれるが、実行（=パース）は
// この関数が初めて呼ばれた時。2回目以降は Metro のモジュールキャッシュが返る。
function loadIndex(): LicenseEntry[] {
  return require('../licenses/licenses-index.json');
}

function loadText(entry: LicenseEntry): string {
  const texts: Record<string, string> = require('../licenses/licenses-texts.json');
  return texts[`${entry.name}@${entry.version}`] ?? '';
}

const ItemSeparator = () => <View style={styles.separator} />;

interface Props {
  onClose: () => void;
}

export default function LicensesScreen({ onClose }: Props) {
  const { t } = useT();
  const [selected, setSelected] = useState<LicenseEntry | null>(null);

  // useState の initializer で1回だけ読む（再レンダーごとの require 呼び出しを
  // 避ける。キャッシュ済みとはいえ毎回呼ぶ意味はない）。
  const [licenses] = useState(loadIndex);

  // ── 全文表示 ──────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <Screen
        header={
          <AppHeader
            title={selected.name}
            onBack={() => setSelected(null)}
            backLabel={t('common.back')}
          />
        }
        style={styles.detailContainer}
      >
        <Text style={styles.detailMeta}>
          {selected.version}  ·  {selected.license}
        </Text>
        <Card style={styles.detailCard}>
          {/* selectable: 長文のライセンス条文をコピーできるように */}
          <Text style={styles.licenseText} selectable>
            {loadText(selected)}
          </Text>
        </Card>
      </Screen>
    );
  }

  // ── 一覧 ──────────────────────────────────────────────────────────────────
  return (
    <Screen
      header={<AppHeader title={t('settings.licenses')} onBack={onClose} backLabel={t('common.back')} />}
      scrollable={false}
    >
      <FlatList
        data={licenses}
        keyExtractor={item => `${item.name}@${item.version}`}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={ItemSeparator}
        renderItem={({ item }) => (
          <AnimatedPressable
            style={styles.row}
            onPress={() => setSelected(item)}
            pressedScale={0.99}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>
                {item.version}  ·  {item.license}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={IOS.secondary} />
          </AnimatedPressable>
        )}
      />
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// SettingsScreen と同じトークン
const IOS = {
  card:      '#FFFFFF',
  label:     '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
} as const;

const styles = StyleSheet.create({
  // ── 一覧 ──────────────────────────────────────────────────────────────────
  listContent: {
    paddingVertical: 12,
    backgroundColor: IOS.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: IOS.card,
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  rowLabel: { fontSize: 16, color: IOS.label },
  rowSub:   { fontSize: 12, color: IOS.secondary, marginTop: 2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: IOS.separator,
    marginLeft: 20,
  },

  // ── 全文表示 ──────────────────────────────────────────────────────────────
  detailContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  detailMeta: {
    fontSize: 13,
    color: IOS.secondary,
    marginBottom: 8,
    paddingLeft: 4,
  },
  detailCard: {
    width: '100%',
  },
  licenseText: {
    fontSize: 13,
    lineHeight: 19,
    color: IOS.label,
  },
});
