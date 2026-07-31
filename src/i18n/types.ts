/**
 * i18n/types.ts — カタログの形と、キー文字列の型を定義する。
 *
 * 日本語カタログ（ja.ts）を「正」とし、他言語はその型に従わせる。
 * こうしておくと en.ts でキーを書き忘れた時点でコンパイルエラーになり、
 * 「英語だけ文言が出ない」という実行時にしか気づけない不具合を防げる。
 */

/**
 * 複数形を持つ項目。
 *
 * 日本語には複数形が無いので one/other に同じ文言を入れることになるが、
 * 英語では "1 image" / "2 images" と変わるため、カタログの段階で
 * 形を用意しておく。後から複数形対応を足そうとすると、その項目を使っている
 * 全ての呼び出し側を探し直すことになるので最初から分けておく。
 */
export interface Plural {
  one: string;
  other: string;
}

/** カタログの値として許すもの。 */
type Leaf = string | Plural;

/** 入れ子を許すカタログの構造。 */
export interface CatalogNode {
  [key: string]: Leaf | CatalogNode;
}

/**
 * カタログから "settings.export.album" のようなドット区切りのキー型を作る。
 *
 * Plural は葉として扱う（"...count.one" のような中途半端なキーを作らせない）。
 */
export type PathsOf<T> = {
  [K in keyof T & string]: T[K] extends Plural
    ? K
    : T[K] extends string
      ? K
      : T[K] extends object
        ? `${K}.${PathsOf<T[K]>}`
        : never;
}[keyof T & string];

/** 差し込み値。{name} のような placeholder に対応する。 */
export type Vars = Record<string, string | number>;
