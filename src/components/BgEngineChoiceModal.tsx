/**
 * BgEngineChoiceModal.tsx — 背景除去の方式を選ぶモーダル
 *
 * 以前は ActionSheetIOS（テキストだけの選択肢）を使っていたが、
 * 「色ベースとVisionで何が違うのか、選んでも見た目で伝わらない」と
 * 報告されたため、アイコン＋タイトル＋「これを選ぶと何が起きるか」を
 * 明記した2択カードに作り替えた。
 *
 * カードの文言は「方式の名前」ではなく「結果として何が起きるか」を
 * 主語にして書くこと（例:「色ベース」ではなく「背景の色を基準に透過」）。
 * ユーザーが困っていたのは名前ではなく、結果の予測がつかないことだった。
 */
import React from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useT } from '../i18n';
import type { BgEngine } from '../settings/store';

interface Props {
  visible: boolean;
  /** 被写体検出がこの端末で使えるか。false なら押しても選ばず案内だけ出す。 */
  subjectSupported: boolean;
  onChoose: (engine: BgEngine) => void;
  onCancel: () => void;
}

const IOS = {
  backdrop: 'rgba(0,0,0,0.45)',
  card: '#1C1C1E',
  separator: 'rgba(255,255,255,0.12)',
  blue: '#0A84FF',
  purple: '#BF5AF2',
};

export default function BgEngineChoiceModal({ visible, subjectSupported, onChoose, onCancel }: Props) {
  const { t } = useT();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* 中身へのタップがバックドロップまで抜けて閉じてしまわないよう止める。 */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{t('bgEngineChoice.title')}</Text>
          <Text style={styles.subtitle}>{t('bgEngineChoice.subtitle')}</Text>

          <View style={styles.stack}>
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => onChoose('flood')}
            >
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(10,132,255,0.16)' }]}>
                <Icon name="opacity" size={26} color={IOS.blue} />
              </View>
              <Text style={styles.cardTitle}>{t('settings.bgEngineFlood')}</Text>
              <Text style={styles.cardDesc}>{t('bgEngineChoice.floodDesc')}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.card,
                !subjectSupported && styles.cardDimmed,
                pressed && styles.cardPressed,
              ]}
              onPress={() => {
                if (!subjectSupported) {
                  Alert.alert(
                    t('settings.bgEngineOsTooLowTitle'),
                    t('settings.bgEngineOsTooLowMessage'),
                  );
                  return;
                }
                onChoose('vision');
              }}
            >
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(191,90,242,0.16)' }]}>
                <Icon name="auto-awesome" size={26} color={IOS.purple} />
              </View>
              <Text style={styles.cardTitle}>
                {Platform.OS === 'android' ? t('settings.bgEngineMlkit') : t('settings.bgEngineVision')}
              </Text>
              <Text style={styles.cardDesc}>{t('bgEngineChoice.visionDesc')}</Text>
              <Text style={styles.cardCaution}>
                {subjectSupported
                  ? t('bgEngineChoice.visionCaution')
                  : t('settings.bgEngineOsTooLowMessage')}
              </Text>
            </Pressable>
          </View>

          <Pressable style={styles.cancelBtn} onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancelTxt}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: IOS.backdrop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: IOS.card,
    borderRadius: 18,
    padding: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  stack: {
    flexDirection: 'column',
    gap: 10,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardPressed: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cardDimmed: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.75)',
  },
  cardCaution: {
    fontSize: 11,
    lineHeight: 15,
    color: '#FF9F0A',
    marginTop: 8,
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: IOS.separator,
  },
  cancelTxt: {
    fontSize: 15,
    color: IOS.blue,
    fontWeight: '600',
  },
});
