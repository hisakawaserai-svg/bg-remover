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
 * ネイティブ側:
 *   iOS は ios/AppIconManager.swift(setAlternateIconName)を使う。
 *   Android の activity-alias 切り替えは未実装なので、モジュールが無い環境では
 *   applyAppIcon は何もせず false を返す(設定値の保存と表示は正しく動く)。
 */
import { NativeModules } from 'react-native';
import { scheduleFor } from '../components/splash/patterns';
import type { AppIconSetting } from '../settings/store';

/** 実際に適用するアイコンの種類。BirdMascot の variant と同じ区分。 */
export type AppIconName = 'day' | 'night' | 'sleep';

/** 表示すべきアイコンを決める。 */
export function resolveAppIcon(setting: AppIconSetting) {
  return setting;
}

/**
 * ネイティブのアイコン切り替えモジュール(iOS: ios/AppIconManager.swift)。
 * Android には未実装なので undefined になる。
 */
interface AppIconManagerModule {
  changeIcon: (name: string | null) => Promise<string>;
}
const nativeAppIconManager: AppIconManagerModule | undefined = (
  NativeModules as { AppIconManager?: AppIconManagerModule }
).AppIconManager;

/**
 * AppIconName → Images.xcassets の appiconset 名。
 * (CFBundleAlternateIcons は Xcode が asset catalog から自動生成するので、
 *  キーは appiconset 名そのものになる。)
 * 'day' は既定アイコン(AppIcon)なので null を渡して代替アイコンを解除する。
 */
const ALTERNATE_ICON_KEY: Record<AppIconName, string | null> = {
  day: null,
  night: 'AppIconNight',
  sleep: 'AppIconSleep',
};

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
  if (!nativeAppIconManager) {
    if (__DEV__) {
      console.warn(
        '[appIcon] このプラットフォームではアイコン切り替え未対応のため、設定は' +
          '保存されるがホーム画面のアイコンは変わりません' +
          '(Android: activity-alias の実装が必要)。',
      );
    }
    return false;
  }
  try {
    await nativeAppIconManager.changeIcon(ALTERNATE_ICON_KEY[name]);
    applied = name;
    return true;
  } catch (e) {
    console.warn('[appIcon] changeIcon failed:', e);
    return false;
  }
}
