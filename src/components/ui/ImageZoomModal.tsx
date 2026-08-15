/**
 * ImageZoomModal.tsx — カット画像／元画像の全画面ズーム表示。
 *
 * 分割結果(ResultScreen)のヘッダーと挙動を統一するための共通部品。
 * ✕ボタン/戻るで閉じる。ピンチで拡大縮小、拡大中はドラッグで移動できる。
 * URI を contain で全画面表示する。
 *
 * 以前は背景タップでも閉じられたが、ピンチ/ドラッグ操作と誤反応するのと、
 * 閉じ方が発見しづらい（実機ユーザーから「戻れない」と報告があった）ため、
 * ✕ボタン方式へ統一した。見た目は保存後のプレビュー（ImagePreviewModal）の
 * ✕ボタンに合わせてある。
 *
 * ピンチ/ドラッグは react-native-gesture-handler の Gesture.Pinch/Gesture.Pan
 * を使う。当初 RN 標準の PanResponder で自前実装していたが、複数指の
 * タッチ追跡が不安定（React Native の New Architecture 下で特に）で
 * 「ピンチが効く時と効かない時がある」という不具合が解消できなかったため、
 * ネイティブ側でジェスチャーを認識する gesture-handler に置き換えた。
 *
 * showShare を渡すと共有ボタンを出す。カット画像を表示するときだけ有効にし、
 * 元画像のズームでは出さない（元画像をそのまま共有できても意味がないため）。
 */
import React, { useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useT } from '../../i18n';
import { useThumbBg } from '../../hooks/useThumbBg';
import { shareImages } from '../../share/shareImages';
import CheckerboardBg from './CheckerboardBg';
import { AnimatedPressable } from './AnimatedPressable';

// ピンチズームの倍率範囲。1 = contain 表示のまま（それ以上縮小はできない）。
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

interface Props {
  visible: boolean;
  uri: string;
  onClose: () => void;
  /** 共有ボタンを表示するか。既定は非表示（元画像ズームでの誤爆を防ぐ）。 */
  showShare?: boolean;
  /**
   * 背景に「背景色」設定を反映するか。既定は従来どおりの暗幕。
   * 透過画像を等倍で見る用途（カット画像の拡大）でだけ有効にする。
   * 元画像は不透過なので、暗幕のままのほうが見やすい。
   */
  useBgSetting?: boolean;
}

export default function ImageZoomModal({ visible, uri, onClose, showShare, useBgSetting }: Props) {
  const { t } = useT();
  const bg = useThumbBg();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  // 表示倍率・オフセット。ジェスチャーは UI スレッドで直接この値を書き換える。
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // 直近のジェスチャー開始時点のスナップショット（差分計算の基準）。
  const baseScale = useSharedValue(1);
  const baseTranslateX = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  // ピンチ開始時点の指の中間点（View 座標）。指の位置を中心に拡大するための基準。
  const focalOriginX = useSharedValue(0);
  const focalOriginY = useSharedValue(0);

  // 開くたびに拡大率をリセットする（前回開いた時の拡大位置を持ち越さない）。
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      baseScale.value = 1;
      baseTranslateX.value = 0;
      baseTranslateY.value = 0;
    }
  }, [visible, scale, translateX, translateY, baseScale, baseTranslateX, baseTranslateY]);

  const pinch = Gesture.Pinch()
    .onStart(e => {
      baseScale.value = scale.value;
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
      focalOriginX.value = e.focalX;
      focalOriginY.value = e.focalY;
    })
    .onUpdate(e => {
      // 拡大後にはみ出す量だけ動かせるように制限する（contain 表示が前提）。
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, baseScale.value * e.scale));
      const maxTx = Math.max(0, (winW * (next - 1)) / 2);
      const maxTy = Math.max(0, (winH * (next - 1)) / 2);
      // 指の中間点（現在位置）を基準に拡大する。画像中心固定だと、つまんだ
      // 場所と実際に拡大される場所がズレて操作しづらくなるため、ピンチ開始時に
      // その指の下にあった画像上の点が同じ場所に留まるよう tx/ty も一緒に動かす。
      const ratio = next / baseScale.value;
      const cx = winW / 2, cy = winH / 2;
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
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    })
    .onUpdate(e => {
      // 拡大中のみドラッグで移動できる（等倍時はドラッグしても動かない）。
      if (scale.value <= ZOOM_MIN) return;
      const maxTx = Math.max(0, (winW * (scale.value - 1)) / 2);
      const maxTy = Math.max(0, (winH * (scale.value - 1)) / 2);
      translateX.value = Math.min(maxTx, Math.max(-maxTx, baseTranslateX.value + e.translationX));
      translateY.value = Math.min(maxTy, Math.max(-maxTy, baseTranslateY.value + e.translationY));
    })
    .onEnd(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  // 2本指ピンチ・1本指ドラッグを同時に有効にする（pan は maxPointers(1) なので
  // ピンチ中は自然に発火せず、指を1本に減らした瞬間からドラッグへ引き継がれる）。
  const composed = Gesture.Simultaneous(pinch, pan);

  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <GestureDetector gesture={composed}>
        <View style={useBgSetting ? styles.plainBackdrop : styles.backdrop}>
          {/* 市松は tile を大きめに取る。サムネと同じ 14px だと全画面では細かすぎる。 */}
          {useBgSetting && <CheckerboardBg mode={bg} tile={40} width={winW} height={winH} />}
          <Animated.Image source={{ uri }} style={[styles.img, imgAnimStyle]} resizeMode="contain" />
        </View>
      </GestureDetector>

      {/* ✕ 閉じるボタン。見た目は ImagePreviewModal と統一。 */}
      <AnimatedPressable
        style={[styles.closeBtn, { top: insets.top + 12 }]}
        onPress={onClose}
        accessibilityLabel={t('common.close')}
      >
        <Icon name="close" size={26} color="#FFF" />
      </AnimatedPressable>

      {/* GestureDetector の「外」に置く。中に入れると共有ボタンのタップが
          ジェスチャーとしても扱われかねないため分離している。 */}
      {showShare && (
        <View style={styles.shareWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => void shareImages([uri])}
            activeOpacity={0.8}
          >
            <Icon name="ios-share" size={20} color="#FFF" />
            <Text style={styles.shareTxt}>{t('common.share')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 背景色設定を使う場合。地色は CheckerboardBg が敷くので暗幕は置かない。
  plainBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    width: '100%',
    height: '100%',
  },
  // ImagePreviewModal の closeBtn と見た目を統一（right だけ insets.top 分を動的に足す）。
  closeBtn: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 6,
  },
  shareWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 48,
    alignItems: 'center',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    // 白抜き文字を載せるので、地色が白でも黒でも読めるよう暗い不透明寄りのチップにする。
    // 半透明の白地(rgba(255,255,255,0.18))だと背景色設定が「白」のとき文字が消える。
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  shareTxt: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
