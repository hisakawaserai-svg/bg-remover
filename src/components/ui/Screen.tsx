/**
 * Screen.tsx — 全画面の共通ラッパー
 *
 * ステータスバー/ノッチ/ホームインジケータ分のインセットを
 * このコンポーネント 1 箇所で吸収する。
 * 各画面が個別に SafeAreaView や paddingTop を持つ必要はない。
 *
 * Props:
 *   children  — スクロール領域に置くコンテンツ
 *   header    — 画面上部に固定するヘッダー（省略可）。
 *               渡された場合、上端インセット込みで固定表示し、
 *               children はその下のスクロール領域に配置される。
 *   style     — children のコンテナに追加するスタイル
 *   scrollable — false にすると ScrollView を使わず View のまま（デフォルト true）
 *   bg        — 背景色（デフォルト #F2F2F7）
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  children: React.ReactNode;
  header?: React.ReactNode;
  /** ScrollView の外・SafeArea 下端の内側に固定するコンテンツ（ボトムボタンなど） */
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  bg?: string;
}

export default function Screen({
  children,
  header,
  footer,
  style,
  scrollable = true,
  bg = '#F2F2F7',
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {header && (
        // ヘッダーがある場合は上端インセット分だけ paddingTop を確保して固定表示。
        // ヘッダー内の要素がノッチやステータスバーに被らないようにする。
        <View style={{ paddingTop: insets.top }}>
          {header}
        </View>
      )}

      {scrollable ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            // ヘッダーがない場合は ScrollView 上端でインセットを確保する。
            !header && { paddingTop: insets.top },
            // footer がある場合はその分の下端余白は footer 側で担う。
            { paddingBottom: footer ? 0 : insets.bottom },
            style,
          ]}
        >
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.fill,
            !header && { paddingTop: insets.top },
            { paddingBottom: footer ? 0 : insets.bottom },
            style,
          ]}
        >
          {children}
        </View>
      )}

      {footer && (
        // ScrollView の外に固定。ホームインジケータ分の padding を確保。
        <View style={{ paddingBottom: insets.bottom }}>
          {footer}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
});
