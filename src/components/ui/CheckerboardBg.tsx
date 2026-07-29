import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ThumbBg } from '../../settings/store';

const LIGHT = '#FFFFFF';
const DARK  = '#CCCCCC';
const GRAY  = '#888888';
const BLACK = '#1C1C1E';

// 市松以外は単色。mode ごとの塗り色をここに集約する。
const SOLID: Record<Exclude<ThumbBg, 'checker'>, string> = {
  white: LIGHT,
  gray:  GRAY,
  black: BLACK,
};

interface Props {
  mode: ThumbBg;
  tile: number;
  width: number;
  height: number;
}

export default function CheckerboardBg({ mode, tile, width, height }: Props) {
  if (mode !== 'checker') {
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: SOLID[mode] },
        ]}
      />
    );
  }

  const cols = Math.ceil(width  / tile);
  const rows = Math.ceil(height / tile);
  return (
    <View style={{ position: 'absolute', width, height, overflow: 'hidden' }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {Array.from({ length: cols }, (_, c) => (
            <View
              key={c}
              style={{
                width: tile,
                height: tile,
                backgroundColor: (r + c) % 2 === 0 ? LIGHT : DARK,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
