import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ThumbBg } from '../../settings/store';

const LIGHT = '#FFFFFF';
const DARK  = '#CCCCCC';
const GRAY  = '#888888';

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
          { backgroundColor: mode === 'gray' ? GRAY : LIGHT },
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
