/**
 * WhatsNewSheet.tsx — 更新内容のシート
 *
 * 起動時は今の版だけ（mode="current"）。設定からは一覧（mode="all"）。
 * 版はアコーディオン。今の版だけ開いておき、過去は見出しだけにする。
 *
 * スクロールを効かせるため、シート本体は Pressable にしない。
 * 外側全体を Pressable にすると、ScrollView のパンを親が奪う。
 */
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from '../components/ui/AnimatedPressable';
import { useT, getLocale } from '../i18n';
import { RELEASES, findRelease, normalizeVersion, type Release } from './releases';

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: 'current' | 'all';
  appVersion: string;
}

function copyOf(release: Release) {
  return getLocale() === 'ja' ? release.ja : release.en;
}

function displayVersion(version: string): string {
  return version.replace(/\.0$/, '');
}

function formatReleaseDate(iso: string, locale: 'ja' | 'en'): string {
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  if (locale === 'ja') return `${y}年${m}月${d}日`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** 今見ているストア側の日付。まだ出していない店は出さない。 */
function dateForThisStore(rel: Release): string | undefined {
  return Platform.OS === 'android' ? rel.dateAndroid : rel.dateIos;
}

export default function WhatsNewSheet({ visible, onClose, mode, appVersion }: Props) {
  const { t } = useT();
  const { height: winH } = useWindowDimensions();
  const current = findRelease(appVersion);
  const list = mode === 'current' ? (current ? [current] : []) : RELEASES;
  const defaultOpen = normalizeVersion((current ?? list[0])?.version ?? '');
  const [openId, setOpenId] = useState(defaultOpen);

  useEffect(() => {
    if (visible) setOpenId(defaultOpen);
  }, [visible, defaultOpen]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: winH * 0.8 }]}>
          <Text style={styles.kicker}>{t('whatsNew.kicker')}</Text>
          <ScrollView
            style={{ maxHeight: winH * 0.8 - 110 }}
            contentContainerStyle={styles.scrollInner}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {list.map(rel => {
              const copy = copyOf(rel);
              const id = normalizeVersion(rel.version);
              const open = openId === id;
              const storeDate = dateForThisStore(rel);
              return (
                <View key={rel.version} style={styles.acc}>
                  <AnimatedPressable
                    style={styles.accHead}
                    onPress={() => setOpenId(open ? '' : id)}
                    pressedScale={0.99}
                  >
                    <View style={styles.accHeadText}>
                      <Text style={styles.version}>
                        {t('whatsNew.versionLabel', { version: displayVersion(rel.version) })}
                        {storeDate
                          ? `  ·  ${formatReleaseDate(storeDate, getLocale())}`
                          : ''}
                      </Text>
                      <Text style={styles.title} numberOfLines={open ? undefined : 1}>
                        {copy.title}
                      </Text>
                    </View>
                    <Icon
                      name={open ? 'expand-less' : 'expand-more'}
                      size={24}
                      color="#8E8E93"
                    />
                  </AnimatedPressable>
                  {open && (
                    <View style={styles.accBody}>
                      {copy.items.map(item => (
                        <Text key={item} style={styles.item}>
                          ・{item}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeTxt}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    paddingTop: 18,
    overflow: 'hidden',
  },
  kicker: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 8,
  },
  scrollInner: { paddingBottom: 4 },
  acc: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C6C6C8',
  },
  accHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 52,
  },
  accHeadText: { flex: 1, paddingRight: 8 },
  version: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  accBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  item: {
    fontSize: 14,
    lineHeight: 21,
    color: '#3A3A3C',
    marginBottom: 6,
  },
  closeBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C6C6C8',
  },
  closeTxt: {
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
});
