/**
 * AppHeader — 全画面共通ヘッダーコンポーネント
 *
 * レイアウト: 左(戻る) | 中央(タイトル) | 右(アクションスロット)
 *
 * - 戻るボタン: onBack を渡すと表示。backLabel でテキスト付き戻るに変えられる。
 * - タイトル: 中央寄せ
 * - 右スロット: right prop で任意要素を差し込む。
 *   よく使う構成は <HeaderActions> を渡すだけで済む。
 */
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './AnimatedPressable';

// ── トークン（theme.ts と同値。import を増やさず自己完結させる） ──────────────
const CARD      = '#FFFFFF';
const SEPARATOR = '#C6C6C8';
const ACCENT    = '#007AFF';
const LABEL     = '#000000';
const HIT_SLOP  = { top: 10, bottom: 10, left: 10, right: 10 };

interface Props {
  title: string;
  /** 渡すと左端に chevron-left ボタンを表示 */
  onBack?: () => void;
  /** 戻るボタンに添えるラベル(例: "戻る" "編集に戻る") */
  backLabel?: string;
  /** ヘッダー右端に配置する任意要素 */
  right?: React.ReactNode;
  style?: ViewStyle;
}

export default function AppHeader({ title, onBack, backLabel, right, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      {/* ── 左: 戻るボタン or プレースホルダー ── */}
      <View style={styles.side}>
        {onBack ? (
          <AnimatedPressable
            onPress={onBack}
            style={styles.backBtn}
          >
            <Icon name="chevron-left" size={26} color={ACCENT} />
            {backLabel ? (
              <Text style={styles.backLabel}>{backLabel}</Text>
            ) : null}
          </AnimatedPressable>
        ) : null}
      </View>

      {/* ── 中央: タイトル ── */}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      {/* ── 右: アクションスロット ── */}
      <View style={[styles.side, styles.rightSide]}>
        {right ?? null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   CARD,
    borderBottomWidth: 0.5,
    borderBottomColor: SEPARATOR,
    paddingHorizontal: 4,
    paddingVertical:   12,
    minHeight:         48,
  },
  // 左右は同じ flex 値で、タイトルを中央に保つ
  side: {
    flex:       1,
    alignItems: 'flex-start',
  },
  rightSide: {
    alignItems: 'flex-end',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingLeft:   4,
    paddingRight:  8,
    paddingVertical: 4,
  },
  backLabel: {
    fontSize:   16,
    color:      ACCENT,
    marginLeft: -2,
  },
  title: {
    fontSize:   17,
    fontWeight: '600',
    color:      LABEL,
    textAlign:  'center',
    flexShrink: 1,
  },
});
