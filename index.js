/**
 * @format
 */

import { AppRegistry } from 'react-native';
// SafeAreaProvider: react-native-safe-area-context の useSafeAreaInsets / SafeAreaView が
// 正しいインセット値を取得するために必要なコンテキスト。
// アプリのルートに一度だけ置く（複数ネストは不要）。
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import { name as appName } from './app.json';
// SettingsProvider: アプリ全体で設定を共有するコンテキスト。
// SafeAreaProvider と同じくルートに一度だけ置く。
import { SettingsProvider } from './src/settings/SettingsContext';
// StatsProvider: 利用統計（端末内のみ・外部送信なし）を共有するコンテキスト。
// 設定とはキー・型を分離してあるので別 Provider にしている。
import { StatsProvider } from './src/stats/StatsContext';
// 広告SDKの初期化はここでは行わない。UMP(GDPR)/ATT の同意を取ってから
// 初期化する必要があるため、App.tsx がオンボーディング完了後（既存ユーザーは
// 設定ロード後）に gatherAdsConsentAndInit() を呼ぶ（src/ads/consent.ts 参照）。

function Root() {
  return (
    <SafeAreaProvider>
      {/* SettingsProvider を SafeAreaProvider の内側に置くことで、
          設定コンテキストが SafeArea の値を参照できる（将来の拡張余地）。 */}
      <SettingsProvider>
        <StatsProvider>
          <App />
        </StatsProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent(appName, () => Root);
