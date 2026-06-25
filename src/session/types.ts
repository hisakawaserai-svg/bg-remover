/**
 * types.ts — セッション型定義
 *
 * 工程の進み方:
 *   picked → (removeBackground 完了) → keyed → (書き出し完了) → done
 */

export type SessionStep = 'picked' | 'keyed' | 'done';

export interface KeyConfig {
  tolerance: number;
  rows?: number;
}

export interface SessionPolygon {
  id: string;
  points: { x: number; y: number }[];
}

/**
 * セッションに保存するカット1枚分の情報。
 * thumbPath は DocumentDirectory の永続パス（file:// URI）。
 * rgba 等の大きいバイナリは保存しない。
 */
export interface SavedCell {
  kind: 'auto' | 'poly';
  /** auto セルの元画像内矩形。cropToImage の引数として再利用できる。*/
  bbox?: { minX: number; minY: number; maxX: number; maxY: number; area: number };
  /** 永続ファイルパス（file:// URI, DocumentDirectory）*/
  thumbPath: string;
  /** 1カット内に複数の絵が含まれる（合体候補）。auto セルのみ。*/
  multipleObjects?: boolean;
}

export interface StickerSession {
  id: string;
  imageUri: string;
  step: SessionStep;
  mode?: 'auto' | 'custom';
  keyConfig?: KeyConfig;
  polygons?: SessionPolygon[];
  updatedAt: number;
  thumbUri?: string;

  /**
   * 自動分割モードのカット一覧（keyed 以降でセット）。
   * これがあれば再開時に doSplit を走らせず直接 ResultScreen を復元できる。
   */
  autoData?: {
    rows: number;
    tolerance: number;
    cells: SavedCell[];
  };
}
