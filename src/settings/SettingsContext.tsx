/**
 * SettingsContext — アプリ設定の共有と永続化を一元管理する
 *
 * 流れ:
 *   1. SettingsProvider がマウント時に AsyncStorage から loadSettings() で設定を読む。
 *   2. 読み込み完了まで DEFAULTS を初期値として表示（フラッシュを最小化）。
 *   3. 各画面は useSettings() フックで settings を読み、updateSettings() で変更する。
 *   4. updateSettings() は state を更新し、AsyncStorage への書き込みも行う。
 *      書き込み失敗は console.warn のみ。UI はクラッシュしない。
 *
 * Provider は index.js（ルート）に一度だけ置く。
 * props ドリルなしに全画面から設定を参照・変更できる。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { loadSettings, saveSettings, DEFAULTS } from './store';
import type { AppSettings } from './store';
import { setLocale } from '../i18n';

// ── Context の型 ──────────────────────────────────────────────────────────────

interface SettingsContextValue {
  /** 現在の設定値。読み込み完了前は DEFAULTS が入っている。 */
  settings: AppSettings;
  /**
   * AsyncStorage からの初回ロードが完了したか。
   * false の間は settings が DEFAULTS（永続値ではない）ため、
   * 初回起動判定など「保存値に依存する分岐」は loaded=true を待つこと。
   */
  loaded: boolean;
  /**
   * 設定を部分的に更新する。
   * 渡したキーだけ上書きし、残りは現在値を維持する（スプレッドでマージ）。
   * 例: updateSettings({ tolerance: 50 }) → gridColumns/thumbBg はそのまま。
   */
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
}

// ── Context 本体 ──────────────────────────────────────────────────────────────

// Provider の外で useSettings() を呼んだ場合のフォールバック。
// 通常は index.js でラップするので到達しないが、テスト時などの安全弁。
const SettingsContext = createContext<SettingsContextValue>({
  settings:       DEFAULTS,
  loaded:         false,
  updateSettings: async () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // 初期値を DEFAULTS にすることで AsyncStorage 読み込み前もクラッシュしない。
  // ハードコード値を App.tsx に書かなくて済むのは DEFAULTS を export した理由。
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // マウント時に AsyncStorage から設定を読み込む（1回のみ）。
  // loadSettings は失敗時も DEFAULTS を返すため、catch は不要。
  useEffect(() => {
    void loadSettings().then(s => {
      // 保存済みの言語を i18n へ反映してから state を更新する。
      // i18n は React の外にモジュール変数で「現在の言語」を持っており、
      // t() を呼ぶ側（imaging 層の throw など）はフックを経由しないため、
      // 設定を読んだこの時点で一度だけ橋渡ししてやる必要がある。
      setLocale(s.language);
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    // 現在値とマージしてから state 更新 + 永続化を同時に行う。
    // state 更新を先に行うことで UI のレスポンスを即時に保ち、
    // AsyncStorage の非同期書き込みが完了するのを待たせない。
    const next = { ...settings, ...partial };
    // 言語が変わった時は i18n 側にも伝える。setLocale は同じ言語なら何もしないので、
    // 言語以外の設定変更でここを通っても再描画は起きない。
    setLocale(next.language);
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, loaded, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ── 消費フック ────────────────────────────────────────────────────────────────

/** 設定を読み書きする。SettingsProvider の子孫コンポーネントで使う。 */
export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
