/**
 * shareImages.ts — 透過 PNG を OS の共有シートへ渡す。
 *
 * 【リサイズしない】
 * カットのサムネ（thumbUri）は saveThumbToFile がリサイズせず書き出した
 * フル解像度の透過 PNG なので、URI をそのまま渡せる。
 * ギャラリー保存（exportCells）は 500px に縮めているため、共有した画像のほうが
 * 保存した画像より大きくなるが、共有は元の解像度のほうが使い道が広いので揃えない。
 */
import Share from 'react-native-share';
import { emitShareSheetClosed } from './sharedInput';

/**
 * 共有シートを開く。1枚でも複数枚でも同じ入口を使う。
 *
 * 複数枚は urls で渡す（iOS は複数画像をそのまま扱え、Android では
 * ACTION_SEND_MULTIPLE になる）。ただし受け取り側のアプリによっては
 * 1枚目しか使わないものがあり、これは呼び出し側では回避できない。
 *
 * 「共有せずに閉じた」はエラーではないので、呼び出し側に伝えない。
 * react-native-share はキャンセルも reject で返すため、ここで握り潰す。
 */
export async function shareImages(uris: string[]): Promise<void> {
  if (uris.length === 0) return;

  try {
    await Share.open({
      urls: uris,
      type: 'image/png',
      failOnCancel: false,
    });
  } catch (e) {
    // failOnCancel: false でもプラットフォームによっては reject することがある。
    // 共有の失敗でアプリの操作を止める理由はないので、ログだけ残す。
    console.warn('shareImages failed:', e);
  } finally {
    // 共有先が自分の Share Extension だった場合、App Group に画像が置かれている。
    // アプリは前面のままで AppState が変化しないので、ここから拾いに行かせる。
    emitShareSheetClosed();
  }
}
