/**
 * review/index.ts — アプリ内レビュー（App Store / Google Play）の要求
 *
 * 方針（両ストアのガイドライン準拠）:
 *   - ボタン等の明示操作からは requestReview を呼ばない。保存が成功した直後に
 *     「累計書き出し回数が閾値に達したときだけ」呼ぶ（maybeRequestReview）。
 *   - 実際にダイアログが出たか・頻度は OS 側が完全に制御するため、こちらでは
 *     「出たか」を判定できない。二重要求を避けるため、最後に要求した回数と日時を
 *     AsyncStorage に控えて軽くゲートするだけに留める。
 *   - 設定画面の「アプリを評価する」導線は、ガイドライン上 requestReview を直接
 *     呼べないので openStoreReviewPage（ストアページを外部で開く）を使う。
 *
 * ネイティブモジュール（iOS: ios/ReviewManager.swift, Android: ReviewModule.kt）が
 * 無い環境では静かに no-op する（レビュー要求は「おまけ」なので失敗を表に出さない）。
 */
import { Linking, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** iOS App Store のアプリ ID（README のストアリンクより）。 */
const IOS_APP_ID = '6798574833';
/** Android のパッケージ名（applicationId）。 */
const ANDROID_PACKAGE = 'com.seraapps.stampnuki';

interface ReviewManagerModule {
  requestReview: () => Promise<boolean>;
}

/**
 * New Architecture（bridgeless）では NativeModules 経由で取れないことがあるため、
 * i18n/index.ts と同じく TurboModuleRegistry.get を先に試してフォールバックする。
 */
function getNativeReviewManager(): ReviewManagerModule | undefined {
  try {
    // TurboModuleRegistry.get の型引数は TurboModule 前提だが、これはレガシー
    // native module（interop layer 経由）なので unknown 経由でキャストする。
    const mod = TurboModuleRegistry.get('ReviewManager') as ReviewManagerModule | null;
    if (mod) return mod;
  } catch {
    // 次の経路へ。
  }
  return (NativeModules as { ReviewManager?: ReviewManagerModule }).ReviewManager;
}

// ── トリガー判定 ─────────────────────────────────────────────────────────────

const GATE_STORAGE_KEY = 'review_prompt_gate';
/** 同じ人に何度も出さないための最小間隔（日）。OS 側の制限に加えた保険。 */
const MIN_INTERVAL_DAYS = 60;

interface ReviewGate {
  /** 最後にレビューを要求した時点の exportsCompleted 値。 */
  lastPromptedCount: number;
  /** 最後に要求した時刻（epoch ms）。 */
  lastPromptedAt: number;
}

/**
 * 累計書き出し回数 `exportsCompleted` が「レビューを促す節目」かどうか。
 * 3回目・10回目、その後は 50 回ごと（60, 110, ...）。
 */
function isMilestone(exportsCompleted: number): boolean {
  if (exportsCompleted === 3 || exportsCompleted === 10) return true;
  return exportsCompleted > 10 && (exportsCompleted - 10) % 50 === 0;
}

/**
 * 保存成功直後に呼ぶ。閾値に達していれば OS のレビュー要求を出す。
 * 引数は「加算後」の exportsCompleted 値（recordExportCompleted の戻り値）。
 *
 * 例外は投げない。判定に使うだけの軽い gate（回数・日時）で二重要求を防ぐ。
 */
export async function maybeRequestReview(exportsCompleted: number): Promise<void> {
  try {
    if (!isMilestone(exportsCompleted)) return;

    const gate = await loadGate();
    // 同じ節目で二度出さない（同一 count での重複呼び出しガード）。
    if (gate.lastPromptedCount === exportsCompleted) return;
    // 前回要求から MIN_INTERVAL_DAYS 未満なら見送る。
    const elapsedDays = (Date.now() - gate.lastPromptedAt) / (1000 * 60 * 60 * 24);
    if (gate.lastPromptedAt > 0 && elapsedDays < MIN_INTERVAL_DAYS) return;

    const native = getNativeReviewManager();
    if (!native) {
      if (__DEV__) {
        console.warn('[review] ReviewManager ネイティブモジュールが見つかりません。');
      }
      return;
    }

    await native.requestReview();
    // 「要求した」ことだけ記録（実際に出たかは OS 依存で不明）。
    await saveGate({ lastPromptedCount: exportsCompleted, lastPromptedAt: Date.now() });
  } catch (e) {
    if (__DEV__) {
      console.warn('[review] maybeRequestReview failed:', e);
    }
  }
}

// ── 開発用（__DEV__ のみ想定） ───────────────────────────────────────────────

/**
 * 閾値・60日間隔・回数ガードをすべて無視して、ネイティブのレビュー要求を即座に出す。
 * 動作確認専用。iOS 開発ビルドなら毎回ダイアログが出る（本番の頻度制限とは別物）。
 * 戻り値は「ネイティブに要求まで到達したか」。false なら native モジュール未検出等。
 */
export async function devForceRequestReview(): Promise<boolean> {
  try {
    const native = getNativeReviewManager();
    if (!native) {
      if (__DEV__) {
        console.warn('[review] ReviewManager ネイティブモジュールが見つかりません。');
      }
      return false;
    }
    await native.requestReview();
    return true;
  } catch (e) {
    if (__DEV__) {
      console.warn('[review] devForceRequestReview failed:', e);
    }
    return false;
  }
}

/** 二重要求ガードをリセットする。次回以降 maybeRequestReview を閾値どおり試せる。 */
export async function devResetReviewGate(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GATE_STORAGE_KEY);
  } catch {
    // 失敗しても致命ではない。
  }
}

async function loadGate(): Promise<ReviewGate> {
  try {
    const raw = await AsyncStorage.getItem(GATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReviewGate>;
      return {
        lastPromptedCount: parsed.lastPromptedCount ?? 0,
        lastPromptedAt: parsed.lastPromptedAt ?? 0,
      };
    }
  } catch {
    // 壊れていれば初期値。
  }
  return { lastPromptedCount: 0, lastPromptedAt: 0 };
}

async function saveGate(gate: ReviewGate): Promise<void> {
  try {
    await AsyncStorage.setItem(GATE_STORAGE_KEY, JSON.stringify(gate));
  } catch {
    // 保存に失敗しても致命ではない。
  }
}

// ── 設定画面用: ストアページを外部で開く ─────────────────────────────────────

/**
 * ストアのレビュー導線を外部で開く（設定画面の「アプリを評価する」から呼ぶ）。
 * ガイドライン上、ボタンから requestReview は呼べないため、こちらはストアページ
 * 遷移で代替する。iOS はレビュー投稿画面、Android は Play のアプリページを開く。
 */
export async function openStoreReviewPage(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      const url = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}?action=write-review`;
      const httpsFallback = `https://apps.apple.com/app/id${IOS_APP_ID}?action=write-review`;
      await openWithFallback(url, httpsFallback);
    } else {
      const url = `market://details?id=${ANDROID_PACKAGE}`;
      const httpsFallback = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
      await openWithFallback(url, httpsFallback);
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[review] openStoreReviewPage failed:', e);
    }
  }
}

/** スキーム URL を試し、開けなければ https にフォールバックする。 */
async function openWithFallback(primary: string, fallback: string): Promise<void> {
  const canOpen = await Linking.canOpenURL(primary).catch(() => false);
  await Linking.openURL(canOpen ? primary : fallback);
}
