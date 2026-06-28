/**
 * ImageZoomModal.tsx — ヘッダーの「元画像」アイコンから開く全画面ズーム表示。
 *
 * 分割結果(ResultScreen)のヘッダーと挙動を統一するための共通部品。
 * 背景タップ/戻るで閉じる。元画像 URI を contain で全画面表示する。
 */
import React from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  visible: boolean;
  uri: string;
  onClose: () => void;
}

export default function ImageZoomModal({ visible, uri, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1}>
        <Image source={{ uri }} style={styles.img} resizeMode="contain" />
      </TouchableOpacity>
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
  img: {
    width: '100%',
    height: '100%',
  },
});
