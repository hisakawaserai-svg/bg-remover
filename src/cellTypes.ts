/**
 * cellTypes.ts — 自動分割結果セルの型定義
 *
 * auto: BBox のみ保持。書き出し時に cropToImage + resize を実行。
 * poly: 合体ブロックをポリゴンで手動分割した結果。マスク済み RGBA を保持。
 */
import type { BBox } from './imaging';

export type Cell =
  | { kind: 'auto'; bbox: BBox;                              thumbUri: string }
  // rgba/w/h は undefined になり得る（セッション復元時は thumbUri のみ保持）
  | { kind: 'poly'; rgba?: Uint8Array; w?: number; h?: number; thumbUri: string };
