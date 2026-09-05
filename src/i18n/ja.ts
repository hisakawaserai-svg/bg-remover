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
    home: 'ホーム',
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
    help: '使い方',
    originalImage: '元画像',
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
    cellExitTitle: '編集内容を反映しています',
    cellExitSub: '少々お待ちください',
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
    addRectHint: '保存したいキャラを囲む',
    tapToRemoveBg: 'タップで背景を消す',
    eyedropperHint: 'スポイトで背景を消す',
    eyedropperDragBlocked: 'スポイト中は分割線を動かせません',
    bgRemoved: '背景を透明にしました',
    manualDesc: '保存したいキャラを囲みます。ペンで出した四角いブロックで囲まないと保存できません。囲んでいない絵は、確認画面にも保存にも出ません。',
    noSplitButton: '分割せずにくり抜く',
    toPolygonEditor: '範囲を調整へ',
    rePickImage: '画像を選び直す',
    changeEngineFab: '背景除去の方式',
    changeEngineConfirmTitle: '背景除去の方式を変えますか？',
    changeEngineConfirmMessage:
      '変更すると、この作業の囲みやスポイトは消えて最初からになります。',
    changeEngineConfirmAction: '変える',
    moveLines: '分割線を動かす',
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
    resetMessage: '自動分割した直後の状態に戻します。合体や、1枚ごとの範囲調整はすべて取り消されます。',
  },

  // ── ポリゴン編集画面（PolygonEditor）──────────────────────────────────────
  editor: {
    title: '範囲を調整',
    modeMove: '移動・調整',
    modeMoveHint: '四角をドラッグ／角をつまんで形を合わせる。辺をタップすると丸が増えて微調整しやすくなります',
    modeAdd: '四角を追加',
    modeAddHint: '保存したいキャラを囲む。囲んだ分だけ保存されます',
    drawMethodTapTitle: 'タップで囲む',
    drawMethodTapDesc: '頂点を配置して範囲を調整',
    drawMethodTraceTitle: 'なぞって選択',
    drawMethodTraceDesc: '指で囲んだ形から範囲を作成',
    drawMethodPickTitle: '候補から選ぶ',
    drawMethodPickDesc: '色の枠をタップして選び、囲む',
    drawMethodPickHint: '色付きの枠をタップして選び、「囲む」を押します。触れている絵は1つの枠になります',
    drawMethodPickEnclose: { one: '{count}個を囲む', other: '{count}個を囲む' },
    candidateBusy: '候補を探しています...',
    modeEyedropper: 'スポイト',
    modeEyedropperHint: '消したい色をタップして透過',
    modeRestore: '復元ブラシ',
    modeRestoreHint: '消えすぎた部分をなぞって元に戻します',
    modeErase: '消しゴム',
    modeEraseHint: '色に関係なく、なぞった部分を透過します（スポイトで消えない孤立した部分に）',
    goToSave: { one: '保存へ（{count}枚）', other: '保存へ（{count}枚）' },
    goToSaveLabel: '保存へ',
    showToolHint: '説明',
    brushModeRestore: '戻す',
    brushModeErase: '消しゴム',
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
    retransTitle: '再透過',
    retransApply: '適用',
    retransScopeLabel: '対象範囲',
    retransScopeAll: '画像全体',
    // 「選択範囲のみ」だと既に選んである前提のように読めるが、実際は押した後に
    // 選ぶ流れなので、行動を示す文言にする（「今から選ぶんだな」と伝わるように）。
    retransScopeSelection: '範囲を指定する',
    // 「範囲を指定する」を押した直後（まだ何も選んでいない）: 選択段階へ進む。
    retransPickStart: '範囲を選ぶ',
    // 選択が済んだ後: そのまま実行する。
    retransApplyRegion: 'この範囲を再透過',
    // 範囲を再透過した直後、結果を見せながら聞く見出し。
    retransResultTitle: 'これでどうですか？',
    // 結果確認段階で「これでいい」を押した時。
    retransConfirm: '確定',
    // 結果確認段階のツール説明。
    retransResultDesc: '確定するか、選び直して調整',
    // 選択段階の案内。
    retransPickHint: '範囲を指定',
    // 選択方式（範囲の指定のしかた）。
    retransMethodPolygon: 'タップで囲む',
    // 「ブラシで選択」は絵筆で塗る操作を連想させるが、実際は draw モードの
    // 「なぞって選択」と全く同じ、指でなぞって輪郭を作る操作なので、
    // 文言もそちらに揃える。
    retransMethodBrush: 'なぞって選択',
    // 下部のツール説明(ToolHint)を、再透過カードが開いている間だけ差し替える
    // 内容。素の appMode の説明のままだと「今は再透過中」と伝わらないため。
    // 視覚的な圧縮のため簡潔にする（多くはピル/アイコン等で既に見えている）。
    retransHintDesc: '範囲と強さを選択',
    retransPickDesc: 'タップまたは決定ボタンで選択',
    retransBrushDesc: 'なぞって囲む。指を離すと確定',
    // ペンモードの編集方法トグルと同じ常時表示にしたため、方式未選択の間の
    // 見出し説明用に追加。
    retransChooseMethodDesc: '下のどちらかを選んでください',
    eyedropDone: '💧 色を削除しました',
    eyedropNothing: '💧 削除できる色がありません',
    moveNothingHere: 'ここには頂点も囲みもありません',
    eyedropBusy: '色を削除中...',
    restoreBusy: '復元中...',
    eraseBusy: '消去中...',
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
    cutsLabel: { one: '切り取り（{count}枚）', other: '切り取り（{count}枚）' },
    saveCount: { one: 'アルバムに保存する（{count}枚）', other: 'アルバムに保存する（{count}枚）' },
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
    dockDest: '保存先',
    dockShare: '共有',
    dockHome: 'ホーム',
    openLineMaker: 'LINE スタンプ Maker を開く',
    backToHome: 'ホームに戻る',
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

  // ── 背景除去方式の選択モーダル（BgEngineChoiceModal）───────────────────────
  // カードの文言は「方式の名前」ではなく「これを選ぶと何が起きるか」を主語に書く。
  bgEngineChoice: {
    title: '背景除去の方式を選ぶ',
    subtitle: 'この画像にはどちらを使いますか？',
    floodDesc: '背景の色を基準に、同じような色をまとめて透過します。単色〜均一な背景の写真・イラストに向いています。',
    visionDesc: '写真の中から被写体そのものを判別して透過します。複雑な背景や人物の写真に強い方式です。',
    visionCaution: '注意: 文字やロゴなど「被写体ではない」と判定した部分も一緒に消えることがあります。',
  },

  whatsNew: {
    kicker: '更新内容',
    versionLabel: 'バージョン {version}',
  },

  // ── 設定画面（SettingsScreen）─────────────────────────────────────────────
  settings: {
    title: '設定',
    sectionTransparency: '透過設定',
    bgEngine: '背景除去の方式',
    bgEngineHint: '色ベースは背景色を基準に判定。被写体検出は背景が複雑な写真や人物の切り抜きに強い方式です。\n注意: 文字やロゴなど「被写体ではない」と判定した部分も消えることがあります。',
    bgEngineHintUnavailable: '被写体検出はこの端末のOSでは使えません。',
    bgEngineFlood: '色ベース',
    bgEngineVision: '被写体を検出 (Vision)',
    bgEngineMlkit: '被写体を検出 (ML Kit)',
    bgEngineOsTooLowTitle: 'OSのバージョンが足りません',
    bgEngineOsTooLowMessage: 'この方式は、今のOSでは使えません。',
    confirmBgEngineEachTime: '画像を選ぶたびに確認する',
    confirmBgEngineEachTimeHint: 'ONにすると、画像を選ぶたびに色ベースか被写体検出かを聞きます。普段はOFFのままで色ベースです。',
    confirmBgEngineEachTimeDisabledHint: '被写体検出が使えないため、毎回の確認は出しません。OSを更新すると使えるようになります。',
    autoTolerance: '自動除去の強さ',
    autoToleranceHint: '背景優先にするほど、背景に近い色まで広く抜けます。背景が残るなら背景優先へ、絵が欠けるなら人物優先へ。',
    eyedropperTolerance: 'スポイトで消える範囲',
    eyedropperToleranceHint: '広いほど、タップした色に近い範囲まで広く消えます。狭いほど、似た色だけをピンポイントで消します。',
    feather: '輪郭をなじませる',
    featherHint: '境目の1pxを半透明にして白フチを防ぎます',
    fillTextHoles: '文字の穴を透過する',
    fillTextHolesHint: '「あ」「ロ」の内側など、囲まれた細い背景も抜きます。背景と同じ色の細い絵柄が消えることがあります',

    // ── 編集操作 ──
    sectionEditOperation: '編集操作',
    brushDefaultPx: 'ブラシ標準サイズ',
    brushDefaultPxHint: '復元ブラシなどの初期の太さを設定します',
    ghostDefaultOn: 'ゴースト表示を初期状態でON',
    ghostDefaultOnHint: '編集を始めた時、元画像を薄く透かして表示しておきます',
    loupeMode: '編集操作モード',
    loupeModeHint: 'ポリゴンをどのように狙って編集するかを設定します',
    loupeModeFixed: 'ドラッグ（推奨）',
    loupeModeAdjust: '微調整レティクル',
    loupeModeDrag: 'ドラッグ調整',

    sectionExport: '書き出し',
    album: '保存先アルバム',
    autoDelete: '保存後に作業データを自動削除',
    autoDeleteHint: 'エクスポート完了後、カット画像と作業データを削除します',
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
    loupeBaseMagnify: 'ルーペ倍率の基準',
    loupeBaseMagnifyHint: '上のルーペ倍率設定すべての基準になる拡大率（既定 ×24）',
    loupeBaseSize: 'ルーペ基準サイズ',
    loupeBaseSizeHint: 'ルーペ「大」の一辺(px)。「中」「収納」もこの比率で決まります（既定 160）',
    loupeZoomMode: 'ルーペ倍率モード',
    loupeZoomModeHint: 'ズーム中の表示範囲を変更します',
    loupeZoomModeFixed: '一定',
    loupeZoomModeMatch: '拡大して見る',
    loupeZoomModeInverse: '全体を見渡す',
    loupeDotGrid: 'ドットグリッド',
    loupeDotGridHint: '十分拡大した時、マス目と今のドットを薄く表示します',

    // ── 表示・見た目(アプリアイコン / 起動アニメーション / 保存先の表示) ──
    sectionAppearance: '表示・見た目',
    appIcon: 'アプリアイコン',
    appIconHint: 'ホーム画面に出すアイコンを選べます',
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
    versionHint: 'タップして更新内容を見る',
    howTo: '使い方',
    replayTutorial: 'チュートリアルをもう一度見る',
    licenses: 'オープンソースライセンス',
    rateApp: 'アプリを評価する',
    support: 'お問い合わせ',
    supportHint: 'サポートページを開きます',
    privacyPolicy: 'プライバシーポリシー',
    adsPrivacyOptions: '広告のプライバシー設定',
    adsPrivacyOptionsHint: '広告に関する同意の内容を変更できます',
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
    tabFlow: '流れ',
    tabAuto: '自動分割',
    tabEditor: '範囲を調整',
    tabResult: '分割結果',
    tabTrouble: '困ったとき',
    flowLead: 'わからないときはこの「流れ」。やり方は2つです。並びが複雑なときは「自分で囲む」です。',
    autoLead: '画像を選ぶ → ここで段と列を確認して分割する → 結果を見て保存。うまくいかなければ、切れた絵をタップして「範囲を調整」へ。',
    flowAutoTitle: '自動で分割する',
    flowAuto1: '写真を選ぶ',
    flowAuto2: '段と列を確認する。線がキャラに乗っていたらずらす',
    flowAuto3: '「この行数で分割」を押す',
    flowAuto4: '切れた絵を見て「保存する」',
    flowAutoNote: 'バラバラ・重なりなど複雑なときは、下の「自分で囲む」です。うまくいかなければ、切れた絵をタップして「範囲を調整」へ。',
    flowManualTitle: '自分で囲む',
    flowManualWarn: 'ペンで出した四角に囲まれた部分だけが保存されます。囲んでいない絵は保存されません。',
    flowManual1: '写真を選ぶ',
    flowManual2: '「範囲を調整へ」を押す',
    flowManual3: '右上の道具からペンを選んで、キャラをタップして四角を出す',
    flowManual4: '白い点を動かして、保存したいキャラを囲む',
    flowManual5: '下の「保存へ」を押す',
    flowManual6: '確認して、アルバムに保存する',
    sectionBasics: '基本',
    sectionWhere: 'どこにあるか',
    sectionTools: '囲み方',
    sectionFix: '直す道具',
    sectionScreen: '画面のボタン',
    autoRows: 'シートの段の数です。数字の − ＋ で変えます。',
    autoCols: '1段あたりの数です。数字の − ＋ で変えます。',
    autoLines: '画面に出ている横線・縦線を、指でドラッグして動かします。キャラに線が乗っていたらずらしてください。',
    autoDetail:
      'すき間を見て、分割線を自動で置くときの細かさです。細かくすると小さいすき間でも線が入ります。線の本数は上の行数・列数、位置は指で直せます。',
    autoEyedrop: '画像の上をタップして、残った背景色を消します。スポイト中は分割線を動かせません。',
    autoNoSplit: 'チェックすると、行・列は使わず1枚だけくり抜きます。',
    autoOriginal: 'ヘッダーの画像アイコン。透過する前の元の絵を拡大して見ます。',
    autoEngine: '左下のきらきら。設定と同じ「背景除去の方式」です。色ベースと被写体検出を切り替えます。',
    autoEngineWarn: '変更すると、この作業の囲みやスポイトは消えて最初からになります。',
    autoToManual: 'うまくいかなければ、切れた絵をタップして「範囲を調整」へ。並びが複雑なときは、上の「範囲を調整」タブからも入れます。',
    editorPremise:
      '保存したいキャラを囲みます。ペンで出した四角いブロックで囲まないと保存できません。囲んでいない絵は、確認画面にも保存にも出ません。',
    editorPinchTitle: '二本指',
    editorPinch: '二本指で画面を動かせます。二本指を広げたり縮めたりすると、拡大・縮小できます。上のズームバーでも変えられます。',
    editorAddWhere: '右の道具から「四角を追加」を選びます。',
    editorAddWarn: '保存したいキャラを囲みます。囲んでいない絵は、確認画面にも保存にも出ません。',
    editorPick: '黄色い枠をタップして選び、「囲む」で四角を置きます。触れている絵は1つの枠になります。',
    editorEraseWhere: '右の道具から消しゴムを選びます。スポイトで消えない点々をなぞって消します。',
    editorRetrans: '右のきらきら（再透過）。消えすぎ／残りを、範囲を決めてやり直します。',
    editorGhost: '復元ブラシを開いているときの「元画像」。消えた部分を、元の絵と重ねて見ます。',
    editorOriginal: 'ヘッダーの画像アイコン。透過前の元の絵を拡大します。',
    editorBg: '右の下地ボタン。市松（格子）は透明の見え方、太陽は白、月は黒です。消し残しを見るために切り替えます。',
    editorLoupe: '右の照準ボタン。設定の「編集操作モード」と同じです。指で直接狙うか、十字の照準で狙うかを切り替えます。',
    editorHideChromeTitle: '枠を隠す',
    editorHideChrome: '右の目のアイコン。枠やボタンを一時的に隠して、絵の端を見やすくします。',
    editorPreview: '下のバーの「保存へ」。囲んだ分だけ切り出して確認し、アルバムに保存します。',
    resultTap: '1枚を短くタップすると、その枚だけ範囲を調整できます。',
    resultNumbersTitle: '番号',
    resultLongPress: 'すき間なく辺がぴったり接している2枚だけ合体できます。長押ししてから隣をタップし、「合体」を押します。離れている枚や、角だけ触れている枚は選べません。',
    resultNumbers: '見出し右の「1」。数字が邪魔なら消します。透過の確認用です。',
    resultBg: '見出し右の下地。市松（格子）は透明、太陽は白、月は黒です。消し残しを見るために切り替えます。',
    resultOriginal: 'ヘッダーまたは見出し右の画像アイコン。透過前の元の絵を拡大します。',
    resultSave: '下の保存ボタン。アルバム「{album}」に透過PNGが入ります。',
    resultReset: '下のリセット。自動分割した直後に戻します。合体や1枚ごとの編集は取り消されます。',
    troubleSplitTitle: 'うまく分かれない',
    troubleSplit:
      'まず分割結果で、隣り合って割れてしまった枚を長押しで合体します。その1枚をタップして範囲を調整を開き、ブロックで囲み直すと1キャラとして出せます。行・列や線がずれているときは分割設定に戻って直してから、同じ手順でも構いません。',
    troubleBgTitle: '背景が残る／消えすぎる',
    troubleBg:
      '残っている色はスポイト。色がバラバラな消し残しは消しゴム。消えすぎたら復元ブラシ。範囲を調整では再透過も使えます。',
    troubleSaveTitle: '保存できない',
    troubleSave:
      '写真のアクセスを「すべての写真」にしてください。「選択した写真のみ」ではアルバムに保存できません（設定 → プライバシーとセキュリティ → 写真）。',
    troubleFormatTitle: '使える画像と保存形式',
    troubleFormat: '読み込みは PNG・JPEG・HEIC。保存は透過PNGだけです（JPEGには透明が残りません）。',
    troubleProcessTitle: '処理中に閉じない',
    troubleProcess: '背景除去や分割の途中でアプリを閉じると、途中までが残らないことがあります。終わるまで待ってください。',
    troubleEngineTitle: '方式を変えたら作業が消えた',
    troubleEngine:
      '分割設定の左下できらきらを押して方式を変えると、その作業の囲みやスポイトは消えます。同じ画像で最初からやり直す操作です。',
    complexTitle: '複雑な画像を分割する方法',
    complexDescription: '合体したキャラクターを分ける手順',
    polygonTitle: '範囲を調整の使い方',
    polygonDescription: '四角を置いてキャラを囲む操作のアニメーション説明',
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
    step5: '「保存へ」で切り出して確認',
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
    encodeFailed: '画像のエンコードに失敗しました',
    visionUnsupported: 'この背景除去方式は、今のOSでは使えません。',
    visionUnavailable: 'この方式は今使えません。色ベースでお試しください。',
    visionFailed: '被写体を検出できませんでした。色ベースの方式でお試しください。',
    retryWithFlood: '色ベースで試す',
    visionSizeMismatch: '処理結果の画像サイズが一致しませんでした。もう一度お試しください。',
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
