import { NativeModules, TurboModuleRegistry } from 'react-native';

interface AppInfoModule {
  version: string;
}

function getNativeAppInfo(): AppInfoModule | undefined {
  try {
    const mod = TurboModuleRegistry.get('AppInfo') as AppInfoModule | null;
    if (mod) return mod;
  } catch {
    // 次の経路へ。
  }
  return (NativeModules as { AppInfo?: AppInfoModule }).AppInfo;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PACKAGE_JSON_VERSION: string = (require('../../package.json') as { version: string }).version;

/** 設定のバージョン表示と同じ値。ネイティブが無ければ package.json。 */
export function getAppVersion(): string {
  return getNativeAppInfo()?.version || PACKAGE_JSON_VERSION;
}
