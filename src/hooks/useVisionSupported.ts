import { useEffect, useState } from 'react';
import { isVisionBgRemovalSupported } from '../imaging';

/**
 * この端末でVision(iOS17+実機)による背景除去が使えるか。
 * null=判定中。設定画面・分割確認画面など、Visionの選択肢を出すかどうかの
 * 判定に使う（使えない端末では選択肢自体を出さない）。
 */
export function useVisionSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    isVisionBgRemovalSupported().then(v => { if (!cancelled) setSupported(v); });
    return () => { cancelled = true; };
  }, []);
  return supported;
}
