/**
 * LoupeSizeSlider — ルーペ基準サイズ(80〜220px, 1刻み)を選ぶ連続スライダー
 *
 * ここで決めた値が「大」の一辺(px)そのものになる。「中」「収納」は
 * PolygonEditor 側でこの値からの比率（0.75 / 0.35）で計算するので、
 * 大→中→収納の切り替えロジック自体には触れない
 * （詳しくは settings/store.ts の loupeBaseSize、PolygonEditor の
 * loupeMedium/loupeMini を参照）。
 */

import React from 'react';
import RangeValueSlider from './RangeValueSlider';

export const MIN_LOUPE_SIZE = 80;
export const MAX_LOUPE_SIZE = 220;
export const LOUPE_SIZE_DEFAULT = 160;

/** 「中」「収納」を基準サイズから計算する比率。 */
export const LOUPE_MEDIUM_RATIO = 0.75;
export const LOUPE_MINI_RATIO = 0.35;
/**
 * 「収納」の下限(px)。基準サイズが小さい時（例: 80）は 80×0.35≈28px になり、
 * iOS の最小タップ領域(44pt)を大きく割って押せなくなるため、比率計算の
 * 結果をこの値で下支えする。「中」は元々このケースでも 60px 前後あり、
 * 押しにくいと報告されていないので、こちらにはフロアを設けない。
 */
export const LOUPE_MINI_MIN = 44;

interface Props {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  sub?: string;
  leadingIcon?: string;
}

export default function LoupeSizeSlider({ value, onChange, label, sub, leadingIcon }: Props) {
  return (
    <RangeValueSlider
      value={value}
      onChange={onChange}
      min={MIN_LOUPE_SIZE}
      max={MAX_LOUPE_SIZE}
      defaultValue={LOUPE_SIZE_DEFAULT}
      formatValue={v => `${v}`}
      label={label}
      sub={sub}
      leadingIcon={leadingIcon}
    />
  );
}
