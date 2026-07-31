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
 * 新しい名前だけで引くと、それまでに保存した画像はアプリの「保存先」から
 * 見えなくなり、ユーザーからは消えたように映る。一度決めたら動かさない。
 *
 * 【それでも履歴を持つ理由】
 * 固定していても名前がずれることはある。ユーザーが写真アプリ側でアルバムを
 * 手で改名すると、保存済みの名前では引けなくなり「保存先」が空になる。
 * そのまま保存すると同名アルバムが作り直され、古い画像だけ取り残される。
 * 使ったことのある名前を全部覚えておき、照会時は全部から集めることで、
 * どの経路でずれても画像を見失わないようにする。
 */
import { useCallback, useMemo } from 'react';

import { useSettings } from './SettingsContext';
import { t } from '../i18n';

interface AlbumName {
  /**
   * これから保存する先。表示にもこれを使う。
   * まだ一度も保存していなければ「今の言語ならこうなる」を返す。
   */
  albumName: string;
  /**
   * 「保存先」画面が照会すべきアルバム名の全部（重複なし）。
   * 履歴に加えて現在名も必ず含む。
   */
  albumNamesToQuery: string[];
  /**
   * 保存の直前に呼ぶ。未確定なら現在の言語の名前を確定・永続化して返す。
   * 確定済みならその値をそのまま返す（言語が変わっていても変えない）。
   * 確定と同時に履歴へも積む。
   */
  ensureAlbumName: () => Promise<string>;
}

export function useAlbumName(): AlbumName {
  const { settings, updateSettings } = useSettings();

  const albumName = settings.albumName ?? t('app.albumName');

  // 履歴＋現在名。まだ保存していない場合も「これから作られる名前」を含めておく
  // （空配列を返すと照会側が何も引けなくなるため）。
  const albumNamesToQuery = useMemo(
    () => [...new Set([...(settings.albumNameHistory ?? []), albumName])],
    [settings.albumNameHistory, albumName],
  );

  const ensureAlbumName = useCallback(async () => {
    const history = settings.albumNameHistory ?? [];

    if (settings.albumName) {
      // 確定済み。履歴に無ければ補う（この項目より前に保存したデータ向け）。
      if (!history.includes(settings.albumName)) {
        await updateSettings({ albumNameHistory: [...history, settings.albumName] });
      }
      return settings.albumName;
    }

    const decided = t('app.albumName');
    await updateSettings({
      albumName: decided,
      albumNameHistory: history.includes(decided) ? history : [...history, decided],
    });
    return decided;
  }, [settings.albumName, settings.albumNameHistory, updateSettings]);

  return { albumName, albumNamesToQuery, ensureAlbumName };
}
