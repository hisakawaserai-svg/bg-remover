/**
 * useAlbumName — 写真アルバムの名前を1箇所で解決する。
 *
 * 【なぜフックにするか】
 * アルバム名は「初回保存時の表示言語で決めて、以後固定」という規則で運用する。
 * 決定と永続化を各画面に散らすと、保存側と照会側で違う名前を使う事故が起きる
 * （保存は英語名・一覧は日本語名で引く、など）。入口をここに絞る。
 *
 * 【なぜ言語に追従させないか】
 * アルバム名を後から変えると、写真アプリ側に別のアルバムができる。
 * それまでに保存した画像はアプリの「保存先」から見えなくなり、ユーザーからは
 * 消えたように映る。一度決めたら動かさないことで、アプリの案内文と
 * 写真アプリの実体が常に一致する。
 */
import { useCallback } from 'react';

import { useSettings } from './SettingsContext';
import { t } from '../i18n';

interface AlbumName {
  /**
   * 表示・照会に使うアルバム名。
   * まだ保存したことがなければ「これから作られる名前」（現在の言語）を返す。
   */
  albumName: string;
  /**
   * 保存の直前に呼ぶ。未確定なら現在の言語の名前を確定・永続化して返す。
   * 確定済みならその値をそのまま返す（言語が変わっていても変えない）。
   */
  ensureAlbumName: () => Promise<string>;
}

export function useAlbumName(): AlbumName {
  const { settings, updateSettings } = useSettings();

  // 未確定のうちは「今の言語ならこうなる」を見せる。確定後は保存済みの値。
  const albumName = settings.albumName ?? t('app.albumName');

  const ensureAlbumName = useCallback(async () => {
    if (settings.albumName) return settings.albumName;
    const decided = t('app.albumName');
    await updateSettings({ albumName: decided });
    return decided;
  }, [settings.albumName, updateSettings]);

  return { albumName, ensureAlbumName };
}
