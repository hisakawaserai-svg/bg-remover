/**
 * LoupeMagnifySlider — ルーペの基準倍率(12〜64, 1刻み)を選ぶ連続スライダー
 *
 * プリセットへの丸めはしない。指を動かした分だけそのまま値が変わる
 * （@react-native-community/slider の step=1 が刻みを担う。中間の
 * 「だいたいこの辺」で止められるスナップは無い）。
 *
 * 将来ドットグリッド表示などで更に高倍率(96・128倍…)に対応する時は
 * MAX_MAGNIFY を上げるだけでよい。倍率計算側(PolygonEditor の
 * loupeMagnify)も base値からの相対計算のみで、上限の絶対値には
 * 依存していない。
 */

import React from 'react';
import RangeValueSlider from './RangeValueSlider';

export const MIN_MAGNIFY = 12;
export const MAX_MAGNIFY = 64;
export const MAGNIFY_DEFAULT = 24;

interface Props {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  sub?: string;
}

export default function LoupeMagnifySlider({ value, onChange, label, sub }: Props) {
  return (
    <RangeValueSlider
      value={value}
      onChange={onChange}
      min={MIN_MAGNIFY}
      max={MAX_MAGNIFY}
      defaultValue={MAGNIFY_DEFAULT}
      formatValue={v => `×${v}`}
      label={label}
      sub={sub}
    />
  );
}
