/**
 * i18n/index.ts — 文言の取得と言語の切り替え。
 *
 * 【React の外からも呼べることが要件】
 * 文言は画面だけでなく imaging 層の throw やエラー変換（saveErrors.ts）でも要る。
 * それらは React コンポーネントではないのでフックが使えない。
 * そこで「現在の言語」をモジュール変数で持ち、素の関数 t() を公開する。
 * 画面側は useT() を使い、言語が変わった時に再描画されるようにする。
 *
 * 【設定との関係】
 * 言語は AppSettings.language（'auto' | 'ja' | 'en'）に永続化する。
 * 設定を読み込んだ / 変更した時に SettingsContext が setLocale() を呼び、
 * ここのモジュール変数を更新する。i18n 側から AsyncStorage は触らない
 * （設定の読み書きは settings/store.ts に一本化されているため）。
 */
import { useSyncExternalStore } from 'react';
import { NativeModules, Platform } from 'react-native';

import ja from './ja';
import en from './en';
import type { CatalogNode, PathsOf, Plural, Vars } from './types';

export type { Plural, Vars } from './types';

/** 対応言語。増やす時はここと CATALOGS に足す。 */
export type Locale = 'ja' | 'en';

/** 設定に保存する値。'auto' は端末の言語に追従する。 */
export type LanguageSetting = 'auto' | Locale;

const CATALOGS: Record<Locale, CatalogNode> = { ja, en };

/** ja.ts を正としたキーの型。存在しないキーはコンパイルエラーになる。 */
export type TKey = PathsOf<typeof ja>;

/** 端末の言語が未対応だった場合に使う言語。 */
const FALLBACK: Locale = 'en';

// ── 端末の言語を調べる ──────────────────────────────────────────────────────

/**
 * 端末の言語タグ（'ja-JP' など）を返す。取れなければ空文字。
 *
 * react-native-localize を使えば確実だがネイティブモジュールなので pod install が要る。
 * Share Extension の作業を控えていてネイティブ構成を増やしたくないため、
 * 追加依存なしで取れる経路だけを順に試す。
 */
function deviceLanguageTag(): string {
  // 1) Intl（Hermes の ICU）。New Architecture / bridgeless でも使えるのでまず試す。
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag) return tag;
  } catch {
    // Intl 無効ビルドではここに来る。次の経路へ。
  }

  // 2) ネイティブモジュール経由。bridgeless では取れないことがあるので任意扱い。
  try {
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      const tag = s?.AppleLocale ?? s?.AppleLanguages?.[0];
      if (typeof tag === 'string' && tag) return tag;
    } else {
      const tag = NativeModules.I18nManager?.localeIdentifier;
      if (typeof tag === 'string' && tag) return tag;
    }
  } catch {
    // 取れなくても致命的ではない。FALLBACK で動く。
  }

  return '';
}

/** 言語タグ（'ja-JP'）を対応言語へ寄せる。未対応なら FALLBACK。 */
function resolveLocale(tag: string): Locale {
  const primary = tag.replace('_', '-').split('-')[0]?.toLowerCase();
  return primary && primary in CATALOGS ? (primary as Locale) : FALLBACK;
}

/** 端末の言語に基づく既定の言語。 */
export function detectLocale(): Locale {
  return resolveLocale(deviceLanguageTag());
}

// ── 現在の言語（モジュール状態）────────────────────────────────────────────

let currentLocale: Locale = detectLocale();

/** useT() の再描画用。言語が変わった時だけ呼ぶ。 */
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 言語を切り替える。'auto' なら端末の言語に従う。
 * 設定の読み込み時と変更時に SettingsContext から呼ばれる。
 */
export function setLocale(setting: LanguageSetting): void {
  const next = setting === 'auto' ? detectLocale() : setting;
  if (next === currentLocale) return; // 同じなら再描画を起こさない
  currentLocale = next;
  listeners.forEach(fn => fn());
}

// ── 文言の取得 ──────────────────────────────────────────────────────────────

/** ドット区切りのキーでカタログを辿る。見つからなければ undefined。 */
function lookup(catalog: CatalogNode, key: string): string | Plural | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as CatalogNode)[part];
  }
  if (typeof node === 'string') return node;
  // Plural かどうかは other の有無で判定する。
  if (typeof node === 'object' && node !== null && 'other' in node) return node as Plural;
  return undefined;
}

/** {name} を vars の値で置換する。対応する値が無い placeholder はそのまま残す。 */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * 文言を取得する。
 *
 *   t('common.back')                       → '戻る'
 *   t('result.selectedCount', { count: 2 }) → '2枚選択中'
 *
 * count を渡すと Plural の項目は one/other を選ぶ（英語の複数形用）。
 * キーが見つからない場合はキー文字列そのものを返す。画面が空白になるより
 * 「どのキーが欠けているか」が画面に出たほうが原因に辿り着けるため。
 */
export function t(key: TKey, vars?: Vars): string {
  const entry =
    lookup(CATALOGS[currentLocale], key) ??
    // 未翻訳の項目があっても画面が壊れないよう、日本語へ落とす。
    lookup(CATALOGS.ja, key);

  if (entry === undefined) {
    if (__DEV__) console.warn(`[i18n] 未定義のキー: ${key}`);
    return key;
  }

  if (typeof entry === 'string') return interpolate(entry, vars);

  // Plural: count に応じて one / other を選ぶ。
  const count = typeof vars?.count === 'number' ? vars.count : Number(vars?.count ?? 0);
  return interpolate(count === 1 ? entry.one : entry.other, vars);
}

// ── React 連携 ──────────────────────────────────────────────────────────────

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 画面用のフック。返り値の t は素の t と同じものだが、
 * 言語が変わった時にこのフックを使っているコンポーネントが再描画される。
 *
 * useSyncExternalStore を使うのは、モジュール変数という「React の外の状態」を
 * 安全に購読するため（useEffect + useState だと切り替え直後の1フレームだけ
 * 古い言語が描かれることがある）。
 */
export function useT(): { t: typeof t; locale: Locale } {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { t, locale };
}
