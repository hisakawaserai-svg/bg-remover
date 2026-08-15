/**
 * ImagePreviewModal — 透過PNG対応の全画面ライトボックス
 *
 * 使い方:
 *   <ImagePreviewModal uris={uris} initial={idx} onClose={() => setIdx(null)} />
 *
 * 特徴:
 *   - 背景は設定「背景色」に連動（市松/白/黒）。サムネのグリッドと同じ見え方になる
 *   - 左右スワイプ / ボタンで前後に移動（1枚ならナビ非表示）
 *   - 等倍時: 画像タップ / ✕ボタン / OS バックボタンで閉じる
 *   - ピンチで拡大縮小、拡大中は1本指ドラッグで移動できる。拡大中はページ送りの
 *     横スワイプと画像タップでの close を横取りされないよう無効化し、等倍に戻ると
 *     自動で元に戻す（詳しくは下のジェスチャー周りのコメント参照）
 *   - key={uri} で URI 変更時に Image 再マウント → 白化防止
 *   - CameraRoll の content:// / ph:// / file:// URI を直接 source に渡す
 *
 * ピンチ/ドラッグは react-native-gesture-handler の Gesture.Pinch/Gesture.Pan
 * を使う。当初 RN 標準の PanResponder で自前実装していたが、複数指のタッチ追跡が
 * 不安定（React Native の New Architecture 下で特に）で「ピンチが効く時と
 * 効かない時がある」という不具合が解消できなかったため、ネイティブ側で
 * ジェスチャーを認識する gesture-handler に置き換えた（ImageZoomModal と同じ経緯）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './AnimatedPressable';
import CheckerboardBg from './CheckerboardBg';
import { shareImages } from '../../share/shareImages';
import { resolvePhUri } from '../../imaging/resolvePhUri';
import { useThumbBg } from '../../hooks/useThumbBg';

// 市松のタイルサイズ。
// TILE=60 で典型画面(390×844)→ 7×15 = 105 View。size*2 にすると ~20,000 View でフリーズ。
const TILE = 60;

// ピンチズームの倍率範囲。1 = contain 表示のまま（それ以上縮小はできない）。
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  uris: string[];
  initial?: number;
  onClose: () => void;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function ImagePreviewModal({ uris, initial = 0, onClose }: Props) {
  const { width: w, height: h } = useWindowDimensions();
  const bg = useThumbBg();
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

  // ph:// は表示するとアルファが白へ潰れ、共有ではリンク扱いになる。
  // 今見ている1枚だけ実ファイルへ解決する（全件やると重い）。
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    const uri = uris[idx];
    if (!uri || resolved[uri]) return;
    let alive = true;
    void (async () => {
      const path = await resolvePhUri(uri);
      if (alive && path !== uri) setResolved(prev => ({ ...prev, [uri]: path }));
    })();
    return () => { alive = false; };
  }, [idx, uris, resolved]);

  /** 表示・共有に使う URI。解決済みならそちらを優先する。 */
  const displayUri = (uri: string) => resolved[uri] ?? uri;

  // ── ピンチズーム／パン ───────────────────────────────────────────────────────
  // 表示倍率・オフセット。今見ているページ1枚分だけを対象にする
  // （他ページは画面外でタッチできないため、共有の値で問題ない）。
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const baseTranslateX = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  const focalOriginX = useSharedValue(0);
  const focalOriginY = useSharedValue(0);
  // 拡大中はページ送りの横スワイプと画像タップでの close を無効化する
  // （ドラッグでの移動・誤タップでの意図しない close/ページ送りを防ぐ）。
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // ページを切り替えたら拡大率をリセットする（前のページの拡大を持ち越さない）。
  useEffect(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    baseScale.value = 1;
    baseTranslateX.value = 0;
    baseTranslateY.value = 0;
    setScrollEnabled(true);
  }, [idx, scale, translateX, translateY, baseScale, baseTranslateX, baseTranslateY]);

  const pinch = Gesture.Pinch()
    .onStart(e => {
      baseScale.value = scale.value;
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
      focalOriginX.value = e.focalX;
      focalOriginY.value = e.focalY;
      runOnJS(setScrollEnabled)(false);
    })
    .onUpdate(e => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, baseScale.value * e.scale));
      const maxTx = Math.max(0, (w * (next - 1)) / 2);
      const maxTy = Math.max(0, (h * (next - 1)) / 2);
      // 指の中間点（現在位置）を基準に拡大する。画像中心固定だと、つまんだ場所と
      // 実際に拡大される場所がズレて操作しづらくなるため、ピンチ開始時にその指の
      // 下にあった画像上の点が同じ場所に留まるよう tx/ty も一緒に動かす。
      const ratio = next / baseScale.value;
      const cx = w / 2, cy = h / 2;
      const rawTx = (e.focalX - cx) - ((focalOriginX.value - cx) - baseTranslateX.value) * ratio;
      const rawTy = (e.focalY - cy) - ((focalOriginY.value - cy) - baseTranslateY.value) * ratio;
      scale.value = next;
      translateX.value = Math.min(maxTx, Math.max(-maxTx, rawTx));
      translateY.value = Math.min(maxTy, Math.max(-maxTy, rawTy));
    })
    .onEnd(() => {
      baseScale.value = scale.value;
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
      // 等倍まで戻っていればページ送りのスワイプを再度使えるようにする。
      runOnJS(setScrollEnabled)(scale.value <= 1.001);
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onTouchesDown((_e, stateManager) => {
      // 等倍時はこのジェスチャーを不成立にし、下の Pressable（タップで close）
      // と ScrollView（横スワイプでページ送り）にそのまま触れさせる。
      // ここで弾かないと、指を動かしただけで Pan が成立してしまい、
      // 等倍時のタップ close・横スワイプが機能しなくなる。
      if (scale.value <= ZOOM_MIN) {
        stateManager.fail();
      }
    })
    .onStart(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    })
    .onUpdate(e => {
      // 拡大中のみドラッグで移動できる（等倍時はドラッグしても動かない＝
      // 画像タップでの close・ページ送りのスワイプをそのまま生かす）。
      if (scale.value <= ZOOM_MIN) return;
      const maxTx = Math.max(0, (w * (scale.value - 1)) / 2);
      const maxTy = Math.max(0, (h * (scale.value - 1)) / 2);
      translateX.value = Math.min(maxTx, Math.max(-maxTx, baseTranslateX.value + e.translationX));
      translateY.value = Math.min(maxTy, Math.max(-maxTy, baseTranslateY.value + e.translationY));
    })
    .onEnd(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const goTo = useCallback((newIdx: number) => {
    const clamped = Math.max(0, Math.min(newIdx, total - 1));
    setIdx(clamped);
    scrollRef.current?.scrollTo({ x: clamped * w, animated: true });
  }, [total, w]);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.bg}>

        {/* 背景（設定「背景色」に連動）。グリッドのサムネと同じ CheckerboardBg を使う。 */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <CheckerboardBg mode={bg} tile={TILE} width={w} height={h} />
        </View>

        {/* 画像ページ群: 左右スワイプ対応。等倍時は各ページタップで閉じる。
            拡大中はページ送り(scrollEnabled)を止め、ピンチ/ドラッグに切り替える
            （上のコメント参照）。ページごとに Gesture インスタンスを作る
            （同じ Gesture オブジェクトを複数の GestureDetector へ同時に
            付けるとハンドラーが衝突するため）。共有値・onClose 等は
            クロージャ経由で共通のものを使う。 */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          style={StyleSheet.absoluteFill}
          onMomentumScrollEnd={e => {
            const newIdx = Math.round(e.nativeEvent.contentOffset.x / w);
            setIdx(newIdx);
          }}
        >
          {uris.map((uri, i) => (
            <GestureDetector key={i} gesture={Gesture.Simultaneous(pinch, pan)}>
              <View style={{ width: w, height: h }}>
                <Pressable
                  style={{ width: w, height: h }}
                  onPress={onClose}
                >
                  {/* key={uri} で URI が変わるたびに Image を再マウント → 白化・キャッシュ誤表示を防ぐ。
                      今見ているページだけ拡大・移動を反映する（他ページは画面外で
                      タッチできないので等倍のままで問題ない）。 */}
                  <Animated.Image
                    key={displayUri(uri)}
                    source={{ uri: displayUri(uri) }}
                    style={[{ width: w, height: h }, i === idx ? imgAnimStyle : undefined]}
                    resizeMode="contain"
                    onError={() => {}}
                  />
                </Pressable>
              </View>
            </GestureDetector>
          ))}
        </ScrollView>

        {/* ✕ 閉じるボタン */}
        <AnimatedPressable style={styles.closeBtn} onPress={onClose}>
          <Icon name="close" size={26} color="#FFF" />
        </AnimatedPressable>

        {/* 共有（今表示している1枚）。閉じるボタンの隣に置く。 */}
        <AnimatedPressable
          style={styles.shareBtn}
          onPress={() => void shareImages([displayUri(uris[idx])])}
        >
          <Icon name="ios-share" size={22} color="#FFF" />
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
  // 閉じるボタンの左隣。背景が白でも読めるよう暗いチップにする。
  shareBtn: {
    position: 'absolute',
    top: 52,
    right: 70,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 8,
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
