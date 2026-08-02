/**
 * ImageZoomModal.tsx — カット画像／元画像の全画面ズーム表示。
 *
 * 分割結果(ResultScreen)のヘッダーと挙動を統一するための共通部品。
 * 背景タップ/戻るで閉じる。URI を contain で全画面表示する。
 *
 * showShare を渡すと共有ボタンを出す。カット画像を表示するときだけ有効にし、
 * 元画像のズームでは出さない（元画像をそのまま共有できても意味がないため）。
 */
import React from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useT } from '../../i18n';
import { useThumbBg } from '../../hooks/useThumbBg';
import { shareImages } from '../../share/shareImages';
import CheckerboardBg from './CheckerboardBg';

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
  const { width: winW, height: winH } = useWindowDimensions();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={useBgSetting ? styles.plainBackdrop : styles.backdrop}
        onPress={onClose}
        activeOpacity={1}
      >
        {/* 市松は tile を大きめに取る。サムネと同じ 14px だと全画面では細かすぎる。 */}
        {useBgSetting && <CheckerboardBg mode={bg} tile={40} width={winW} height={winH} />}
        <Image source={{ uri }} style={styles.img} resizeMode="contain" />
      </TouchableOpacity>

      {/* 背景の TouchableOpacity の「外」に置く。中に入れると共有ボタンのタップが
          背景タップとしても扱われ、共有シートが出る前にモーダルが閉じてしまう。 */}
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
