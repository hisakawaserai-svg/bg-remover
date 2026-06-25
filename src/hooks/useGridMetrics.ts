/**
 * useGridMetrics — グリッドレイアウトの寸法を画面幅から計算する共通フック
 *
 * なぜ useWindowDimensions を使うか:
 *   Dimensions.get('window') は呼び出し時点の値を一度だけ返す。
 *   端末の回転・iPad の分割表示（Slide Over / Split View）でウィンドウ幅が変わっても
 *   再計算されない。useWindowDimensions は幅変化のたびに再レンダーを起こすため、
 *   どの端末・向きでもレイアウトが正しく追従する。
 */

import { useWindowDimensions } from 'react-native';

// ── 入力パラメータ ─────────────────────────────────────────────────────────────

export interface GridParams {
  /** 列数 */
  columns: number;
  /** 列間の隙間 (px)。列が n 本あれば隙間は n-1 本。 */
  gap: number;
  /** グリッド左右の余白 (px)。左右対称で同じ値を想定。 */
  horizontalPadding: number;
}

// ── 返り値 ────────────────────────────────────────────────────────────────────

export interface GridMetrics {
  /** 1セルの正方形サイズ (px)。Math.floor で端数を切り捨て右端はみ出しを防ぐ。 */
  itemSize: number;
  /** 現在のウィンドウ幅 (px)。他の幅計算にも使える。 */
  windowWidth: number;
  /** 現在のウィンドウ高さ (px)。 */
  windowHeight: number;
  /**
   * 画面幅に対するパーセント値を px に変換するヘルパー。
   * 例: wp(50) → 画面幅の50%。
   * 固定 px を書かず「画面の N%」で指定したい場合に使う。
   */
  wp: (percent: number) => number;
}

// ── フック本体 ────────────────────────────────────────────────────────────────

export function useGridMetrics({ columns, gap, horizontalPadding }: GridParams): GridMetrics {
  const { width, height } = useWindowDimensions();

  //
  // itemSize の計算式:
  //   使える幅 = windowWidth − 左右余白(horizontalPadding × 2) − 列間隙間(gap × (columns−1))
  //   1セル幅  = 使える幅 ÷ columns
  //
  // 例: 幅390px / 3列 / gap8 / padding8 の場合
  //   使える幅 = 390 − 16 − 16 = 358
  //   1セル   = floor(358 / 3) = 119px
  //
  const usableWidth = width - horizontalPadding * 2 - gap * (columns - 1);
  const itemSize = Math.floor(usableWidth / columns);

  const wp = (percent: number) => Math.floor(width * percent / 100);

  return { itemSize, windowWidth: width, windowHeight: height, wp };
}
