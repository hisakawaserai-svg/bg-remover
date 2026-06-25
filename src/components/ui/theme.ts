/**
 * theme.ts — デザイントークン
 *
 * 既存カラー (#F2F2F7 / #007AFF / #FFFFFF / #FF3B30) を維持しつつ、
 * spacing・radius・shadow・グレー階調を一元管理する。
 * 全コンポーネントはここだけを参照し、ハードコードを避ける。
 */

// ── カラー ─────────────────────────────────────────────────────────────────

export const colors = {
  // ベース（既存から維持）
  bg:       '#F2F2F7',  // システム背景（薄グレー）
  card:     '#FFFFFF',  // カード・シート
  accent:   '#007AFF',  // プライマリアクション
  danger:   '#FF3B30',  // 破壊的アクション

  // グレー階調（iOS Human Interface Guidelines 準拠）
  label:     '#000000',  // 最高コントラスト（本文）
  label2:    '#3A3A3C',  // セカンダリラベル（やや薄め）
  secondary: '#8E8E93',  // プレースホルダー・補足テキスト
  separator: '#C7C7CC',  // 区切り線・ボーダー
  fill:      '#E5E5EA',  // 非活性背景・塗りつぶし
  fill2:     '#F2F2F7',  // 最薄の塗りつぶし（bg と同じ）

  // アクセント派生
  accentMuted: 'rgba(0,122,255,0.10)',   // 薄い青（選択状態の背景など）
  dangerMuted: 'rgba(255,59,48,0.10)',   // 薄い赤
} as const;

// ── スペーシング ───────────────────────────────────────────────────────────
// 4の倍数ベース。用途コメントを添えて迷いを防ぐ。

export const spacing = {
  xs:  4,   // アイコン余白・バッジパッド
  sm:  8,   // コンパクト要素間
  md:  12,  // 通常の gap
  lg:  16,  // カードの padding / セクション間
  xl:  24,  // 画面の horizontal padding
  xxl: 32,  // セクション間の大きめ余白
} as const;

// ── ボーダー半径 ───────────────────────────────────────────────────────────

export const radius = {
  sm:  8,   // チップ・小ボタン
  md:  12,  // ボタン・入力欄
  lg:  16,  // カード・シート
  pill: 999, // 完全な丸（バッジ・タグ）
} as const;

// ── シャドウ（iOS 風・Android は elevation で代替）─────────────────────────
// StyleSheet で使える ViewStyle 互換の形で定義。

export const shadow = {
  // ほぼ平坦。セパレータの代わりに使う。
  xs: {
    shadowColor:   '#000',
    shadowOpacity: 0.04,
    shadowRadius:  2,
    shadowOffset:  { width: 0, height: 1 },
    elevation:     1,
  },
  // カード標準シャドウ。
  sm: {
    shadowColor:   '#000',
    shadowOpacity: 0.06,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     2,
  },
  // モーダル・フローティングパネル。
  md: {
    shadowColor:   '#000',
    shadowOpacity: 0.10,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     4,
  },
} as const;

// ── タイポグラフィ ─────────────────────────────────────────────────────────
// fontSize + fontWeight のペアをセットで管理する。

export const typography = {
  largeTitle: { fontSize: 28, fontWeight: '700' as const },
  title:      { fontSize: 20, fontWeight: '600' as const },
  headline:   { fontSize: 17, fontWeight: '600' as const },
  body:       { fontSize: 15, fontWeight: '400' as const },
  callout:    { fontSize: 14, fontWeight: '400' as const },
  caption:    { fontSize: 12, fontWeight: '400' as const },
  caption2:   { fontSize: 11, fontWeight: '500' as const },
} as const;
