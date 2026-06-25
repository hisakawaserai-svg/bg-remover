/**
 * store.ts — セッション永続化ラッパー
 *
 * AsyncStorage の 1キー 'sticker_sessions' に StickerSession[] を
 * JSON 文字列で保存する薄いラッパー。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type { StickerSession } from './types';

const STORAGE_KEY = 'sticker_sessions';

async function readAll(): Promise<StickerSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StickerSession[];
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
}

export async function getSession(id: string): Promise<StickerSession | null> {
  const sessions = await readAll();
  return sessions.find(s => s.id === id) ?? null;
}

export async function upsertSession(session: StickerSession): Promise<void> {
  const sessions = await readAll();
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  await writeAll(sessions);
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
}

/**
 * 指定 id のセッションを削除する。
 * 紐づく画像ファイル（DocumentDirectory）も一緒に削除する。
 */
export async function deleteSession(id: string): Promise<void> {
  const sessions = await readAll();
  const target = sessions.find(s => s.id === id);
  if (target) {
    await deleteSessionFiles(target);
  }
  const filtered = sessions.filter(s => s.id !== id);
  if (filtered.length === sessions.length) return;
  await writeAll(filtered);
}
