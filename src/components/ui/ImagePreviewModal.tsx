/**
 * ImagePreviewModal — 透過PNG対応の全画面ライトボックス
 *
 * 使い方:
 *   <ImagePreviewModal uris={uris} initial={idx} onClose={() => setIdx(null)} />
 *
 * 特徴:
 *   - 市松背景で透過部分を視認
 *   - 左右スワイプ / ボタンで前後に移動（1枚ならナビ非表示）
 *   - 画像タップ / ✕ボタン / OS バックボタンで閉じる
 *   - key={uri} で URI 変更時に Image 再マウント → 白化防止
 *   - CameraRoll の content:// / ph:// / file:// URI を直接 source に渡す
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './AnimatedPressable';

// ── 市松背景 ──────────────────────────────────────────────────────────────────
// TILE=60 で典型画面(390×844)→ 7×15 = 105 View。size*2 にすると ~20,000 View でフリーズ。
const TILE = 60;

function CheckerBg({ width, height }: { width: number; height: number }) {
  const cols = Math.ceil(width  / TILE);
  const rows = Math.ceil(height / TILE);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {Array.from({ length: cols }, (_, c) => (
            <View
              key={c}
              style={{
                width: TILE,
                height: TILE,
                backgroundColor: (r + c) % 2 === 0 ? '#444444' : '#222222',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  uris: string[];
  initial?: number;
  onClose: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function ImagePreviewModal({ uris, initial = 0, onClose }: Props) {
  const { width: w, height: h } = useWindowDimensions();
  const [idx, setIdx] = useState(initial);
  const total = uris.length;
  const scrollRef = useRef<ScrollView>(null);

  // initial > 0 の場合: ScrollView がレイアウト完了後にスクロール位置を合わせる。
  // contentOffset prop は Android で信頼できないため requestAnimationFrame を使う。
  useEffect(() => {
    if (initial > 0) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: initial * w, animated: false });
      });
    }
  // マウント時1回だけ実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = useCallback((newIdx: number) => {
    const clamped = Math.max(0, Math.min(newIdx, total - 1));
    setIdx(clamped);
    scrollRef.current?.scrollTo({ x: clamped * w, animated: true });
  }, [total, w]);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.bg}>

        {/* 市松背景 */}
        <CheckerBg width={w} height={h} />

        {/* 画像ページ群: 左右スワイプ対応。各ページタップで閉じる */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          style={StyleSheet.absoluteFill}
          onMomentumScrollEnd={e => {
            const newIdx = Math.round(e.nativeEvent.contentOffset.x / w);
            setIdx(newIdx);
          }}
        >
          {uris.map((uri, i) => (
            <Pressable
              key={i}
              style={{ width: w, height: h }}
              onPress={onClose}
            >
              {/* key={uri} で URI が変わるたびに Image を再マウント → 白化・キャッシュ誤表示を防ぐ */}
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: w, height: h }}
                resizeMode="contain"
                onError={() => {}}
              />
            </Pressable>
          ))}
        </ScrollView>

        {/* ✕ 閉じるボタン */}
        <AnimatedPressable style={styles.closeBtn} onPress={onClose}>
          <Icon name="close" size={26} color="#FFF" />
        </AnimatedPressable>

        {/* 前後ナビ: 複数画像のときだけ表示 */}
        {total > 1 && (
          <View style={styles.navRow}>
            <AnimatedPressable
              style={styles.navBtn}
              disabled={idx === 0}
              onPress={() => goTo(idx - 1)}
            >
              <Icon name="chevron-left" size={32} color="#FFF" />
            </AnimatedPressable>

            <Text style={styles.navCounter}>{idx + 1} / {total}</Text>

            <AnimatedPressable
              style={styles.navBtn}
              disabled={idx === total - 1}
              onPress={() => goTo(idx + 1)}
            >
              <Icon name="chevron-right" size={32} color="#FFF" />
            </AnimatedPressable>
          </View>
        )}

      </View>
    </Modal>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#111111',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 6,
  },
  navRow: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  navBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 6,
  },
  navCounter: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '600',
    minWidth: 60,
    textAlign: 'center',
  },
});
