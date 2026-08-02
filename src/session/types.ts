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
  cols?: number; // 列数の手動指定。未指定(undefined)なら従来通り段ごとに列を自動検出する
}

export interface SessionPolygon {
  id: string;
  points: { x: number; y: number }[];
}

/**
 * 画像に対する編集操作を1つずつ表したもの。
 *
 * 加工後の rgba は保存しない方針なので、元画像＋この配列を「正」として扱い、
 * 表示のたびに元画像へ順番に掛け直して現在の見た目を作る。
 * これにより (1) 再開しても編集が復元でき、(2) 配列を末尾から削るだけで
 * 取り消しができ、(3) 巻き戻し用に画像を何枚も抱える必要がなくなる。
 * 1件あたり数十バイト。
 *
 * autoBg = 自動背景除去。ユーザー操作ではないが、取り消して元画像まで戻せる
 * ようにするため、他の操作と同じ列に並べている。
 */
export type EditStep =
  // fillHoles は「文字の穴を透過する」オプション。省略時 false。
  // 既存の保存済みセッションにはこのキーが無いため optional にしてある
  // （無い＝当時の挙動＝穴埋めなし、として正しく再現できる）。
  | { kind: 'autoBg'; tolerance: number; feather: boolean; fillHoles?: boolean }
  | { kind: 'eyedrop'; x: number; y: number; tolerance: number; feather: boolean }
  // restore = 復元ブラシ。消えすぎた部分の alpha を元画像の値へ戻す。
  // 1ストローク＝1ステップにしてある（点ごとに積むと undo が1画素ずつになり、
  // 操作列も一瞬で膨れ上がるため）。座標は元画像基準。
  | { kind: 'restore'; points: Array<[number, number]>; radius: number };

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
  /**
   * poly セルの元画像内矩形。再開後も手動分割したカットを編集し直せるようにする。
   * 旧バージョンで保存したセッションには無いので optional。
   */
  srcBBox?: { minX: number; minY: number; maxX: number; maxY: number; area: number };
  /** poly セルの切り出しポリゴン（srcBBox の左上を原点とする座標）。*/
  polygon?: Array<[number, number]>;
}

export interface StickerSession {
  id: string;
  imageUri: string;
  step: SessionStep;
  mode?: 'auto' | 'custom';
  keyConfig?: KeyConfig;
  polygons?: SessionPolygon[];
  /** 画像編集の操作列。再開時に元画像へ順番に掛け直して見た目を復元する。 */
  edits?: EditStep[];
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
    /**
     * ユーザーが編集した分割境界線（画像座標系）。SetupScreen に戻って再編集する時の
     * 初期値に使う。未編集/等分のままでも等分値がそのまま入る。復元後の再編集用。
     */
    bounds?: { rowYsImg: number[]; colXsImg: number[] };
  };
}
