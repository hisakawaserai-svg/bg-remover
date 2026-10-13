/**
 * releases.ts — お知らせに出す更新内容。次の版は配列の先頭に1件足す。
 *
 * 文言は CHANGELOG/<版>.md の「リリースノート」（ストア貼り付け文）を短く写す。
 * ja / en は共通。店ごとに違う行は jaIos / jaAndroid / enIos / enAndroid。
 * 同じロケール＋同じ店の中では、見出し・件数・意味を揃える。コード名は使わない。
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
  jaIos?: ReleaseCopy;
  jaAndroid?: ReleaseCopy;
  enIos?: ReleaseCopy;
  enAndroid?: ReleaseCopy;
}

export function copyForStore(release: Release, locale: 'ja' | 'en', os: 'ios' | 'android'): ReleaseCopy {
  if (locale === 'ja') {
    return (os === 'android' ? release.jaAndroid : release.jaIos) ?? release.ja;
  }
  return (os === 'android' ? release.enAndroid : release.enIos) ?? release.en;
}

export const RELEASES: Release[] = [
  {
    version: '1.2.2',
    jaIos: {
      title: '背景を消す画面を追加',
      sections: [
        {
          heading: '背景を消す画面',
          items: [
            '背景を消したあと、元の画像と見比べられるようになりました。チェック柄のところが透明です',
            '消し残しはこの画面で直せます。スポイト・強さ・消し方を、その画像だけに使えます',
            '下地を市松・白・黒に切り替えて、消し残しや消えすぎを見つけられます',
          ],
        },
        {
          heading: '分割設定',
          items: [
            '動かした線を「線の位置をリセット」で元に戻せるようになりました',
            '「分割の細かさ」をなくし、行数と列数だけで分けられるようにしました',
          ],
        },
        {
          heading: 'そのほか',
          items: [
            'はじめてガイドと使い方に、背景を消す画面の説明を入れました',
            '「分割しない」で分けたあとにリセットすると、等分に分け直されていた不具合を直しました',
            '木目のように背景が細かい写真で、透過中にアプリが終了したり時間がかかったりする不具合を直しました',
            '表示の崩れと不具合をいくつか修正しました',
          ],
        },
      ],
    },
    ja: {
      title: '背景を消す画面を追加',
      sections: [
        {
          heading: '背景を消す画面',
          items: [
            '背景を消したあと、元の画像と見比べられるようになりました。チェック柄のところが透明です',
            '消し残しはこの画面で直せます。スポイト・強さ・消し方を、その画像だけに使えます',
            '下地を市松・白・黒に切り替えて、消し残しや消えすぎを見つけられます',
          ],
        },
        {
          heading: '分割設定',
          items: [
            '動かした線を「線の位置をリセット」で元に戻せるようになりました',
            '「分割の細かさ」をなくし、行数と列数だけで分けられるようにしました',
          ],
        },
        {
          heading: 'そのほか',
          items: [
            'はじめてガイドと使い方に、背景を消す画面の説明を入れました',
            '「分割しない」で分けたあとにリセットすると、等分に分け直されていた不具合を直しました',
            '表示の崩れと不具合をいくつか修正しました',
          ],
        },
      ],
    },
    enIos: {
      title: 'New Remove Background screen',
      sections: [
        {
          heading: 'Remove Background screen',
          items: [
            'Compare the result with the original. Checkered means transparent',
            'Fix leftovers here with Tap erase, Strength, and Method, for this image only',
            'Switch the backdrop to spot leftovers or missing parts',
          ],
        },
        {
          heading: 'Split Settings',
          items: [
            'Reset line positions puts moved lines back',
            'Split detail is gone; just set rows and columns',
          ],
        },
        {
          heading: 'Other',
          items: [
            'Tutorial and How to Use cover the new screen',
            "Reset no longer re-splits evenly after Don't split",
            'Fixed crashes and slowness with detailed backgrounds such as wood grain',
            'Fixed some display issues and bugs',
          ],
        },
      ],
    },
    en: {
      title: 'New Remove Background screen',
      sections: [
        {
          heading: 'Remove Background screen',
          items: [
            'Compare the result with the original. Checkered means transparent',
            'Fix leftovers here with Tap erase, Strength, and Method, for this image only',
            'Switch the backdrop to spot leftovers or missing parts',
          ],
        },
        {
          heading: 'Split Settings',
          items: [
            'Reset line positions puts moved lines back',
            'Split detail is gone; just set rows and columns',
          ],
        },
        {
          heading: 'Other',
          items: [
            'Tutorial and How to Use cover the new screen',
            "Reset no longer re-splits evenly after Don't split",
            'Fixed some display issues and bugs',
          ],
        },
      ],
    },
  },
  {
    version: '1.2.1',
    jaAndroid: {
      title: '不具合の修正',
      sections: [
        {
          heading: '修正',
          items: [
            '日本語の端末で、アプリ名が英語のまま表示されていた不具合を直しました',
            '木目のように背景が細かい写真で、透過の途中にアプリが終了したり、時間がかかったりする不具合を直しました',
            '被写体検出で切り抜けなかったとき、色ベースでやり直す案内が出ずにエラーになる不具合を直しました',
          ],
        },
      ],
    },
    ja: {
      title: '不具合の修正',
      sections: [
        {
          heading: '修正',
          items: [
            '木目のように背景が細かい写真で、透過の途中にアプリが終了したり、時間がかかったりする不具合を直しました',
          ],
        },
      ],
    },
    enAndroid: {
      title: 'Bug fixes',
      sections: [
        {
          heading: 'Fixes',
          items: [
            'Fixed the app name staying in English on Japanese devices',
            'Fixed the app closing or taking a long time while making photos with detailed backgrounds, such as wood grain, transparent',
            'Fixed an error appearing instead of the option to try the color-based method when subject detection could not cut out an image',
          ],
        },
      ],
    },
    en: {
      title: 'Bug fixes',
      sections: [
        {
          heading: 'Fixes',
          items: [
            'Fixed the app closing or taking a long time while making photos with detailed backgrounds, such as wood grain, transparent',
          ],
        },
      ],
    },
  },
  {
    version: '1.2.0',
    dateIos: '2026-09-05',
    jaIos: {
      title: '背景除去の方式と編集まわり',
      sections: [
        {
          heading: '新機能',
          items: [
            '背景除去に被写体検出を追加しました。Visionにより、複雑な背景や人物の切り抜きに強くなりました',
            '「範囲を調整」の道具に消しゴムを追加しました。なぞった部分を透過できます',
            '「範囲を調整」で、未囲みの塊を色枠から選んでまとめて囲めるようにしました',
          ],
        },
        {
          heading: '改善',
          items: [
            '「範囲を調整」のあとも、保存後と同じく拡大して透過の残りを確認できます',
            '各画面に使い方を追加しました',
          ],
        },
        {
          heading: '修正',
          items: [
            '日本語環境でアプリ名が英語のまま表示されていた不具合を直しました',
            'プレビュー画面で、拡大したまま次の画像へ送ると前の画像が重なって残る不具合を直しました',
          ],
        },
      ],
    },
    jaAndroid: {
      title: '背景除去の方式と編集まわり',
      sections: [
        {
          heading: '新機能',
          items: [
            '背景除去に被写体検出を追加しました。ML Kitにより、複雑な背景や人物の切り抜きに強くなりました',
            '「範囲を調整」の道具に消しゴムを追加しました。なぞった部分を透過できます',
            '「範囲を調整」で、未囲みの塊を色枠から選んでまとめて囲めるようにしました',
          ],
        },
        {
          heading: '改善',
          items: [
            '「範囲を調整」のあとも、保存後と同じく拡大して透過の残りを確認できるようにしました',
            '各画面に使い方を追加しました',
          ],
        },
        {
          heading: '修正',
          items: [
            'プレビュー画面で、拡大したまま次の画像へ送ると前の画像が重なって残る不具合を直しました',
            '横向き画面になる不具合を直しました',
          ],
        },
      ],
    },
    ja: {
      title: '背景除去の方式と編集まわり',
      sections: [
        {
          heading: '新機能',
          items: [
            '背景除去に被写体検出を追加しました。複雑な背景や人物の切り抜きに強くなりました',
            '「範囲を調整」の道具に消しゴムを追加しました。なぞった部分を透過できます',
            '「範囲を調整」で、未囲みの塊を色枠から選んでまとめて囲めるようにしました',
          ],
        },
        {
          heading: '改善',
          items: [
            '「範囲を調整」のあとも、保存後と同じく拡大して透過の残りを確認できます',
            '各画面に使い方を追加しました',
          ],
        },
        {
          heading: '修正',
          items: [
            'プレビュー画面で、拡大したまま次の画像へ送ると前の画像が重なって残る不具合を直しました',
          ],
        },
      ],
    },
    enIos: {
      title: 'Background removal and editing',
      sections: [
        {
          heading: 'New',
          items: [
            'Added subject detection for background removal. On iOS 17 or later this uses Vision. Better for complex backgrounds and cutting out people',
            'Added Eraser to Adjust range. Trace to make areas transparent',
            'In Adjust range, pick leftover shapes from colored frames and enclose them together',
          ],
        },
        {
          heading: 'Improvements',
          items: [
            'After Adjust range, you can zoom the preview the same way as after saving',
            'Added how-to help on each screen',
          ],
        },
        {
          heading: 'Fixes',
          items: [
            'Fixed the app name staying in English on Japanese devices',
            'Fixed leftover images overlapping in Preview when you move to the next image while zoomed in',
          ],
        },
      ],
    },
    enAndroid: {
      title: 'Background removal and editing',
      sections: [
        {
          heading: 'New',
          items: [
            'Added subject detection for background removal using ML Kit. Better for complex backgrounds and cutting out people',
            'Added Eraser to Adjust range. Trace to make areas transparent',
            'In Adjust range, pick leftover shapes from colored frames and enclose them together',
          ],
        },
        {
          heading: 'Improvements',
          items: [
            'After Adjust range, you can zoom the preview the same way as after saving',
            'Added how-to help on each screen',
          ],
        },
        {
          heading: 'Fixes',
          items: [
            'Fixed leftover images overlapping in Preview when you move to the next image while zoomed in',
            'Fixed the screen rotating to landscape',
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
            'Added subject detection for background removal. Better for complex backgrounds and cutting out people',
            'Added Eraser to Adjust range. Trace to make areas transparent',
            'In Adjust range, pick leftover shapes from colored frames and enclose them together',
          ],
        },
        {
          heading: 'Improvements',
          items: [
            'After Adjust range, you can zoom the preview the same way as after saving',
            'Added how-to help on each screen',
          ],
        },
        {
          heading: 'Fixes',
          items: [
            'Fixed leftover images overlapping in Preview when you move to the next image while zoomed in',
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
