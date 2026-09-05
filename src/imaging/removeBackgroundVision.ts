/**
 * removeBackgroundVision.ts — 被写体検出による背景除去。
 * @six33/react-native-bg-removal 経由。iOS は Vision、Android は ML Kit。
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
 * iOS は 17 未満で false。Android は ML Kit Subject Segmentation で、
 * 公式・ライブラリとも API 24（Android 7.0）以上。このアプリの minSdk も 24
 * なので、インストールできる Android では原則 true。
 * Simulator は OS バージョンだけでは判定できないが、ネイティブ側が
 * options 込みなら 'SimulatorError' を返す（ReactNativeBackgroundRemover.swift）。
 */
export const SUBJECT_DETECTION_MIN_IOS = 17;
export const SUBJECT_DETECTION_MIN_ANDROID_API = 24;

/** 被写体検出の失敗理由。OS不足と「方式そのものが今使えない」を分けて案内する。 */
export type SubjectDetectionReason = 'os' | 'unavailable' | 'noSubject';

export class SubjectDetectionError extends Error {
  readonly reason: SubjectDetectionReason;
  constructor(reason: SubjectDetectionReason, message: string) {
    super(message);
    this.name = 'SubjectDetectionError';
    this.reason = reason;
  }
}

/**
 * この起動中だけ被写体検出を止める。SDK／Play 開発者サービス側で死んだとき用。
 * 保存設定は触らない。アプリを立ち上げ直せば、またOS判定からやり直す。
 */
let sessionBlocked = false;
const supportListeners = new Set<() => void>();

export function markSubjectDetectionUnavailable(): void {
  if (sessionBlocked) return;
  sessionBlocked = true;
  supportListeners.forEach(fn => fn());
}

export function subscribeSubjectDetectionSupport(listener: () => void): () => void {
  supportListeners.add(listener);
  return () => {
    supportListeners.delete(listener);
  };
}

function androidApiLevel(): number {
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(String(v), 10);
}

function osSupportsSubjectDetection(): boolean {
  if (Platform.OS === 'ios') {
    const major = parseInt(String(Platform.Version).split('.')[0], 10);
    return Number.isFinite(major) && major >= SUBJECT_DETECTION_MIN_IOS;
  }
  if (Platform.OS === 'android') {
    const api = androidApiLevel();
    return Number.isFinite(api) && api >= SUBJECT_DETECTION_MIN_ANDROID_API;
  }
  return false;
}

export async function isVisionBgRemovalSupported(): Promise<boolean> {
  if (sessionBlocked) return false;
  return osSupportsSubjectDetection();
}

/** ネイティブの生エラーを「方式が死んだ」か「この画像では無理」かに分ける。 */
function classifyNativeFailure(e: unknown): Exclude<SubjectDetectionReason, 'os'> {
  const raw = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  const lower = raw.toLowerCase();
  if (
    lower.includes('requires_api_fallback') ||
    lower.includes('simulatorerror') ||
    lower.includes('simulator') ||
    lower.includes('not available') ||
    lower.includes('unavailable') ||
    lower.includes('play services') ||
    lower.includes('service_missing') ||
    lower.includes('unimplemented') ||
    lower.includes('not implemented') ||
    lower.includes('module') && lower.includes('null')
  ) {
    return 'unavailable';
  }
  return 'noSubject';
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
  if (sessionBlocked) {
    throw new SubjectDetectionError('unavailable', t('errors.visionUnavailable'));
  }
  if (!osSupportsSubjectDetection()) {
    throw new SubjectDetectionError('os', t('errors.visionUnsupported'));
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
      // reject してくる。被写体なしと、方式そのものが使えない（シミュレータ・
      // Play 開発者サービス・将来のAPI廃止）を分けて、後者はこの起動中は出さない。
      console.warn('[removeBackgroundVision] native call failed:', e);
      const reason = classifyNativeFailure(e);
      throw new SubjectDetectionError(
        reason,
        reason === 'unavailable' ? t('errors.visionUnavailable') : t('errors.visionFailed'),
      );
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
