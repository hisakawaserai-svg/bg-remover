const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// moti の framer-motion 依存が node_modules/moti/node_modules/react を引き込み、
// React が二重インスタンス化されて MotiPressable の useMemo が null エラーになる。
// extraNodeModules でトップレベルの react / react-native を強制的に指定することで
// ネスト先でも同じインスタンスを参照させる。
const path = require('path');
const config = {
  resolver: {
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
