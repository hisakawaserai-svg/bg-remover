/**
 * StatsContext — 利用統計の共有と永続化を一元管理する
 *
 * SettingsContext と同じ形（Provider がロード、フックで読み書き）だが、
 * 用途が「頻繁に呼ばれる加算」中心なので、加算専用のヘルパー
 * （recordXxx / addWorkTimeMs）だけを公開する。呼び出し側は現在値を
 * 気にせず「+1 する」「n ミリ秒足す」を呼ぶだけでよい。
 *
 * 加算は statsRef（最新値を同期的に保持する ref）に対して行ってから
 * state 更新 + AsyncStorage 書き込みを行う。ref を経由することで、
 * 同一フレーム内で複数回呼ばれても取りこぼさない
 * （state の更新だけに頼ると setState のバッチ処理で古い値を参照しうる）。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { loadStats, saveStats, DEFAULT_STATS } from './store';
import type { AppStats } from './store';

interface StatsContextValue {
  /** 現在の統計値。読み込み完了前は DEFAULT_STATS が入っている。 */
  stats: AppStats;
  loaded: boolean;
  /** 画像を読み込んで編集を開始した時に呼ぶ */
  recordImageEdited: () => void;
  /** 自動透過・再透過を実行した時に呼ぶ */
  recordTransparencyOp: () => void;
  /** 書き出しが成功した時に、実際に書き出せた枚数をまとめて加算する */
  recordStampsCreated: (count: number) => void;
  /** 書き出しが成功した時に呼ぶ。加算後の累計書き出し回数を返す（レビュー要求の閾値判定に使う） */
  recordExportCompleted: () => number;
  /** 作業時間を加算する（ミリ秒） */
  addWorkTimeMs: (ms: number) => void;
}

const StatsContext = createContext<StatsContextValue>({
  stats: DEFAULT_STATS,
  loaded: false,
  recordImageEdited: () => {},
  recordTransparencyOp: () => {},
  recordStampsCreated: () => {},
  recordExportCompleted: () => 0,
  addWorkTimeMs: () => {},
});

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<AppStats>(DEFAULT_STATS);
  const [loaded, setLoaded] = useState(false);
  const statsRef = useRef<AppStats>(DEFAULT_STATS);

  useEffect(() => {
    void loadStats().then(s => {
      statsRef.current = s;
      setStats(s);
      setLoaded(true);
    });
  }, []);

  // patch を ref に同期反映してから state 更新 + 永続化する共通処理。
  const apply = useCallback((patch: Partial<AppStats>) => {
    const next = { ...statsRef.current, ...patch };
    statsRef.current = next;
    setStats(next);
    void saveStats(next);
  }, []);

  const recordImageEdited = useCallback(() => {
    apply({ imagesEdited: statsRef.current.imagesEdited + 1 });
  }, [apply]);

  const recordTransparencyOp = useCallback(() => {
    apply({ transparencyOps: statsRef.current.transparencyOps + 1 });
  }, [apply]);

  const recordStampsCreated = useCallback((count: number) => {
    if (count <= 0) return;
    apply({ stampsCreated: statsRef.current.stampsCreated + count });
  }, [apply]);

  const recordExportCompleted = useCallback(() => {
    const next = statsRef.current.exportsCompleted + 1;
    apply({ exportsCompleted: next });
    return next;
  }, [apply]);

  const addWorkTimeMs = useCallback((ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return;
    apply({ workTimeMs: statsRef.current.workTimeMs + ms });
  }, [apply]);

  return (
    <StatsContext.Provider
      value={{
        stats,
        loaded,
        recordImageEdited,
        recordTransparencyOp,
        recordStampsCreated,
        recordExportCompleted,
        addWorkTimeMs,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats(): StatsContextValue {
  return useContext(StatsContext);
}
