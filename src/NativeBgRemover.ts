import { NativeModules } from 'react-native';

interface BgRemoverModuleType {
  // MLKit 被写体検出で背景除去
  removeAndSave(imageUri: string): Promise<string>;
  // 四隅フラッドフィルで背景色を除去
  removeByColor(imageUri: string, tolerance: number): Promise<string>;
}

const { BgRemover } = NativeModules;

if (!BgRemover) {
  console.error(
    '[BgRemover] ネイティブモジュールが見つかりません。ネイティブビルドを確認してください。'
  );
}

export default BgRemover as BgRemoverModuleType;
