/**
 * i18n/en.ts — 英語カタログ。
 *
 * 型を `typeof ja` にしてあるので、ja.ts にキーを足してここを埋め忘れると
 * コンパイルエラーになる。実行時に「英語だけ文言が出ない」ことが起きない。
 *
 * 【複数形】
 * ja では one/other が同じ文言だが、英語は使い分ける。
 * t() は vars.count を見て one / other を選ぶ。
 *
 * 【アルバム名】
 * 案内文の {album} には app.albumName（翻訳した表示名）を入れる。
 * 写真アプリ側の実体名は constants.ts の ALBUM_ID で固定されており、
 * そちらは設定の「アルバム名（内部）」でだけ生の値を見せる。
 */
import type ja from './ja';

const en: typeof ja = {
  app: {
    name: 'Sticker Cutout',
    albumName: 'Sticker Cutout',
  },

  common: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    done: 'Done',
    next: 'Next',
    start: 'Get Started',
    reset: 'Reset',
    save: 'Save',
    saving: 'Saving...',
    delete: 'Delete',
    deleteAll: 'Delete All',
    allow: 'Allow',
    preview: 'Preview',
    share: 'Share',
    unknownError: 'Unknown error',
  },

  colors: {
    checker: 'Checker',
    white: 'White',
    black: 'Black',
    blue: 'Blue',
    orange: 'Orange',
    red: 'Red',
  },

  granularity: {
    coarse: 'Coarse',
    medium: 'Medium',
    fine: 'Fine',
    // Ticks for the tolerance sliders. Opposite in meaning to "split detail"
    // (higher tolerance removes more = stronger), so the wording is kept separate.
    weak: 'Weak',
    normal: 'Normal',
    strong: 'Strong',
    label: 'Split detail',
    hint: 'Use finer if cutouts merge together',
  },

  permission: {
    galleryTitle: 'Photo Library Access',
    galleryMessage: 'Required to choose an image.',
    saveTitle: 'Save to Photos',
    saveMessage: 'Required to save to your photo library.',
    errorTitle: 'Permission Error',
    galleryDenied: 'Access to the photo library was denied.',
    saveDenied: 'Saving to Photos was denied.',
  },

  home: {
    pickImage: 'Choose an Image',
    newImage: 'Choose Another Image',
    tagline: 'Cut characters out of illustration sheets',
    emptyDesc: 'Just pick one image and the background goes automatically.\nMake PNGs ready for LINE stickers.',
    sheetOf: { one: 'Sheet with {count} character', other: 'Sheet with {count} characters' },
    unprocessedSheet: 'Unprocessed sheet',
    progressTitle: 'Progress',
    inProgress: 'In progress',
    latestWork: 'Latest work',
    recentWork: 'Recent work',
    processing: 'Processing...',
    gauge: {
      select: 'Select',
      transparent: 'Remove BG',
      export: 'Export',
    },
    features: {
      formats: 'Supports PNG, JPEG and HEIC',
      autoRemove: 'Removes the background automatically',
      savePng: 'Saves transparent PNGs to your album',
    },
  },

  session: {
    step: {
      picked: 'Unprocessed',
      removed: 'BG removed',
      removedAuto: 'BG removed (auto)',
      removedManual: 'BG removed (manual)',
      done: 'Done',
    },
    deleteTitle: 'Delete',
    deleteMessage: 'Delete this work?',
  },

  deleteAll: {
    title: 'Work Data',
    nothing: 'There was no work data to delete.',
    doneTitle: 'Deleted',
    doneCount: { one: 'Deleted {count} item of work data.', other: 'Deleted {count} items of work data.' },
    donePartial: 'Deleted {count}.\nFailed to delete {failed}.',
    errorTitle: 'Delete Error',
  },

  loading: {
    editorTitle: 'Preparing the polygon editor',
    editorSub: 'This will just take a moment',
    previewGenerating: 'Generating preview...',
  },

  setup: {
    title: 'Split Settings',
    modeAuto: 'Auto split',
    modeManual: 'Adjust area',
    rows: 'Rows',
    columns: 'Columns',
    splitWithRows: 'Split with these rows',
    noSplit: "Don't split (cut out a single image)",
    splitsInto: { one: 'Splits into {count} piece', other: 'Splits into {count} pieces' },
    rowsDisabled: 'Rows cannot be set when splitting is off',
    columnsDisabled: 'Columns cannot be set when splitting is off',
    moveHLine: 'Move horizontal line',
    moveVLine: 'Move vertical line',
    addRect: 'Add rectangle',
    addRectHint: 'Tap on the character you want to enclose',
    tapToRemoveBg: 'Tap to erase',
    eyedropperHint: 'Erase background',
    manualDesc: 'Enclose the background-removed image with rectangles to cut out one character at a time.',
    noSplitButton: 'Cut out without splitting',
    toPolygonEditor: 'Go to polygon editing',
    rePickImage: 'Choose a different image',
    resetTitle: 'Reset Edits',
    resetMessage:
      'Undoes every eyedropper tap, returning to the automatically background-removed image.\nThis cannot be undone.',
  },

  result: {
    title: 'Split Result',
    manualSplit: 'Manual split',
    cutsLabel: { one: 'After cutting ({count} image)', other: 'After cutting ({count} images)' },
    longPressHint: 'Long-press to select and merge',
    selectedCount: { one: '{count} selected', other: '{count} selected' },
    mergeCount: { one: 'Merge {count} piece', other: 'Merge {count} pieces' },
    needTwo: 'Select at least two pieces',
    shareCount: { one: 'Share {count} piece', other: 'Share {count} pieces' },
    needAdjacent: 'Select two pieces that are directly adjacent',
    polygonCannotMerge: 'Cutouts edited with polygons cannot be merged',
    confirmTitle: 'Confirm',
    warningMessage: 'Some stickers may not have split correctly.\n\nAffected: #{targets}',
    resetMessage:
      'Restores the split result to its original state. All merges and cutout edits will be discarded.',
  },

  editor: {
    title: 'Adjust Area',
    modeMove: 'Move & adjust',
    modeMoveHint: 'Drag the rectangle or pinch a corner to fit the shape',
    modeAdd: 'Add rectangle',
    modeAddHint: 'Tap on the character you want to enclose',
    modeEyedropper: 'Eyedropper',
    modeEyedropperHint: 'Tap a color to make it transparent',
    modeRestore: 'Restore brush',
    modeRestoreHint: 'Paint over parts that were erased too much to bring them back',
    brushSize: 'Brush size',
    ghost: 'Original',
    uncoveredTitle: 'Some areas are not enclosed',
    uncoveredMessage: 'Areas that are not filled will not be saved. Continue anyway?',
    uncoveredBack: 'Go back and fix',
    uncoveredProceed: 'Continue anyway',
    resetTitle: 'Reset Edits',
    resetMessage:
      'Clears the polygons and undoes every eyedropper tap, returning to the automatically background-removed image.\nThis cannot be undone.',
    retransTitle: 'Removal strength',
    retransApply: 'Re-apply to this cutout',
    eyedropDone: '💧 Color removed',
    eyedropNothing: '💧 No color to remove here',
    eyedropBusy: 'Removing color...',
    undoBusy: 'Undoing the edit...',
    redoBusy: 'Reapplying the edit...',
    loadFailed: 'Failed to load the image',
  },

  preview: {
    title: 'Preview',
    backToEdit: 'Back to editing',
    saveCount: { one: 'Save ({count} image)', other: 'Save ({count} images)' },
    nothingToExport: 'There is nothing to export',
    saveErrorTitle: 'Save Error',
  },

  saveComplete: {
    title: 'Saved',
    savedCount: { one: 'Saved {count} image', other: 'Saved {count} images' },
    albumSuffix: 'Album "{album}"',
    another: 'Process another image',
    checkDestination: 'Check where it was saved',
    openLineMaker: 'Open LINE Sticker Maker',
  },

  saved: {
    titleCount: { one: 'Saved To  {count} image', other: 'Saved To  {count} images' },
    titleLoading: 'Saved To  …',
    empty: 'No exported images yet',
    emptyDescription: 'Images processed and saved with "{app}" appear here',
    dateFormat: '{m}/{d}/{y}',
  },

  settings: {
    title: 'Settings',
    sectionTransparency: 'Transparency',
    autoTolerance: 'Auto-removal strength',
    autoToleranceHint: 'Stronger removes colors further from the background. Raise it if background remains, lower it if artwork is eaten away.',
    eyedropperTolerance: 'Eyedropper strength',
    eyedropperToleranceHint: 'Stronger erases a wider range around the tapped color.',
    feather: 'Soften edges',
    featherHint: 'Makes the 1px border semi-transparent to prevent white fringing',
    fillTextHoles: 'Remove background inside letters',
    fillTextHolesHint: 'Also removes narrow enclosed background, such as the inside of "A" or "O". Thin artwork the same color as the background may disappear',
    sectionExport: 'Export',
    album: 'Destination album',
    autoDelete: 'Auto-delete work data after saving',
    autoDeleteHint: 'Deletes the cutouts and work data once the export finishes',
    showDestination: 'Show destination',
    columns: 'Columns',
    columnsValue: '{count} cols',
    thumbBg: 'Background color',
    splitLineColor: 'Split line color',
    boundaryColor: 'Boundary line color',
    language: 'Language',
    languageAuto: 'Match device',

    // ── Appearance (app icon / launch animation) ──
    sectionAppearance: 'Appearance',
    appIcon: 'App icon',
    appIconHint: 'The home screen icon changes with the time of day',
    splashAnimation: 'Launch animation',
    splashPattern: 'Pattern',
    splashPatternAuto: 'Match the time of day',
    splashAutoHint: "The bird's performance changes with the time of day",
    splashAnimationHint: 'How the bird appears on launch',
    optionAuto: 'Automatic (time of day)',
    optionOff: 'Off',
    iconDay: 'Day',
    iconNight: 'Night',
    iconSleep: 'Sleep',
    splashFly: 'Fly',
    splashPeel: 'Peel',
    splashCross: 'Cross',
    splashSleep: 'Sleep',
    splashShake: 'Shake',
    splashDrop: 'Drop (rare)',
    sectionAbout: 'About',
    version: 'Version',
    howTo: 'How to use',
    replayTutorial: 'Watch the tutorial again',
    deleteAllData: 'Delete all work data',
    deleteAllDataHint: 'Deletes all "Recent work" and source images (saved images are kept)',
    deleteAllDataMessage:
      'Deletes all "Recent work" along with the stored source images and thumbnails.\nWork currently being edited is included.\nThis cannot be undone.\n\nNote: images already saved to the "{album}" album are not deleted.',
  },

  howto: {
    title: 'How to Use',
    intro:
      'This app removes the background from an illustration sheet, cuts out each character, and saves them as transparent PNGs. Try the automatic mode first, then fix only the parts that need it by hand.',
    step1Title: 'STEP 1  Choose an image',
    step1Body:
      'Pick an illustration sheet from "Choose an Image" on the home screen.\nA single image with several characters laid out on it works best.',
    step1Note:
      'Supported formats: PNG, JPEG (JPG), HEIC\nNote: other image formats may not load correctly.',
    step2Title: 'STEP 2  Choose a split mode',
    step2Body:
      'Choose a mode on the setup screen.\n\n[Auto split] Check and adjust the number of rows, then tap "Split with these rows". Split lines appear in the preview.\n\n[Adjust area] Enclose each character directly with polygons. Use this when the automatic mode does not work well.',
    step2Note: 'Try the automatic mode first. It gets most sheets right.',
    step3Title: 'STEP 3  Review and adjust the result',
    step3Body:
      'Review the split result and fix any misalignment or merged pieces.\n\n• Pieces are merged → tap "Back", raise the split detail and split again\n• Want to combine with the next cutout → long-press the cutout to select it, then tap "Merge"\n• Want to fix just one → tap the cutout to edit it with polygons\n• Want to start the edits over → tap "Reset" to return to the first split result\n• Want to redo everything → tap "Manual split" for polygon mode',
    step3Note:
      'It does not have to be perfect — "Save" writes transparent PNGs to the "{album}" album.\nIf rows contain different numbers of characters (for example only the last row has more columns), auto split uses the same lines for every row, so some rows may come out misaligned. Fix just those cells with "Merge" or polygon editing.',
    complexTitle: 'How to split a complex image',
    complexDescription: 'Steps for separating merged characters',
    polygonTitle: 'How to adjust areas',
    polygonDescription: 'An animated walkthrough of enclosing with rectangles',
    tipsTitle: 'Tips for Clean Cutouts',
    tip1: 'Illustrations on a plain white or light gray background come out cleanest',
    tip2: 'Start split detail at "Medium"; move to "Fine" if pieces merge together',
    tip3: 'If the automatic mode never lines up, use "Manual split" and edit with polygons',
    noticeTitle: 'Please Note',
    notice1:
      'Saving requires "Full Access" to Photos. With "Selected Photos" the app cannot save to an album (Settings → Privacy & Security → Photos)',
    notice2: 'Output is transparent PNG only (JPEG cannot preserve transparency)',
    notice3: 'Do not close the app while background removal or splitting is running',
  },

  polygonTutorial: {
    title: 'Adjust Area',
    heading: 'Place a rectangle and fit the shape',
    subheading: 'Use this when the automatic mode does not work',
    step1: 'Tap the pen, then tap a character',
    step2: 'A rectangle appears',
    step3: 'Drag the white dots outward to enclose the character',
    step4: 'Tap an edge to add a point, long-press to remove one',
    step5: 'Tap "Preview" to cut out and check',
    dontShowAgain: "Don't show this again",
  },

  onboarding: {
    step1: {
      caption: 'Tap "Choose an Image"',
      bubble: 'Pick an image you want to make transparent!',
      tagline: 'Cut characters out of illustration sheets',
      lead: 'Just pick one image — the background goes automatically.',
      pick: 'Choose an Image',
      savePng: 'Save as transparent PNG',
      photoPickerTitle: 'Select Photo',
    },
    step2: {
      caption: '"Auto split" cuts it up for you',
      bubble: 'Set the rows and detail, then tap "Split"',
    },
    step3: {
      caption: 'Check the cutouts!',
      bubble: 'If they look good, tap "Save"',
    },
    step4: {
      caption: 'Done! Transparent PNGs are saved to your album',
    },
  },

  complexTutorial: {
    autoSplit: {
      caption: 'Auto split uses the same lines for every row',
      bubble: 'If you tap "Split" as-is...',
    },
    merge: {
      caption: 'The bottom two pieces split one character in half',
      bubble: 'Long-press to select, tap the other piece, then "Merge"',
      bubble2: 'Tap to edit just one piece',
    },
    finish: {
      caption: 'Move the corners to fit the shape',
      bubble: 'All that is left is "Save"',
      closing: 'Even complex sheets come out clean',
    },
    manualCrop: 'Manual crop',
  },

  ads: {
    label: 'Ad',
  },

  errors: {
    processTitle: 'Processing Error',
    resultTitle: 'Result',
    noForeground: 'No foreground was detected. Try again with a different number of rows.',
    exportTitle: 'Export Error',
    restoreTitle: 'Restore Error',
    sourceMissing: 'The source image could not be found. Please choose an image again.',
    decodeFailed: 'Failed to decode the image',
    pixelsFailed: 'Failed to read the pixel data',
    cropFailed: 'Failed to generate the cropped image',
  },

  saveError: {
    headline: 'Could not save to your photo album.',
    guide: 'Access to Photos may be restricted. Open {path} and choose {choice}.',
    pathIos: 'Settings → Privacy & Security → Photos → this app',
    pathAndroid: 'Settings → Apps → this app → Permissions → Photos and videos',
    choiceIos: '"All Photos"',
    choiceAndroid: '"Allow"',
    limitedNote: 'Note: with "Selected Photos" the app cannot save to an album.',
    detail: '(Details: {raw})',
  },
};

export default en;
