/**
 * releases.ts — お知らせに出す更新内容。次の版は配列の先頭に1件足す。
 *
 * 文言は CHANGELOG/<版>.md の「リリースノート」（ストア貼り付け文）を短く写す。
 * ja / en を同じ見出し・同じ件数・同じ意味で書く。コード名は使わない。
 *
 * sections の heading は自由（新機能 / 改善 / 修正 など）。空なら見出しなし。
 *
 * version は 1.2.0 のように3段。アプリが 1.2 と返しても照合で揃う。
 * 日付はストアごとに違うので iOS / Android を別欄にする。YYYY-MM-DD。
 * その店でまだ出していない版は空のまま（お知らせでは日付を出さない）。
 */
export interface ReleaseSection {
  heading?: string;
  items: string[];
}

export interface ReleaseCopy {
  title: string;
  sections: ReleaseSection[];
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
      sections: [
        {
          heading: '新機能',
          items: [
            '背景除去に被写体検出を追加しました。現在は、iOS 17以降はVision、Android 7.0以降はML Kitです',
            '背景除去は色ベースで始まります。被写体検出は設定、または分割画面のきらきらから切り替えられます',
            '「範囲を調整」の道具に消しゴムを追加しました。なぞった部分を透過できます',
            '「範囲を調整」で、未囲みの塊を色枠から選んでまとめて囲めるようにしました',
          ],
        },
        {
          heading: '改善',
          items: [
            '使い方に「流れ」を足し、範囲を調整は右の道具ごとに説明するようにしました',
            '「範囲を調整」のあとも、保存後と同じく拡大して透過の残りを確認できます',
            '保存後の全画面広告はやめて、完了画面の下に長方形の広告を置くようにしました',
            '画面下の広告を画面幅いっぱいに表示するようにしました',
          ],
        },
        {
          heading: '修正',
          items: [
            '日本語環境でアプリ名が英語のまま表示されていた不具合を直しました',
            '拡大したまま次の画像へ送ると、前の画像が重なって残る不具合を直しました',
            '微調整レティクルにしても、ルーペの大きさが勝手に変わらないようにしました',
          ],
        },
      ],
    },
    en: {
      title: 'Background removal and editing',
      sections: [
        {
          heading: 'New',
          items: [
            'Added subject detection for background removal. Currently Vision on iOS 17 or later, ML Kit on Android 7.0 or later',
            'Background removal starts with the color-based method. Switch to subject detection in Settings or with the sparkle on the split screen',
            'Added Eraser to the Adjust range tools. Trace to make areas transparent',
            'In Adjust range, you can pick leftover shapes from colored frames and enclose them together',
          ],
        },
        {
          heading: 'Improvements',
          items: [
            'How to use now has a Flow tab. Adjust range help is grouped by each tool on the right',
            'After Adjust range, you can zoom the preview the same way as after saving, to check leftover background',
            'Fullscreen ads after saving are gone. A rectangle ad sits at the bottom of the done screen',
            'The banner ad now spans the width of the screen',
          ],
        },
        {
          heading: 'Fixes',
          items: [
            'Fixed the app name staying in English on Japanese devices',
            'Fixed the previous image lingering when you move to the next while zoomed in',
            'Switching to the nudgeable crosshair no longer changes the loupe size',
          ],
        },
      ],
    },
  },
  {
    version: '1.1.0',
    dateIos: '2026-08-30',
    ja: {
      title: '編集や操作まわりの使い勝手',
      sections: [
        {
          heading: '改善',
          items: [
            '「範囲を調整」で編集した内容がきちんと保存されるようにしました',
            'スポイトは色を選ぶと自動で解除され、操作の状態がわかりやすくなりました',
            '背景を透明にすると、完了をお知らせするメッセージが出るようにしました',
            'サムネイルの背景を市松模様にして、透明部分がひと目でわかるようにしました',
            'プレビューは✕ボタンで閉じるようにし、誤操作を防ぎます',
          ],
        },
      ],
    },
    en: {
      title: 'Easier editing and controls',
      sections: [
        {
          heading: 'Improvements',
          items: [
            'Edits from Adjust range are now saved correctly',
            'The eyedropper turns off automatically after you pick a color',
            'A message appears when the background has been made transparent',
            'Thumbnail backgrounds use a checkerboard so transparency is easy to see',
            'Previews close with the ✕ button to prevent accidental dismissals',
          ],
        },
      ],
    },
  },
  {
    version: '1.0.2',
    dateIos: '2026-08-20',
    ja: {
      title: 'ストア掲載の更新',
      sections: [
        {
          items: ['アプリの動作に変わりはありません。ストアの掲載名とサブタイトルを更新しました'],
        },
      ],
    },
    en: {
      title: 'Store listing update',
      sections: [
        {
          items: ['No changes to how the app works. The store name and subtitle were updated'],
        },
      ],
    },
  },
  {
    version: '1.0.1',
    dateIos: '2026-08-19',
    ja: {
      title: 'ストア掲載の更新',
      sections: [
        {
          items: ['アプリの動作に変わりはありません。ストアの掲載情報を更新しました'],
        },
      ],
    },
    en: {
      title: 'Store listing update',
      sections: [
        {
          items: ['No changes to how the app works. Store listing details were updated'],
        },
      ],
    },
  },
  {
    version: '1.0.0',
    dateIos: '2026-08-17',
    ja: {
      title: 'スタンプ抜きを公開しました',
      sections: [
        {
          heading: '新機能',
          items: [
            '画像を選ぶだけで、背景を自動で透明にします',
            'コマ割りされたイラストは、自動で1枚ずつに分割します',
            'うまく分割できない部分は、指でなぞって手動で調整できます',
            '透明PNGとして保存できるので、スタンプや素材としてすぐに使えます',
          ],
        },
      ],
    },
    en: {
      title: 'Sticker Cutout is here',
      sections: [
        {
          heading: 'New',
          items: [
            'Pick an image and the background is made transparent automatically',
            'Comic-style sheets are split into individual cutouts',
            'If a split misses, you can trace and adjust by hand',
            'Save as transparent PNGs for stickers and assets',
          ],
        },
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
