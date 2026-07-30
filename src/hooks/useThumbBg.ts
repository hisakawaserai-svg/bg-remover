import { useSettings } from '../settings/SettingsContext';
import type { ThumbBg } from '../settings/store';

/**
 * 表示用の背景色（設定「背景色」）を返す。
 *
 * 'gray' は設定画面の選択肢から外したが、それ以前に選んでいたユーザーの保存値は
 * 残っているため、ここで 'white'（既定値）へ寄せる。こうしておけば
 * 「設定画面のどのボタンも選択中に見えないのに背景はグレー」という食い違いが起きない。
 * ThumbBg 型自体に 'gray' は残してあり、PolygonEditor の作業用背景では引き続き使える。
 */
export function useThumbBg(): ThumbBg {
  const { thumbBg } = useSettings().settings;
  return thumbBg === 'gray' ? 'white' : thumbBg;
}
