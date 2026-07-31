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
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

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
 * 端末の優先言語タグを、信頼できる順に並べて返す。
 *
 * 【Intl を最優先にしてはいけない】
 * Hermes の Intl が返すのは「アプリが解決したロケール」で、iOS は
 * NSLocale をアプリの対応ローカライズ（.lproj / CFBundleLocalizations）で
 * 絞り込んでから返す。このアプリは CFBundleDevelopmentRegion が en で
 * ja のローカライズを持たないため、端末が日本語だけの設定でも
 * Intl は 'en-US' を返す。実機で「端末は日本語なのに英語になる」の原因はこれ。
 *
 * NSUserDefaults の AppleLanguages / AppleLocale は端末の設定そのもので、
 * アプリの対応言語に左右されない。こちらを先に見る。
 * （RCTSettingsManager が NSUserDefaults の dictionaryRepresentation を
 *   そのまま定数として返しているため参照できる）
 */
/**
 * iOS の NSUserDefaults（端末の設定そのもの）を読む。
 *
 * New Architecture（bridgeless）では NativeModules 経由で SettingsManager が
 * 取れない。TurboModuleRegistry.get は __turboModuleProxy を先に見るので
 * 新旧どちらのアーキテクチャでも届く。get は見つからなければ null を返すだけで
 * 例外を投げない（getEnforcing は投げるので使わない）。
 */
type UserDefaults = Record<string, unknown> | undefined;

function iosUserDefaults(): UserDefaults {
  try {
    const mod = TurboModuleRegistry.get<{
      getConstants: () => { settings: Record<string, unknown> };
    }>('SettingsManager');
    const fromTurbo = mod?.getConstants?.().settings;
    if (fromTurbo) return fromTurbo;
  } catch {
    // 次の経路へ。
  }
  try {
    // 旧アーキテクチャ用の経路。
    return NativeModules.SettingsManager?.settings as UserDefaults;
  } catch {
    return undefined;
  }
}

function preferredLanguageTags(): string[] {
  const tags: string[] = [];

  // 1) 端末の設定そのもの。アプリのローカライズ有無に影響されない。
  try {
    if (Platform.OS === 'ios') {
      const s = iosUserDefaults();
      // AppleLanguages は優先順のリスト（例: ['ja-JP', 'en-US']）。
      const langs = s?.AppleLanguages;
      if (Array.isArray(langs)) {
        for (const l of langs) if (typeof l === 'string' && l) tags.push(l);
      }
      // AppleLocale は地域込みの1件（例: 'ja_JP'）。リストが空の時の保険。
      const loc = s?.AppleLocale;
      if (typeof loc === 'string' && loc) tags.push(loc);
    } else {
      const tag = NativeModules.I18nManager?.localeIdentifier;
      if (typeof tag === 'string' && tag) tags.push(tag);
    }
  } catch {
    // 取れなくても致命的ではない。次の経路へ。
  }

  // 2) 最後の砦。上が全滅した時だけ使う（上記のとおりアプリ解決後の値なので精度は落ちる）。
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag) tags.push(tag);
  } catch {
    // Intl 無効ビルドではここに来る。
  }

  return tags;
}

/**
 * 言語タグの主要部分を取り出す。
 * 'ja' / 'ja-JP' / 'ja_JP' / 'ja-Jpan-JP' いずれも 'ja' になる。
 */
function primarySubtag(tag: string): string {
  // アンダースコア区切り（'ja_JP'）とハイフン区切りの両方が来る。
  // replace は全置換にする（'zh_Hans_CN' のように2つ以上ある形に備える）。
  return tag.replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? '';
}

/**
 * 端末の言語に基づく既定の言語。
 *
 * 優先順のリストを頭から見て、最初に対応している言語を採用する。
 * 例: 端末が [ko, ja, en] で対応が ja/en なら ja を選ぶ
 * （先頭だけを見ると ko が未対応 → FALLBACK の en になってしまう）。
 */
export function detectLocale(): Locale {
  for (const tag of preferredLanguageTags()) {
    const primary = primarySubtag(tag);
    if (primary && primary in CATALOGS) return primary as Locale;
  }
  return FALLBACK;
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
