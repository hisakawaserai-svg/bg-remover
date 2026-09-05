module.exports = {
  project: { ios: {}, android: {} },
  dependencies: {
    // iOS の auto-link を無効化。これをしないと RNVectorIcons の podspec
    // (s.resources = "Fonts/*.ttf") が [CP] Copy Pods Resources で同じ
    // MaterialIcons.ttf を二重に同梱し "Multiple commands produce" になる。
    // フォントは下の assets（Copy Bundle Resources）から明示同梱する。
    'react-native-vector-icons': {
      platforms: { ios: null },
    },
  },
  assets: [
    './node_modules/react-native-vector-icons/Fonts/MaterialIcons.ttf',
    // 消しゴムアイコン(eraser)専用。MaterialIconsには存在しないため追加。
    './node_modules/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
  ],
  // ↑ 使っているフォントだけ同梱。他フォントは含めない
};
