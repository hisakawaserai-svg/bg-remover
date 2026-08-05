/**
 * SelectRow.tsx — 設定リストの「選ぶ」行（iOS のプルダウン相当）
 *
 * 行には「項目名 … 現在の選択 ⌄」を出し、押すと選択肢が下から展開される。
 * ラジオボタンを並べる方式にしないのは、選択肢が増えるほど設定画面が
 * 縦に伸びて他の項目が埋もれるため。
 *
 * iOS はネイティブの ActionSheet をそのまま使う（OS の見た目・操作感に合う）。
 * Android には ActionSheetIOS が無いので、同じ形のシートを Modal で用意する。
 *
 * 選択肢は options 配列で渡すだけなので、項目が増えても行を1つ足すだけで済む。
 */
import React, { useState } from 'react';
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AnimatedPressable } from './AnimatedPressable';
import { useT } from '../../i18n';

const IOS = {
  card: '#FFFFFF',
  blue: '#007AFF',
  label: '#000000',
  secondary: '#8E8E93',
  separator: '#C6C6C8',
  backdrop: 'rgba(0,0,0,0.35)',
} as const;

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** MaterialIcons のアイコン名（任意）。選択肢が多くて見分けにくい時に使う。 */
  icon?: string;
}

interface Props<T extends string> {
  label: string;
  /** 補足説明（任意）。 */
  sub?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

export default function SelectRow<T extends string>({
  label,
  sub,
  value,
  options,
  onChange,
}: Props<T>) {
  const { t } = useT();
  const [sheetOpen, setSheetOpen] = useState(false);

  const current = options.find(o => o.value === value) ?? options[0];

  const open = () => {
    if (Platform.OS === 'ios') {
      const labels = options.map(o => o.label);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: label,
          options: [...labels, t('common.cancel')],
          cancelButtonIndex: labels.length,
          // 現在の選択にチェックは付かないので、タイトルで文脈を補う。
          userInterfaceStyle: 'light',
        },
        index => {
          if (index >= 0 && index < options.length) {
            onChange(options[index].value);
          }
        },
      );
      return;
    }
    setSheetOpen(true);
  };

  return (
    <>
      <AnimatedPressable style={styles.row} onPress={open} pressedScale={0.98}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowLabel}>{label}</Text>
          {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
        </View>
        <View style={styles.rowRight}>
          {!!current?.icon && (
            <Icon name={current.icon} size={16} color={IOS.secondary} style={styles.rowValueIcon} />
          )}
          <Text style={styles.rowValue} numberOfLines={1}>
            {current?.label ?? ''}
          </Text>
          <Icon name="expand-more" size={20} color={IOS.secondary} />
        </View>
      </AnimatedPressable>

      {/* Android 用。iOS はネイティブの ActionSheet を使うのでここは開かない。 */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {options.map(o => {
              const on = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  style={styles.sheetItem}
                  onPress={() => {
                    setSheetOpen(false);
                    onChange(o.value);
                  }}>
                  <View style={styles.sheetItemLeft}>
                    {!!o.icon && (
                      <Icon
                        name={o.icon}
                        size={20}
                        color={on ? IOS.blue : IOS.secondary}
                        style={styles.sheetItemIcon}
                      />
                    )}
                    <Text style={[styles.sheetItemTxt, on && styles.sheetItemTxtOn]}>
                      {o.label}
                    </Text>
                  </View>
                  {on && <Icon name="check" size={20} color={IOS.blue} />}
                </Pressable>
              );
            })}
            <Pressable
              style={styles.sheetCancel}
              onPress={() => setSheetOpen(false)}>
              <Text style={styles.sheetCancelTxt}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 16, color: IOS.label },
  rowSub: { fontSize: 12, color: IOS.secondary, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', maxWidth: '52%' },
  rowValueIcon: { marginRight: 4 },
  rowValue: { fontSize: 15, color: IOS.secondary, marginRight: 2 },

  backdrop: {
    flex: 1,
    backgroundColor: IOS.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: IOS.card,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 24,
  },
  sheetTitle: {
    fontSize: 13,
    color: IOS.secondary,
    textAlign: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IOS.separator,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IOS.separator,
  },
  sheetItemLeft: { flexDirection: 'row', alignItems: 'center' },
  sheetItemIcon: { marginRight: 10 },
  sheetItemTxt: { fontSize: 17, color: IOS.label },
  sheetItemTxtOn: { color: IOS.blue, fontWeight: '600' },
  sheetCancel: { paddingVertical: 15, alignItems: 'center' },
  sheetCancelTxt: { fontSize: 17, color: IOS.blue, fontWeight: '600' },
});
