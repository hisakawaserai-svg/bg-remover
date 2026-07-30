import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function Divider() {
  return <View style={styles.line} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#C6C6C8',
    marginLeft: 16,
    marginRight: 16,
  },
});