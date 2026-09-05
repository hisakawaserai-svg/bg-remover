import { useEffect, useState } from 'react';
import { isVisionBgRemovalSupported, subscribeSubjectDetectionSupport } from '../imaging';

/**
 * 被写体検出（iOS Vision / Android ML Kit）がこの端末で使えるか。
 * null=判定中。OS不足・この起動中の方式停止のどちらでも false になる。
 */
export function useVisionSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      isVisionBgRemovalSupported().then(v => { if (!cancelled) setSupported(v); });
    };
    refresh();
    const unsub = subscribeSubjectDetectionSupport(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return supported;
}
