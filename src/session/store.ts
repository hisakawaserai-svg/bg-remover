/**
 * store.ts — セッション永続化ラッパー
 *
 * AsyncStorage の 1キー 'sticker_sessions' に StickerSession[] を
 * JSON 文字列で保存する薄いラッパー。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type { StickerSession } from './types';
import { rebaseToCurrentContainer } from './paths';

const STORAGE_KEY = 'sticker_sessions';

/**
 * 全ての読み書きをこのキューで直列化する。
 *
 * 各関数は「readAll → 加工 → writeAll」という read-modify-write だが、
 * await のたびに他の呼び出しへ制御が渡るため、直列化しないと
 * 「AがreadAllした直後にBもreadAll（同じ古い内容）→ Aが書く → Bが書く」で
 * Aの変更が消える、というロスト・アップデートが起きる
 * （実際にポリゴン編集とスポイトの保存が競合し、ポリゴンが消える不具合になった）。
 * 1本のキューに繋いで直前の呼び出し完了を待ってから次を実行することで、
 * このモジュールを通す限り read-modify-write 全体がアトミックになる。
 */
let queue: Promise<void> = Promise.resolve();
function withQueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 保存されているファイルパスを現在のアプリ領域基準に直す。
 *
 * iOS はアプリ更新のたびに Data コンテナの UUID が変わるため、保存済みの
 * 絶対パスは更新後に無効になる（詳細は paths.ts）。読み出しの入口で一度だけ
 * 通しておけば、以降の画面はこれまで通り絶対 URI を扱えばよい。
 */
function rebaseSession(s: StickerSession): StickerSession {
  return {
    ...s,
    imageUri: rebaseToCurrentContainer(s.imageUri),
    thumbUri: rebaseToCurrentContainer(s.thumbUri),
    autoData: s.autoData && {
      ...s.autoData,
      // cells は SavedCell[] 必須。古い保存データで欠けていても [] に寄せる。
      cells: (s.autoData.cells ?? []).map(c => ({
        ...c,
        thumbPath: rebaseToCurrentContainer(c.thumbPath),
      })),
    },
  };
}

async function readAll(): Promise<StickerSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StickerSession[];
    return parsed.map(rebaseSession);
  } catch (e) {
    console.warn('[session/store] readAll failed:', e);
    return [];
  }
}

async function writeAll(sessions: StickerSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[session/store] writeAll failed:', e);
  }
}

// ── パブリック API ────────────────────────────────────────────────────────────

export async function listSessions(): Promise<StickerSession[]> {
  return withQueue(async () => {
    const sessions = await readAll();
    // id 重複を排除（同一 id は updatedAt が新しい方を残す）
    const seen = new Set<string>();
    const deduped = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    return deduped;
  });
}

export async function getSession(id: string): Promise<StickerSession | null> {
  return withQueue(async () => {
    const sessions = await readAll();
    return sessions.find(s => s.id === id) ?? null;
  });
}

export async function upsertSession(session: StickerSession): Promise<void> {
  return withQueue(async () => {
    const sessions = await readAll();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.push(session);
    }
    await writeAll(sessions);
  });
}

/**
 * 既存セッションに部分更新をマージして保存する。
 *
 * upsertSession は渡したオブジェクトで丸ごと置き換えるため、呼び出し側が
 * 「今どこかの誰かが保存したかもしれない他フィールド」を知らないまま呼ぶと、
 * その分を消してしまう（例: ポリゴン保存とスポイトの edits 保存が競合すると
 * 片方が消える）。getSession → upsertSession と2回に分けて自前でマージする
 *実装も、間に他の書き込みが挟まれば同じ競合が起きるため意味がない
 * （2回とも別々にキューへ並ぶので、読んだ後に他の書き込みが割り込める）。
 * ここでは読み→マージ→書きをキュー内の1タスクにまとめることで、
 * その隙間ごと消してアトミックにする。
 */
export async function patchSession(id: string, patch: Partial<StickerSession>): Promise<void> {
  return withQueue(async () => {
    const sessions = await readAll();
    const idx = sessions.findIndex(s => s.id === id);
    // 新規作成はしない。id・imageUri・step 等の必須項目を呼び出し側が持っていない
    // 部分更新なので、既存が無ければ何もせず諦める（getSession→!existing→return と同じ方針）。
    if (idx < 0) return;
    sessions[idx] = { ...sessions[idx], ...patch, id };
    await writeAll(sessions);
  });
}

/**
 * セッションに紐づく永続画像ファイル（DocumentDirectory のカット画像）を削除する。
 * セッション削除・エクスポート後自動削除の両方から呼ぶ。
 */
export async function deleteSessionFiles(session: StickerSession): Promise<void> {
  const cells = session.autoData?.cells ?? [];
  for (const cell of cells) {
    const filePath = cell.thumbPath.startsWith('file://')
      ? cell.thumbPath.slice(7)
      : cell.thumbPath;
    try {
      if (await RNFS.exists(filePath)) {
        await RNFS.unlink(filePath);
      }
    } catch (e) {
      console.warn('[session/store] deleteSessionFiles failed for', filePath, e);
    }
  }

  // 永続化した元画像（DocumentDirectory/sources 配下）も削除してストレージを解放する。
  if (session.imageUri.startsWith('file://') && session.imageUri.includes('/sources/')) {
    const srcPath = session.imageUri.slice(7);
    try {
      if (await RNFS.exists(srcPath)) {
        await RNFS.unlink(srcPath);
      }
    } catch (e) {
      console.warn('[session/store] deleteSessionFiles failed for source', srcPath, e);
    }
  }
}

/**
 * 指定 id のセッションを削除する。
 * 紐づく画像ファイル（DocumentDirectory）も一緒に削除する。
 */
export async function deleteSession(id: string): Promise<void> {
  return withQueue(async () => {
    const sessions = await readAll();
    const target = sessions.find(s => s.id === id);
    if (target) {
      await deleteSessionFiles(target);
    }
    const filtered = sessions.filter(s => s.id !== id);
    if (filtered.length === sessions.length) return;
    await writeAll(filtered);
  });
}
