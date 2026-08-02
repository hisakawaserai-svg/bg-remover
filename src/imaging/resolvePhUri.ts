/**
 * resolvePhUri.ts — CameraRoll の ph:// URI を、実ファイルのパスに解決する。
 *
 * 【なぜ必要か】
 * iOS の CameraRoll が返す `ph://<localIdentifier>` を Image にそのまま渡すと、
 * PHImageManager が描画用に展開した画像が返り、**アルファが白で潰れる**。
 * 透過 PNG なのに背景が白く見え、裏の市松/黒背景（背景色設定）が効かなくなる。
 * さらに共有シートは ph:// をファイルとして開けないため、画像ではなく
 * リンクとして送られてしまう（「N Links」表示の原因）。
 *
 * iosGetImageDataById は元データのコピーをファイルとして書き出すので、
 * PNG のアルファがそのまま残る。
 *
 * 【コスト】
 * 1件ごとにファイルコピーが走る。一覧の全件に対して先に流すと重いので、
 * 拡大表示など「今まさに1枚見せる」場面でだけ使うこと。
 * 同じ URI を何度も解決しないよう結果をキャッシュする。
 */
import { Platform } from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

const cache = new Map<string, string>();

/**
 * ph:// なら実ファイルの URI に解決して返す。
 * それ以外（file:// / data: / content://）や解決に失敗した場合は元の URI をそのまま返す
 * （表示はできるので、透過が失われるだけで機能は止めない）。
 */
export async function resolvePhUri(uri: string): Promise<string> {
  if (Platform.OS !== 'ios' || !uri.startsWith('ph://')) return uri;

  const cached = cache.get(uri);
  if (cached) return cached;

  try {
    const internalID = uri.slice('ph://'.length);
    const result = await CameraRoll.iosGetImageDataById(internalID);
    const resolved = result?.node?.image?.uri;
    if (!resolved) return uri;
    cache.set(uri, resolved);
    return resolved;
  } catch (e) {
    console.warn('resolvePhUri failed:', e);
    return uri;
  }
}
