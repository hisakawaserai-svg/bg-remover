import { Skia } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';
import { fromByteArray } from 'base64-js';

/**
 * 入力された画像のURIをPNG形式に変換して保存する関数
 * @param uri: 変換したい画像のURI
 * @returns: 変換後のPNG画像のURI。変換に失敗した場合は元のURIを返す
 */

export async function convertToPng(uri: string): Promise<string> {
  try {
    const path = uri.replace('file://', '');

    // 元画像読み込み
    const base64 = await RNFS.readFile(path, 'base64');

    const data = Skia.Data.fromBase64(base64);

    const image = Skia.Image.MakeImageFromEncoded(data);

    if (!image) {
      throw new Error('Image decode failed');
    }

    // PNGへ変換
    const pngBytes = image.encodeToBytes();

    // 保存先
    const outputPath = `${RNFS.CachesDirectoryPath}/converted_${Date.now()}.png`;

    // Uint8Array → Base64
    const pngBase64 = fromByteArray(pngBytes);

    await RNFS.writeFile(
      outputPath,
      pngBase64,
      'base64'
    );

    console.log('PNG saved:', outputPath);

    return `file://${outputPath}`;

  } catch (error) {
    console.error('convertToPng error:', error);

    // 失敗時は元画像
    return uri;
  }
}