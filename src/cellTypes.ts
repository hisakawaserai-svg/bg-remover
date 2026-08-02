/**
 * cellTypes.ts — 自動分割結果セルの型定義
 *
 * auto: BBox のみ保持。書き出し時に cropToImage + resize を実行。
 * poly: 合体ブロックをポリゴンで手動分割した結果。マスク済み RGBA を保持。
 */
import type { BBox } from './imaging';

export type Cell =
  | { kind: 'auto'; bbox: BBox; thumbUri: string; multipleObjects?: boolean }
  // rgba/w/h は undefined になり得る（セッション復元時は thumbUri のみ保持）
  | {
      kind: 'poly';
      rgba?: Uint8Array;
      w?: number;
      h?: number;
      thumbUri: string;
      /**
       * 元画像上での切り出し矩形。手動分割したカットを後から編集し直すために持つ。
       * これが無いと「元画像のどこだったか」を復元できず、再編集も再透過もできない。
       */
      srcBBox?: BBox;
      /**
       * 切り出しに使ったポリゴン（srcBBox の左上を原点とする座標）。
       * 再編集で開いた時に、前回の形をそのまま出すために持つ。
       */
      polygon?: Array<[number, number]>;
    };
