/**
 * appIcon/index.ts — ホーム画面のアプリアイコンの決定と適用
 *
 * 決め方(優先順位):
 *   1. ユーザー設定が 'auto' 以外 → その配色で固定
 *   2. 'auto' → 時間帯スケジュール(スプラッシュと同じ scheduleFor を使う)
 *
 * 時間帯の境目をスプラッシュと共有しているので、「夜は月のアイコン・
 * 起動演出も夜」のように世界観がずれない。
 *
 * ⚠ ネイティブ側の実装が別途必要:
 *   iOS は Info.plist の CFBundleAlternateIcons と setAlternateIconName、
 *   Android は activity-alias の有効/無効切り替えが要る。どちらも JS だけでは
 *   できないため、ネイティブモジュールが無い環境では applyAppIcon は何もせず
 *   false を返す(設定値の保存と表示は正しく動く)。
 */
import { NativeModules } from 'react-native';
import { scheduleFor } from '../components/splash/patterns';
import type { AppIconSetting } from '../settings/store';

/** 実際に適用するアイコンの種類。BirdMascot の variant と同じ区分。 */
export type AppIconName = 'day' | 'night' | 'sleep';

/** 設定値と現在時刻から、表示すべきアイコンを決める。 */
export function resolveAppIcon(
  setting: AppIconSetting,
  now: Date = new Date(),
): AppIconName {
  if (setting !== 'auto') {
    return setting;
  }
  return scheduleFor(now.getHours()).variant;
}

/**
 * ネイティブのアイコン切り替えモジュール。
 *
 * 名前は react-native-change-icon 互換にしてある。導入したらこのファイルは
 * 変更不要で動き出す(未導入なら undefined のまま)。
 */
interface ChangeIconModule {
  changeIcon: (name: string | null) => Promise<string>;
}
const nativeChangeIcon: ChangeIconModule | undefined = (
  NativeModules as { ChangeIcon?: ChangeIconModule }
).ChangeIcon;

/** 既に適用済みの名前。同じ値で何度も呼ばない(iOS はトーストが出るため)。 */
let applied: AppIconName | null = null;

/**
 * アイコンを適用する。切り替えを実行したら true。
 *
 * ネイティブモジュールが無い場合は false を返すだけで、例外は投げない
 * (設定画面の操作が失敗したように見えるのを避けるため)。
 */
export async function applyAppIcon(name: AppIconName): Promise<boolean> {
  if (applied === name) {
    return false;
  }
  if (!nativeChangeIcon) {
    if (__DEV__) {
      console.warn(
        '[appIcon] ネイティブのアイコン切り替えが未導入のため、設定は保存されるが' +
          'ホーム画面のアイコンは変わりません(iOS: CFBundleAlternateIcons /' +
          ' Android: activity-alias の設定が必要)。',
      );
    }
    return false;
  }
  try {
    // 'day' を既定アイコンにする場合は null を渡す実装が一般的なので合わせる。
    await nativeChangeIcon.changeIcon(name === 'day' ? null : name);
    applied = name;
    return true;
  } catch (e) {
    console.warn('[appIcon] changeIcon failed:', e);
    return false;
  }
}
