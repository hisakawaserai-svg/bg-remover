/**
 * sharedInput.ts — 他アプリの共有シートから渡された画像を引き取る。
 *
 * iOS: Share Extension は受け取った画像の生データを変換せず App Group の
 * コンテナ直下に `share_input`（拡張子なし）として置き、本体アプリを起動する。
 * ここではその1ファイルを本体アプリのキャッシュへ移し、App Group 側は消す。
 *
 * 【なぜコピーしてから消すのか】
 * App Group のファイルをそのまま処理に使うと、失敗しても消し忘れが残り
 * 次回起動でまた同じ画像が読み込まれてしまう。引き取った時点で
 * 「未処理の共有画像は無い」状態にしておき、以降は通常の画像と同じ扱いにする。
 *
 * ネイティブモジュールは足していない。App Group のパスは react-native-fs の
 * pathForGroup（iOS のみ）で取れる。
 *
 * Android: ACTION_SEND (image/*) は SharedImageModule（ネイティブ）が受け取り、
 * content:// の中身をキャッシュへコピーして file:// で返す（convertToPng が
 * file:// 前提のため）。同じ理由で、取得した時点でネイティブ側が Intent の
 * EXTRA_STREAM を消し、二重取得を防ぐ。
 */
import { Platform, NativeModules, NativeEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';

const { SharedImageModule } = NativeModules;
/** SharedImageModule.kt の EVENT_NAME と一致させること。 */
const ANDROID_SHARE_EVENT_NAME = 'onSharedImageReceived';

/** Share Extension 側（ShareViewController.swift）と一致させること。 */
const APP_GROUP_ID = 'group.com.sera.bgremover.app';
const SHARED_FILE_NAME = 'share_input';

// ── 共有シートが閉じたことの通知 ─────────────────────────────────────────────
//
// アプリ内の共有シートから自分の Share Extension に渡した場合、アプリは前面のまま
// なので AppState は 'active' から動かず、前面復帰では気づけない。
// URL スキーム（bgremover://share）も AppDelegate に openURL ハンドラが無いため
// JS へ届かない。共有シートが閉じたことだけは shareImages が知っているので、
// そこから通知してもらって App Group を見に行く。

type Listener = () => void;
const closeListeners = new Set<Listener>();

/** 共有シートが閉じたら呼ばれる。戻り値を呼ぶと購読解除。 */
export function onShareSheetClosed(listener: Listener): () => void {
  closeListeners.add(listener);
  return () => { closeListeners.delete(listener); };
}

/** shareImages から呼ぶ。共有シートが閉じたことを購読側に伝える。 */
export function emitShareSheetClosed(): void {
  for (const listener of closeListeners) listener();
}

/**
 * Android: 実行中のアプリに ACTION_SEND (image/*) が届いたら呼ばれる。
 * launchMode="singleTask" のため、これが無いと前面のまま来た共有に気付けない
 * （AppState は 'active' のまま動かないケースがある）。
 */
export function onAndroidSharedImageReceived(listener: Listener): () => void {
  if (Platform.OS !== 'android' || !SharedImageModule) return () => {};
  const emitter = new NativeEventEmitter(SharedImageModule);
  const sub = emitter.addListener(ANDROID_SHARE_EVENT_NAME, listener);
  return () => sub.remove();
}

/**
 * 共有画像があれば引き取って file:// URI を返す。無ければ null。
 * 返した時点で共有元の情報（App Group のファイル／Intent の EXTRA_STREAM）は
 * 消去済み（再読込されない）。
 */
export async function consumeSharedImage(): Promise<string | null> {
  if (Platform.OS === 'android') {
    if (!SharedImageModule) return null;
    try {
      const uri = await SharedImageModule.getSharedImageUri();
      return uri ?? null;
    } catch (e) {
      console.warn('consumeSharedImage(android) failed:', e);
      return null;
    }
  }

  if (Platform.OS !== 'ios') return null;

  try {
    const groupDir = await RNFS.pathForGroup(APP_GROUP_ID);
    if (!groupDir) return null;

    const srcPath = `${groupDir}/${SHARED_FILE_NAME}`;
    if (!(await RNFS.exists(srcPath))) return null;

    // 拡張子は付けない。中身は HEIC/JPEG/PNG などまちまちで、
    // PNG への統一は既存の convertToPng が行う。
    const destPath = `${RNFS.CachesDirectoryPath}/shared_${Date.now()}`;
    await RNFS.copyFile(srcPath, destPath);
    await RNFS.unlink(srcPath);

    return `file://${destPath}`;
  } catch (e) {
    console.warn('consumeSharedImage failed:', e);
    return null;
  }
}
