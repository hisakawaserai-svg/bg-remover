/**
 * consent.ts — UMP(GDPR同意) + ATT の取得フローと、その完了状態の共有
 *
 * ## フロー
 * gatherAdsConsentAndInit() が全部やる:
 *   1. AdsConsent.gatherConsent()
 *        UMP SDK が地域を判定し、必要な場合のみ同意フォームを表示する。
 *        日本など規制対象外の地域では何も出さずに即座に返る。
 *        iOS では AdMob 管理画面の「プライバシーとメッセージ」で IDFA 説明
 *        メッセージを有効にしておくと、この呼び出しの中で ATT ダイアログも
 *        適切な順序（説明 → OS ダイアログ）で表示される。
 *   2. 同意結果から requestNonPersonalizedAdsOnly (NPA) を決める
 *   3. mobileAds().initialize()（initAds）
 *   4. 完了状態を publish → AdBanner が広告リクエストを開始する
 *
 * ## 呼び出しタイミング
 * App.tsx から「設定ロード済み かつ hasSeenOnboarding」になった時点で呼ぶ。
 *   - 初回起動: オンボーディング「はじめる」でフラグが立った直後
 *   - 2回目以降: 起動して設定がロードされた直後
 * 起動直後（index.js）ではなくここまで遅らせるのは、ユーザーがアプリの
 * 目的を理解する前に ATT ダイアログを出すと拒否率が上がるため。
 * 2回目以降も毎回呼ぶのは、同意の期限切れ・地域変更に UMP が追従できる
 * ようにするため（同意済みならフォームは出ず即座に返る）。
 *
 * ## 状態の持ち方
 * 同意そのものの永続化は UMP SDK が端末内で行うので、アプリ側では
 * 「今回の起動でフローが完了したか」と「NPA にするか」だけを実行時状態
 * として持てばよい。利用者が AdBanner 1つだけなので、Settings/Stats の
 * ような Provider は作らず、モジュールレベルの小さなストア + フックにする
 * （React の外＝App.tsx のイベントからも直接呼べる利点もある）。
 */
import { useSyncExternalStore } from 'react';
import {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentStatus,
} from 'react-native-google-mobile-ads';
import { initAds } from './init';

export interface AdsConsentState {
  /**
   * 同意フロー（UMP + ATT + SDK 初期化）が完了したか。
   * false の間、AdBanner は広告をリクエストせず枠だけを描く。
   */
  ready: boolean;
  /**
   * 非パーソナライズ広告(NPA)のみをリクエストすべきか。
   * GDPR 対象地域で「パーソナライズ広告」への同意が得られなかった場合に true。
   * 対象外地域（日本など）は false のまま（iOS の IDFA 利用可否は ATT の
   * 結果を SDK が OS から直接読むので、アプリ側で切り替える必要はない）。
   */
  npa: boolean;
  /**
   * UMP の「プライバシー設定フォーム」（同意の撤回・変更）を提供する必要があるか。
   * GDPR 対象地域なら true。設定画面はこれが true の時だけ
   * 「広告のプライバシー設定」の行を出す（日本などでは押しても何も出ず
   * 混乱を招くだけなので行ごと隠す）。
   */
  privacyOptionsRequired: boolean;
}

let state: AdsConsentState = { ready: false, npa: false, privacyOptionsRequired: false };
const listeners = new Set<() => void>();

function publish(next: AdsConsentState) {
  state = next;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** AdBanner 用。同意フローの完了状態と NPA フラグを購読する。 */
export function useAdsConsent(): AdsConsentState {
  return useSyncExternalStore(subscribe, () => state);
}

/** 多重呼び出しガード。App.tsx の effect は依存の変化で複数回発火しうるため。 */
let started = false;

/**
 * 同意取得 → NPA 判定 → SDK 初期化 を一括で行う。冪等（2回目以降は何もしない）。
 *
 * 失敗しても広告を完全に止めない: gatherConsent はネットワーク不通などで
 * 落ちうるが、その場合も NPA=true の安全側に倒して初期化だけは行う
 * （UMP は同意を端末にキャッシュしているので、直近の同意状態は SDK 側で
 * 尊重される。ここで throw を外に漏らすとアプリ全体が広告なしで固まる
 * だけなので、init.ts と同じく例外は外に出さない）。
 */
export function gatherAdsConsentAndInit(): void {
  // ── デバッグログ（一時的・__DEV__ のみ）: ATT/UMP フローの動作確認用 ──
  if (__DEV__) {
    console.log(`[ads][debug] gatherAdsConsentAndInit called (already started: ${started})`);
  }
  if (started) return;
  started = true;
  const run = async () => {
    let npa = false;
    // gatherConsent 失敗時は false のまま = 行を出さない安全側に倒す
    // （フォームを出せるか不明な状態で導線だけ出しても行き止まりになるため）。
    let privacyOptionsRequired = false;
    try {
      const info = await AdsConsent.gatherConsent();
      privacyOptionsRequired =
        info.privacyOptionsRequirementStatus ===
        AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
      if (__DEV__) {
        // status: UNKNOWN/REQUIRED/NOT_REQUIRED/OBTAINED（GDPR同意の状態）。
        // 日本の実機なら NOT_REQUIRED になるのが正常。
        // isConsentFormAvailable が false の場合、AdMob 管理画面の
        // 「プライバシーとメッセージ」でメッセージが未設定/未公開の可能性。
        // ※ ATT の許可状態そのもの（OSレベル）はこのライブラリからは読めない。
        //    ATT ダイアログが出たかどうか＋設定アプリ＞プライバシー＞トラッキング
        //    で確認する。
        console.log('[ads][debug] gatherConsent result:', JSON.stringify(info));
      }
      // OBTAINED = GDPR フォームで同意を取った（or 過去に取ってある）地域。
      // その場合だけ TC 文字列から「パーソナライズ広告」の選択を読む。
      // NOT_REQUIRED（日本など）では TC 文字列が無く getUserChoices が
      // 意味を持たないので読まない。
      if (info.status === AdsConsentStatus.OBTAINED) {
        try {
          const choices = await AdsConsent.getUserChoices();
          npa = !choices.selectPersonalisedAds;
          if (__DEV__) {
            console.log(
              `[ads][debug] getUserChoices: selectPersonalisedAds=${choices.selectPersonalisedAds} -> npa=${npa}`,
            );
          }
        } catch (e) {
          console.warn('[ads] getUserChoices failed, falling back to NPA:', e);
          npa = true;
        }
      }
    } catch (e) {
      console.warn('[ads] gatherConsent failed, falling back to NPA:', e);
      npa = true;
    }
    // 同意フローが済んでから SDK を初期化する（Google 推奨の順序）。
    if (__DEV__) {
      console.log(`[ads][debug] consent flow done: ready=true npa=${npa} -> initializing SDK`);
    }
    initAds();
    publish({ ready: true, npa, privacyOptionsRequired });
  };
  // 例外は run 内で全て処理済みなので、ここで待たずに投げっぱなしにする。
  run();
}
