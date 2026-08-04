/**
 * i18n/ja.ts — 日本語カタログ（このアプリの原文）。
 *
 * このファイルが全文言の「正」で、他言語（en.ts）はこの型に従う。
 * 文言を足す時はまずここへ書き、次に en.ts を埋める（埋めないとコンパイルが通らない）。
 *
 * 【名前空間の切り方】
 * 画面ごとに分け、複数画面で共有するものだけ common に置く。
 * 「同じ日本語だから」で共有すると、片方の言語で訳し分けたくなった時に
 * 分離できなくなるため、共有するのは意味まで同じものに限る。
 * 例: common.back（画面を戻る）は全画面で同じ意味なので共有してよい。
 *
 * 【翻訳しないもの】
 * 写真アルバムの内部ID（constants.ts の ALBUM_ID）はここに入れない。
 * 写真アプリ側に実在するアルバム名そのもので、言語で変わると過去に保存した
 * 画像を見失うため。アプリの表示名は app.name として翻訳対象に含める。
 */
import type { CatalogNode } from './types';

// satisfies を使う（型注釈にはしない）。注釈を付けるとキーがインデックス署名に
// 潰れて、t() のキー補完と存在チェックが効かなくなる。
const ja = {
  // ── アプリの表示名 ────────────────────────────────────────────────────────
  // 写真アルバムの内部ID(constants.ts の ALBUM_ID)とは別物。
  // こちらは画面に出す名前なので翻訳する。
  app: {
    name: 'スタンプ抜き',
    /**
     * 写真アルバムの「表示名」。内部ID（constants.ts の ALBUM_ID）とは別物。
     * 保存先を案内する文面に使う。実体名は設定の「アルバム名（内部）」で確認できる。
     */
    albumName: 'スタンプ抜き',
  },

  // ── 複数画面で共通のラベル ────────────────────────────────────────────────
  common: {
    back: '戻る',
    cancel: 'キャンセル',
    close: '閉じる',
    done: '完了',
    next: '次へ',
    start: 'はじめる',
    reset: 'リセット',
    save: '保存する',
    saving: '保存中...',
    delete: '削除',
    deleteAll: 'すべて削除',
    allow: '許可',
    preview: 'プレビュー',
    share: '共有する',
    unknownError: '不明なエラー',
    default: '既定',
  },

  // ── 背景色・分割線の色 ────────────────────────────────────────────────────
  colors: {
    checker: '市松',
    white: '白',
    black: '黒',
    blue: '青',
    orange: 'オレンジ',
    red: '赤',
  },

  // ── 「分割の細かさ」スライダーの目盛り ────────────────────────────────────
  granularity: {
    coarse: '粗い',
    medium: '中',
    fine: '細かい',
    // 許容値スライダー用の目盛り。「分割の細かさ」とは意味の向きが逆なので語彙を分ける
    // （許容値は大きいほど広く抜ける＝強い。細かい/粗いで言うと逆さまになる）。
    weak: '弱',
    normal: '標準',
    strong: '強',
    label: '分割の細かさ',
    hint: '合体するなら細かく',
    // 「弱⇄強」は初心者に何が起きるか伝わりにくいため、透過の強さを扱う
    // スライダー（自動除去・再透過）はこちらへ統一する。
    // 「人物優先＝弱（消しすぎない）」「背景優先＝強（広く消す）」で対応。
    personPriority: '人物優先',
    backgroundPriority: '背景優先',
    // スポイトは「その場でタップした色の周りをどれだけ広く消すか」という
    // 別の操作なので、優先度ではなく実際の見た目（消える範囲の広さ）で表現する。
    narrowRange: '狭い範囲',
    wideRange: '広い範囲',
  },

  // ── 権限まわりのダイアログ ────────────────────────────────────────────────
  permission: {
    galleryTitle: 'ギャラリーへのアクセス',
    galleryMessage: '画像を選択するために必要です。',
    saveTitle: '写真への保存',
    saveMessage: 'ギャラリーへの保存に必要です。',
    errorTitle: '権限エラー',
    galleryDenied: 'ギャラリーへのアクセスが拒否されました。',
    saveDenied: '写真への保存が拒否されました。',
  },

  // ── ホーム画面 ────────────────────────────────────────────────────────────
  home: {
    pickImage: '画像を選んで始める',
    newImage: '新しい画像を選ぶ',
    tagline: 'イラストシートからキャラを切り出す',
    emptyDesc: '1枚選ぶだけで自動で透過。\nLINEスタンプ用の PNG が作れます。',
    /** 英語では複数形が変わるので one/other を用意する（日本語は同一）。 */
    sheetOf: { one: '{count} キャラのシート', other: '{count} キャラのシート' },
    unprocessedSheet: '処理前のシート',
    progressTitle: '作業状況',
    inProgress: '作業中',
    latestWork: '最新の作業',
    recentWork: '最近の作業',
    processing: '処理しています...',
    gauge: {
      select: '選択',
      transparent: '透過',
      export: '書き出し',
    },
    features: {
      formats: 'PNG・JPEG・HEIC に対応',
      autoRemove: '背景を自動で透過処理',
      savePng: '透過 PNG でアルバムに保存',
    },
  },

  // ── セッション（最近の作業）の進捗ラベル ──────────────────────────────────
  session: {
    step: {
      picked: '未処理',
      removed: '透過済み',
      removedAuto: '透過済み（自動）',
      removedManual: '透過済み（手動）',
      done: '完了',
    },
    deleteTitle: '削除',
    deleteMessage: 'この作業を削除しますか？',
  },

  // ── 作業データの一括削除 ──────────────────────────────────────────────────
  deleteAll: {
    title: '作業データ',
    nothing: '削除する作業データはありませんでした。',
    doneTitle: '削除しました',
    doneCount: { one: '{count}件の作業データを削除しました。', other: '{count}件の作業データを削除しました。' },
    donePartial: '{count}件を削除しました。\n{failed}件は削除できませんでした。',
    errorTitle: '削除エラー',
  },

  // ── ポリゴン編集への遷移時のローディング ──────────────────────────────────
  loading: {
    editorTitle: '範囲の調整を準備しています',
    editorSub: '少々お待ちください',
    previewGenerating: 'プレビューを生成中...',
  },

  // ── 分割設定画面（SetupScreen）────────────────────────────────────────────
  setup: {
    title: '分割設定',
    modeAuto: '自動分割',
    modeManual: '範囲を調整',
    rows: '行数（段数）',
    columns: '列数',
    splitWithRows: 'この行数で分割',
    noSplit: '分割しない（1枚だけくり抜く）',
    splitsInto: { one: '{count}個に分かれます', other: '{count}個に分かれます' },
    rowsDisabled: '分割しない時は行数を指定できません',
    columnsDisabled: '分割しない時は列数を指定できません',
    moveHLine: '横線を移動',
    moveVLine: '縦線を移動',
    addRect: '四角を追加',
    addRectHint: '囲みたいキャラの上をタップ',
    tapToRemoveBg: 'タップで背景を消す',
    eyedropperHint: 'スポイトで背景を消す',
    manualDesc: '背景除去済みの画像を、四角で囲んで1枚ずつ切り出します。',
    noSplitButton: '分割せずにくり抜く',
    toPolygonEditor: '範囲を調整へ',
    rePickImage: '画像を選び直す',
    resetTitle: '編集をリセット',
    resetMessage: 'スポイトで消した色をすべて元に戻し、自動の背景除去だけ済んだ状態にします。\nこの操作は取り消せません。',
  },

  // ── 分割結果画面（ResultScreen）───────────────────────────────────────────
  result: {
    title: '分割結果',
    manualSplit: '手動分割',
    /** 分割結果の見出し。チュートリアルの模擬画面もこれを使う。 */
    cutsLabel: { one: 'カット後（{count}枚）', other: 'カット後（{count}枚）' },
    longPressHint: '長押しで選択・合体',
    selectedCount: { one: '{count}枚選択中', other: '{count}枚選択中' },
    mergeCount: { one: '{count}枚を合体する', other: '{count}枚を合体する' },
    needTwo: '2枚以上選択してください',
    shareCount: { one: '{count}枚を共有する', other: '{count}枚を共有する' },
    needAdjacent: 'すき間なく隣り合う2枚を選んでください',
    polygonCannotMerge: '範囲を調整済みのカットは合体できません',
    confirmTitle: '確認',
    warningMessage: 'うまく分割できていないスタンプがあります。\n\n対象: {targets}番',
    resetMessage: '分割結果を最初の状態に戻します。合体やカットの編集はすべて破棄されます。',
  },

  // ── ポリゴン編集画面（PolygonEditor）──────────────────────────────────────
  editor: {
    title: '範囲を調整',
    modeMove: '移動・調整',
    modeMoveHint: '四角をドラッグ／角をつまんで形を合わせる',
    modeAdd: '四角を追加',
    modeAddHint: '囲みたいキャラの上をタップ',
    modeEyedropper: 'スポイト',
    modeEyedropperHint: '消したい色をタップして透過',
    modeRestore: '復元ブラシ',
    modeRestoreHint: '消えすぎた部分をなぞって元に戻します',
    brushSize: 'ブラシの太さ',
    ghost: '元画像',
    reticleDecide: '決定',
    reticleRecording: '記録中',
    reticleSelected: '解除',
    uncoveredTitle: '囲まれていない部分があります',
    uncoveredMessage: '塗りつぶされていない部分は保存されません。このまま進めますか？',
    uncoveredBack: '戻って直す',
    uncoveredProceed: 'このまま進める',
    resetTitle: '編集をリセット',
    resetMessage: '囲みを消し、スポイトで消した色も元に戻して、自動の背景除去だけ済んだ状態にします。\nこの操作は取り消せません。',
    retransTitle: '透過強度',
    retransApply: 'このカットに再適用',
    retransScopeLabel: '対象範囲',
    retransScopeAll: '画像全体',
    // 「選択範囲のみ」だと既に選んである前提のように読めるが、実際は押した後に
    // 選ぶ流れなので、行動を示す文言にする（「今から選ぶんだな」と伝わるように）。
    retransScopeSelection: '範囲を指定する',
    // 「範囲を指定する」を押した直後（まだ何も選んでいない）: 選択段階へ進む。
    retransPickStart: '範囲を選ぶ',
    // 選択が済んだ後: そのまま実行する。
    retransApplyRegion: 'この範囲を再透過',
    // 選択済みの形をやり直したい時（方式は変えず、今の選択だけ捨てて
    // もう一度なぞり直す/選び直す）。「戻る」（方式選択に戻る）とは別物。
    retransRedo: '選択範囲をやり直す',
    // 範囲を再透過した直後、結果を見せながら聞く見出し。
    retransResultTitle: 'これでどうですか？',
    // 結果確認段階で「これでいい」を押した時。
    retransConfirm: '確定',
    // 結果確認段階のツール説明。
    retransResultDesc: '良ければ確定、やり直すなら選び直すか強さを調整してください',
    // 選択段階の案内。
    retransPickHint: '範囲を指定してください',
    // 選択方式（範囲の指定のしかた）。
    retransMethodPolygon: 'タップで囲む',
    retransMethodBrush: 'ブラシで選択',
    // 下部のツール説明(ToolHint)を、再透過カードが開いている間だけ差し替える
    // 内容。素の appMode の説明のままだと「今は再透過中」と伝わらないため。
    retransHintDesc: '対象範囲と強さを選んで実行してください',
    retransPickDesc: 'タップ、または十字パネルの決定ボタンで選択します',
    retransBrushDesc: '指でなぞって囲んでください。指を離すと確定します',
    eyedropDone: '💧 色を削除しました',
    eyedropNothing: '💧 削除できる色がありません',
    moveNothingHere: 'ここには頂点も囲みもありません',
    eyedropBusy: '色を削除中...',
    restoreBusy: '復元中...',
    undoBusy: '編集を戻しています...',
    redoBusy: '編集を適用しています...',
    retransBusy: '透過を処理中...',
    resetBusy: 'リセット中...',
    loadFailed: '画像の読み込みに失敗しました',
  },

  // ── プレビュー画面（PreviewScreen）────────────────────────────────────────
  preview: {
    title: 'プレビュー',
    backToEdit: '編集に戻る',
    saveCount: { one: '保存する（{count}枚）', other: '保存する（{count}枚）' },
    nothingToExport: '書き出す対象がありません',
    saveErrorTitle: '保存エラー',
  },

  // ── 保存完了画面（SaveCompleteScreen）─────────────────────────────────────
  saveComplete: {
    title: '保存完了',
    savedCount: { one: '{count}枚 保存しました', other: '{count}枚 保存しました' },
    albumSuffix: '「{album}」アルバム',
    another: '別の画像を処理する',
    checkDestination: '保存先を確認する',
    openLineMaker: 'LINE スタンプ Maker を開く',
  },

  // ── 保存先画面（SavedScreen）──────────────────────────────────────────────
  saved: {
    /** ヘッダー。読み込み中は枚数の代わりに … を出す。 */
    titleCount: { one: '保存先  {count} 枚', other: '保存先  {count} 枚' },
    titleLoading: '保存先  …',
    empty: 'まだ書き出した画像はありません',
    emptyDescription: '「{app}」で処理・保存した画像がここに表示されます',
    /** 日付の並び。英語では月日年の順になるので、順序ごと差し替えられるようにする。 */
    dateFormat: '{y}年{m}月{d}日',
  },

  // ── 設定画面（SettingsScreen）─────────────────────────────────────────────
  settings: {
    title: '設定',
    sectionTransparency: '透過設定',
    autoTolerance: '自動除去の強さ',
    autoToleranceHint: '背景優先にするほど、背景に近い色まで広く抜けます。背景が残るなら背景優先へ、絵が欠けるなら人物優先へ。',
    eyedropperTolerance: 'スポイトで消える範囲',
    eyedropperToleranceHint: '広いほど、タップした色に近い範囲まで広く消えます。狭いほど、似た色だけをピンポイントで消します。',
    feather: '輪郭をなじませる',
    featherHint: '境目の1pxを半透明にして白フチを防ぎます',
    fillTextHoles: '文字の穴を透過する',
    fillTextHolesHint: '「あ」「ロ」の内側など、囲まれた細い背景も抜きます。背景と同じ色の細い絵柄が消えることがあります',
    sectionExport: '書き出し',
    album: '保存先アルバム',
    autoDelete: '保存後に作業データを自動削除',
    autoDeleteHint: 'エクスポート完了後、カット画像と作業データを削除します',
    showDestination: '保存先の表示',
    columns: '列数',
    /** セグメントの「2列 / 3列 / 4列」。 */
    columnsValue: '{count}列',
    thumbBg: '背景色',
    splitLineColor: '分割線の色',
    boundaryColor: '境界線の色',
    language: '言語',
    languageAuto: '端末に合わせる',

    // ── ルーペ ──
    sectionLoupe: 'ルーペ',
    loupeMode: 'ルーペ操作',
    loupeModeHint: '指で隠れる位置を拡大表示する時の、照準の合わせ方',
    loupeModeFixed: '固定レティクル（推奨）',
    loupeModeAdjust: '微調整レティクル',
    loupeModeDrag: 'ドラッグ調整',
    loupeBaseMagnify: 'ルーペ倍率の基準',
    loupeBaseMagnifyHint: '上のルーペ倍率設定すべての基準になる拡大率（既定 ×24）',
    loupeBaseSize: 'ルーペ基準サイズ',
    loupeBaseSizeHint: 'ルーペ「大」の一辺(px)。「中」「収納」もこの比率で決まります（既定 160）',
    loupeZoomMode: 'ルーペ倍率',
    loupeZoomModeHint: 'ズーム中の表示範囲を変更します',
    loupeZoomModeFixed: '一定',
    loupeZoomModeMatch: '拡大して見る',
    loupeZoomModeInverse: '全体を見渡す',
    loupeDotGrid: 'ドットグリッド',
    loupeDotGridHint: '十分拡大した時、マス目と今のドットを薄く表示します',

    // ── 見た目(アプリアイコン / 起動アニメーション) ──
    sectionAppearance: '見た目',
    appIcon: 'アプリアイコン',
    appIconHint: '時間帯に合わせてホーム画面のアイコンが変わります',
    splashAnimation: '起動アニメーション',
    splashPattern: 'パターン',
    splashPatternAuto: '時間帯に合わせる',
    splashAutoHint: '時間帯に合わせてシマエナガの演出が変わります',
    splashAnimationHint: '起動時のシマエナガの演出',
    optionAuto: '自動（時間帯）',
    optionOff: 'オフ',
    iconDay: 'Day',
    iconNight: 'Night',
    iconSleep: 'Sleep',
    splashFly: 'Fly',
    splashPeel: 'Peel',
    splashCross: 'Cross',
    splashSleep: 'Sleep',
    splashShake: 'Shake',
    splashDrop: 'Drop（レア）',
    sectionAbout: 'このアプリについて',
    version: 'バージョン',
    howTo: '使い方',
    replayTutorial: 'チュートリアルをもう一度見る',
    deleteAllData: '作業データをすべて削除',
    deleteAllDataHint: '「最近の作業」と元画像を全部消します（保存済みの画像は残ります）',
    deleteAllDataMessage:
      '「最近の作業」をすべて削除し、保存されている元画像とサムネイルも消します。\n編集中の作業も対象です。\nこの操作は取り消せません。\n\n※「{album}」アルバムに保存済みの画像は消えません。',

    // ── 統計 ──
    sectionStats: '統計',
    statsAchievementTitle: '🏆 制作実績',
    statsStampsCreated: '作成したスタンプ',
    statsExportsCompleted: '書き出し完了',
    statsImagesEdited: '編集した画像',
    statsUsageTitle: '⚙️ 利用状況',
    statsTransparencyOps: '透過処理',
    statsWorkTime: '作業時間（目安）',
    statsWorkTimeHint: '編集画面を開いていた合計時間の目安です（放置時間も含まれることがあります）',
    statsCountUnit: '{count}個',
    statsTimesUnit: '{count}回',
    statsImagesUnit: '{count}枚',
    statsTimeUnderMinute: '1分未満',
    statsTimeMinutes: '{minutes}分',
    statsTimeHoursMinutes: '{hours}時間{minutes}分',
  },

  // ── 使い方画面（HowToScreen）──────────────────────────────────────────────
  howto: {
    title: '使い方',
    intro:
      'イラストシートの背景を除去し、キャラクターごとに切り出して透過PNGで保存するアプリです。まず自動で試し、うまくいかない部分だけ手動で直す、という流れで使います。',
    step1Title: 'STEP 1  画像を選ぶ',
    step1Body:
      'ホーム画面の「画像を選択」からイラストシートを選びます。\n複数キャラが並んだ1枚の画像でOKです。',
    step1Note:
      '対応形式：PNG・JPEG（JPG）・HEIC\n※その他の画像形式は正常に読み込めない場合があります。',
    step2Title: 'STEP 2  分割モードを選ぶ',
    step2Body:
      'セットアップ画面でモードを選びます。\n\n【自動分割】行数を確認・調整して「この行数で分割」。プレビューに分割線が表示されます。\n\n【範囲を調整】タップで各キャラを直接囲んで切り出します。自動がうまくいかないときに使います。',
    step2Note: 'まず自動を試してみてください。自動で大半は揃います。',
    step3Title: 'STEP 3  結果を確認・調整する',
    step3Body:
      '分割結果を確認し、ズレや合体があれば調整します。\n\n• 合体している → 「戻る」で分割の細かさを上げて分割し直す\n• 隣のカットとまとめたい → カットを長押しして選択し「合体する」\n• 1枚だけ直したい → カットをタップして範囲を調整\n• 編集をやり直したい → 「リセット」で最初の分割結果に戻す\n• 全部やり直したい → 「手動分割」で範囲調整モードへ',
    step3Note:
      '完璧でなくても「保存する」で透過PNGとして「{album}」アルバムに保存されます。\n段ごとに数が違う画像（例: 最後の段だけ列数が多い）は、自動分割が全段共通の線を使う都合で一部の段だけズレることがあります。その段のセルだけ「合体する」または「範囲を調整」で直してください。',
    complexTitle: '複雑な画像を分割する方法',
    complexDescription: '合体したキャラクターを分ける手順',
    polygonTitle: '範囲を調整の使い方',
    polygonDescription: '四角で囲む操作のアニメーション説明',
    tipsTitle: 'きれいに抜くコツ',
    tip1: '白・薄グレーの単色背景イラストが最も綺麗に抜ける',
    tip2: '分割の細かさは「中」から始め、合体して分かれないなら「細かい」へ',
    tip3: '自動でどうしても揃わない場合は「手動分割」で範囲を調整',
    noticeTitle: 'ご注意',
    notice1:
      '保存には写真への「フルアクセス」が必要です。「選択した写真のみ」だとアルバムに保存できません（設定 → プライバシーとセキュリティ → 写真）',
    notice2: '出力は透過PNGのみ（JPEG は透過を保持できないため）',
    notice3: '背景除去・分割の処理中はアプリを閉じないでください',
  },

  // ── ポリゴンのチュートリアル（PolygonTutorialScreen）──────────────────────
  polygonTutorial: {
    title: '範囲を調整',
    heading: '四角を置いて形を合わせる',
    subheading: '自動でうまくいかない時はこちら',
    step1: 'ペンを押して、キャラをタップ',
    step2: '四角が出る',
    step3: '白い点を外側へ広げてキャラを囲む',
    step4: '辺をタップで点を追加・長押しで削除',
    step5: '「プレビュー」で切り出して確認',
    dontShowAgain: '次回から表示しない',
  },

  // ── 初回オンボーディング（OnboardingScreen / Step1〜4）────────────────────
  onboarding: {
    step1: {
      caption: '「画像を選んで始める」をタップ',
      bubble: '背景を透過したい画像を選ぼう！',
      tagline: 'イラストシートからキャラを切り出す',
      lead: '1枚選ぶだけで自動で透過。',
      pick: '画像を選んで始める',
      savePng: '透過 PNG で保存',
      photoPickerTitle: '写真を選択',
    },
    step2: {
      caption: '「自動分割」で自動的に切り分けます',
      dragHint: '線がずれてたら、指でドラッグして動かせます',
      bubble: '行数と細かさを整えて「分割」をタップ',
    },
    step3: {
      caption: '分割されたカットを確認しよう！',
      bubble: 'OKなら「保存する」をタップ',
    },
    step4: {
      caption: '完成！透過PNGがアルバムに保存されます',
    },
    /** チュートリアル内のダミー画面が表示する「カット後（N枚）」。 */
  },

  // ── 複雑なシートのチュートリアル（ComplexTutorial）────────────────────────
  complexTutorial: {
    autoSplit: {
      caption: '自動分割は全段を同じ線で切ります',
      dragHint: '線がずれてたら、指でドラッグして動かせます',
      bubble: 'このまま「分割」をタップすると…',
    },
    merge: {
      caption: '下の2枚は1匹が割れています',
      bubble: '長押しで選んで、もう1枚をタップ→「合体」',
      bubble2: 'タップすれば1枚だけ編集できます',
    },
    finish: {
      caption: '角を動かして形を合わせます',
      bubble: 'あとは「保存する」だけ',
      closing: '複雑なシートもきれいに切り抜けます',
    },
    manualCrop: '手動切り抜き',
  },

  // ── 広告 ──────────────────────────────────────────────────────────────────
  ads: {
    label: '広告',
  },

  // ── エラー（画面だけでなく imaging 層の throw でも使う）────────────────────
  errors: {
    processTitle: '処理エラー',
    resultTitle: '結果',
    noForeground: '前景が検出されませんでした。行数を変えて再試行してください。',
    exportTitle: '書き出しエラー',
    restoreTitle: '復元エラー',
    sourceMissing: '元画像が見つかりません。もう一度画像を選び直してください。',
    decodeFailed: '画像のデコードに失敗しました',
    pixelsFailed: 'ピクセルデータの取得に失敗しました',
    cropFailed: 'クロップ画像の生成に失敗しました',
  },

  // ── 保存失敗の案内（saveErrors.ts）────────────────────────────────────────
  saveError: {
    headline: '写真アルバムに保存できませんでした。',
    guide: '写真へのアクセスが制限されている可能性があります。{path} を開き、{choice} を選んでください。',
    pathIos: '設定 → プライバシーとセキュリティ → 写真 → このアプリ',
    pathAndroid: '設定 → アプリ → このアプリ → 権限 → 写真と動画',
    choiceIos: '「すべての写真」',
    choiceAndroid: '「許可」',
    limitedNote: '※「選択した写真のみ」だと、アルバムへの保存ができません。',
    detail: '（詳細: {raw}）',
  },

  // ── 画像読み込み時の「既に透過済みかも」チェック（App.tsx processImage）───
  transparency: {
    // 透明画素の割合がかなり高い（or 四隅が全部透明）: 既に背景除去済みの
    // 可能性が高いケース。「編集する」＝除去をスキップしてそのまま使う。
    preCutoutTitle: 'この画像は背景が透過されています',
    preCutoutMessage: 'このまま編集モードを開きますか？',
    editAsIs: '編集する',
    // 「やり直す」だと、このアプリで一度やった処理を繰り返す意味に読めるが、
    // 実際はまだこのアプリでは除去していない（既に透過済みの画像に対して
    // 初めて背景除去を掛けるだけ）ので、「やり直す」ではなく素直に伝える。
    redoRemoval: 'そのまま背景除去する',
    // 割合がそこそこ（部分的に透過されているかも）程度のケース。
    // 止めるのではなく、教えるだけ（そのまま続行がデフォルトの動線）。
    partialTitle: 'この画像は既に透過されている可能性があります',
    partialMessage: 'もう一度背景除去を行うと、画質が低下する場合があります。',
    continueAnyway: 'そのまま続行',
  },
} satisfies CatalogNode;

export default ja;
