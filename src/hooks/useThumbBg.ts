import { useSettings } from '../settings/SettingsContext';
import type { ThumbBg } from '../settings/store';

export function useThumbBg(): ThumbBg {
  return useSettings().settings.thumbBg;
}
