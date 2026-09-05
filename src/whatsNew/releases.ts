/**
 * releases.ts — お知らせに出す更新内容。次の版は配列の先頭に1件足す。
 *
 * 文言は CHANGELOG/<版>.md の「リリースノート」（ストア貼り付け文）を短く写す。
 * ja / en を同じ件数・同じ意味で書く。コード名は使わない。
 *
 * version は 1.2.0 のように3段。アプリが 1.2 と返しても照合で揃う。
 * 日付はストアごとに違うので iOS / Android を別欄にする。YYYY-MM-DD。
 * その店でまだ出していない版は空のまま（お知らせでは日付を出さない）。
 */
export interface ReleaseCopy {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  dateIos?: string;
  dateAndroid?: string;
  ja: ReleaseCopy;
  en: ReleaseCopy;
}

export const RELEASES: Release[] = [
  {
    version: '1.2.0',
    dateIos: '2026-09-05',
    ja: {
      title: '背景除去の方式と編集まわり',
      items: [
        '背景除去に被写体検出を追加しました。現在は、iOS 17以降はVision、Android 7.0以降はML Kitです',
        '被写体検出が使える端末では、画像を選んだ直後に方式をカードで確認できます（設定でOFFにもできます）',
        '復元ブラシに消しゴムを追加しました。なぞった部分を透過できます',
        '「範囲を調整」のあとも、保存後と同じく拡大して透過の残りを確認できます',
        '日本語環境でアプリ名が英語のまま表示されていた不具合を直しました',
      ],
    },
    en: {
      title: 'Background removal and editing',
      items: [
        'Added subject detection for background removal. Currently Vision on iOS 17 or later, ML Kit on Android 7.0 or later',
        'On devices that support it, you can confirm the method on cards right after you pick an image (you can turn this off in Settings)',
        'Added an eraser to the restore brush. Trace to make areas transparent',
        'After Adjust range, you can zoom the preview the same way as after saving, to check leftover background',
        'Fixed the app name staying in English on Japanese devices',
      ],
    },
  },
  {
    version: '1.1.0',
    dateIos: '2026-08-30',
    ja: {
      title: '編集や操作まわりの使い勝手',
      items: [
        '「範囲を調整」で編集した内容がきちんと保存されるようにしました',
        'スポイトは色を選ぶと自動で解除され、操作の状態がわかりやすくなりました',
        '背景を透明にすると、完了をお知らせするメッセージが出るようにしました',
        'サムネイルの背景を市松模様にして、透明部分がひと目でわかるようにしました',
        'プレビューは✕ボタンで閉じるようにし、誤操作を防ぎます',
      ],
    },
    en: {
      title: 'Easier editing and controls',
      items: [
        'Edits from Adjust range are now saved correctly',
        'The eyedropper turns off automatically after you pick a color',
        'A message appears when the background has been made transparent',
        'Thumbnail backgrounds use a checkerboard so transparency is easy to see',
        'Previews close with the ✕ button to prevent accidental dismissals',
      ],
    },
  },
  {
    version: '1.0.2',
    dateIos: '2026-08-20',
    ja: {
      title: 'ストア掲載の更新',
      items: ['アプリの動作に変わりはありません。ストアの掲載名とサブタイトルを更新しました'],
    },
    en: {
      title: 'Store listing update',
      items: ['No changes to how the app works. The store name and subtitle were updated'],
    },
  },
  {
    version: '1.0.1',
    dateIos: '2026-08-19',
    ja: {
      title: 'ストア掲載の更新',
      items: ['アプリの動作に変わりはありません。ストアの掲載情報を更新しました'],
    },
    en: {
      title: 'Store listing update',
      items: ['No changes to how the app works. Store listing details were updated'],
    },
  },
  {
    version: '1.0.0',
    dateIos: '2026-08-17',
    ja: {
      title: 'スタンプ抜きを公開しました',
      items: [
        '画像を選ぶだけで、背景を自動で透明にします',
        'コマ割りされたイラストは、自動で1枚ずつに分割します',
        'うまく分割できない部分は、指でなぞって手動で調整できます',
        '透明PNGとして保存できるので、スタンプや素材としてすぐに使えます',
      ],
    },
    en: {
      title: 'Sticker Cutout is here',
      items: [
        'Pick an image and the background is made transparent automatically',
        'Comic-style sheets are split into individual cutouts',
        'If a split misses, you can trace and adjust by hand',
        'Save as transparent PNGs for stickers and assets',
      ],
    },
  },
];

/** 1.2 と 1.2.0 を同じ版として扱う。 */
export function normalizeVersion(v: string): string {
  const parts = v.replace(/^v/i, '').split('.').map(n => {
    const num = parseInt(n, 10);
    return Number.isFinite(num) ? num : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).join('.');
}

export function findRelease(version: string): Release | undefined {
  const n = normalizeVersion(version);
  return RELEASES.find(r => normalizeVersion(r.version) === n);
}
