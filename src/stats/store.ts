/**
 * stats/store.ts — 利用統計の永続化
 *
 * settings/store.ts と同じ「単一キー JSON」方式だが、キーも型も設定とは
 * 完全に分離する（統計は「作業データを削除」しても残したい情報のため、
 * セッション削除・設定リセットの対象と混ざらないようにする）。
 *
 * 外部送信は一切行わない。端末内 AsyncStorage に保存するのみ。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_stats';

export interface AppStats {
  /**
   * 書き出しに成功したスタンプの枚数（生成した個数ではない）。
   * 分割し直し・合体・再編集で「生成した個数」は完成数と簡単にズレるため、
   * ユーザーが実際に見て嬉しい「完成品の枚数」に寄せてある。
   */
  stampsCreated: number;
  /** 書き出し処理が成功した回数（枚数ではなく回数） */
  exportsCompleted: number;
  /** アプリに読み込んで編集を開始した画像数 */
  imagesEdited: number;
  /** 自動透過・再透過など、透過処理を実行した回数 */
  transparencyOps: number;
  /**
   * 作業時間（目安）の累計ミリ秒。
   * 「編集画面を開いていた時間」の合計であり、放置・離席中も
   * アプリがフォアグラウンドのままなら計測に含まれ得るため目安表示にする。
   */
  workTimeMs: number;
}

export const DEFAULT_STATS: AppStats = {
  stampsCreated: 0,
  exportsCompleted: 0,
  imagesEdited: 0,
  transparencyOps: 0,
  workTimeMs: 0,
};

/** 統計を読み込む。失敗時はデフォルト値を返す（UI がクラッシュしないよう）。*/
export async function loadStats(): Promise<AppStats> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATS };
    return { ...DEFAULT_STATS, ...(JSON.parse(raw) as Partial<AppStats>) };
  } catch (e) {
    console.warn('[stats/store] loadStats failed:', e);
    return { ...DEFAULT_STATS };
  }
}

/** 統計を保存する。既存値との merge は呼び出し側で済ませてから渡す。*/
export async function saveStats(stats: AppStats): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.warn('[stats/store] saveStats failed:', e);
  }
}
