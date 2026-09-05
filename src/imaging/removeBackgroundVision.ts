/**
 * removeBackgroundVision.ts — iOS Vision (VNGenerateForegroundInstanceMaskRequest) を
 * 使った背景除去。@six33/react-native-bg-removal 経由で呼ぶ。
 *
 * 色ベースの removeBackground.ts とは別モジュールにしてある。あちらは「背景色」を
 * 前提にした閾値アルゴリズムで、こちらは意味的セグメンテーション（背景色の概念を
 * 持たない）なので、混ぜずに独立させておくほうが見通しがよい。
 *
 * 呼び出し側の前提（重要）:
 *   - Vision は画像1枚につき一度だけ呼ぶ。結果は呼び出し側が専用バッファ
 *     （Vision適用直後の状態）として保持し、undo/redo・リセットのたびに
 *     再度ここを呼び直さないこと（ネイティブ推論はコストが高い）。
 *   - 以降のスポイト・復元ブラシ・再透過・セル単位のtolerance調整は、
 *     常に元画像 + 色ベースの removeBackgroundInPlace/removeColorAt を使う
 *     （このモジュールはそこに関与しない）。
 */
import { Platform } from 'react-native';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';
import RNFS from 'react-native-fs';
import { removeBackground as removeBackgroundNative } from '@six33/react-native-bg-removal';
import { decodeAndResizeImage } from './removeBackground';
import { t } from '../i18n';
import type { RemoveBgResult } from './removeBackground';

/**
 * この端末で Vision による背景除去が使えるか。
 *
 * 【ライブラリ付属の isNativeBackgroundRemovalSupported() を使わない理由】
 * あの関数は判定のために BackgroundRemover.removeBackground('test://...') を
 * options 引数を渡さずに直接ネイティブモジュールへ投げている。New Architecture
 * (TurboModule) では JSI 側が options を必須の構造体として要求するため、
 * 渡さないと実機でクラッシュする（実際に発生した）。旧アーキ(Bridge)向けの
 * 実装がそのまま残っているとみられる。このアプリは reanimated 4 のために
 * newArchEnabled=true 必須なので、この関数には触れず自前でOSバージョンだけ見て
 * 判定する。
 *
 * iOS 17 未満では false。Simulator は判定できない（Platform に判別手段が無い）が、
 * ネイティブ側が options 込みの正規の呼び出しであれば Simulator でも
 * クラッシュせず 'SimulatorError' を返す実装になっている
 * （ReactNativeBackgroundRemover.swift 参照）ため、ここでは弾かない。
 */
export async function isVisionBgRemovalSupported(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const major = parseInt(String(Platform.Version).split('.')[0], 10);
  return Number.isFinite(major) && major >= 17;
}

const VISION_TMP_DIR = `${RNFS.CachesDirectoryPath}/vision-bg-tmp`;

/**
 * Vision で背景除去を行い、既存の色ベース経路と同じ RemoveBgResult 形式で返す。
 *
 * 【解像度をどう揃えているか】
 * removeBackground.ts の loadImagePixels は OOM 対策で長辺 2500px 超の画像を
 * 縮小してから処理する。Vision ライブラリは渡されたファイルをそのままの解像度で
 * 処理してしまうため、素の fileUri を渡すと出力サイズが loadImagePixels 側の
 * baseRgba とズレる（→ bbox・ポリゴン座標が全部合わなくなる）。
 * そこで decodeAndResizeImage で同じ縮小処理を先に済ませ、その結果を一時PNGへ
 * 書き出してから Vision に渡すことで、常に同じ解像度を入力として揃える。
 *
 * trim は必ず false を指定する（既定の自動クロップが効くと出力サイズが
 * 被写体のbboxまで縮んでしまい、同じ理由で座標が合わなくなる）。
 */
export async function removeBackgroundVision(fileUri: string): Promise<RemoveBgResult> {
  const supported = await isVisionBgRemovalSupported();
  if (!supported) {
    throw new Error(t('errors.visionUnsupported'));
  }

  const resized = await decodeAndResizeImage(fileUri);
  const width = resized.width();
  const height = resized.height();

  await RNFS.mkdir(VISION_TMP_DIR).catch(() => {});
  const tmpInPath = `${VISION_TMP_DIR}/in_${Date.now()}.png`;
  const pngBytes = resized.encodeToBytes();
  resized.dispose();
  if (!pngBytes) {
    throw new Error(t('errors.encodeFailed'));
  }
  await RNFS.writeFile(tmpInPath, bytesToBase64(pngBytes), 'base64');

  let outUri: string;
  try {
    try {
      outUri = await removeBackgroundNative(`file://${tmpInPath}`, { trim: false });
    } catch (e) {
      // ネイティブ側は "Failed to create mask" 等、英語の生メッセージをそのまま
      // reject してくる（被写体が検出できない画像などで起こる。Visionの
      // インスタンスセグメンテーションは「何かしら被写体があるはず」という
      // 前提のAPIなので、単純な模様やごく小さい絵などでは0件になり得る）。
      // ユーザーに見せる文言としては具体的な原因より「この方式では無理だった」
      // ことと次の行動（色ベースを試す）が分かればよいので、一律に翻訳し直す。
      console.warn('[removeBackgroundVision] native call failed:', e);
      throw new Error(t('errors.visionFailed'));
    }
  } finally {
    await RNFS.unlink(tmpInPath).catch(() => {});
  }

  const outData = await Skia.Data.fromURI(outUri);
  const outImage = Skia.Image.MakeImageFromEncoded(outData);
  if (!outImage) {
    throw new Error(t('errors.decodeFailed'));
  }

  // trim:false を指定しても、ライブラリ・OS側の想定外挙動でサイズが変わる
  // 可能性はゼロではない。ここでズレたまま先へ進むと bbox 座標が壊れて
  // 気づきにくい不具合になるため、必ず食い違いを検出して弾く。
  if (outImage.width() !== width || outImage.height() !== height) {
    outImage.dispose();
    throw new Error(t('errors.visionSizeMismatch'));
  }

  const rawPixels = outImage.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  outImage.dispose();
  if (!rawPixels) {
    throw new Error(t('errors.pixelsFailed'));
  }

  const rgba = rawPixels instanceof Uint8Array
    ? rawPixels
    : new Uint8Array(rawPixels.buffer);

  return { rgba, width, height };
}

// removeBackground.ts の bytesToBase64 と同じ実装（imaging/index.ts 経由だと
// 循環参照になるため、小さい純関数をここに複製しておく）。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const len = bytes.length;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}
