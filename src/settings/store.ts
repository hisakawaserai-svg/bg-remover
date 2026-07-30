/**
 * settings/store.ts — アプリ設定の永続化
 *
 * セッション store（src/session/store.ts）と同じ「単一キー JSON」方式。
 * 設定項目が増えたら AppSettings に追加して writeSettings を呼ぶだけでよい。
 *
 * 現在の設定項目:
 *   tolerance: flood-fill の許容色差（removeBackground に渡す値）
 *              デフォルト 30 / 範囲 0〜100
 *   eyedropperTolerance: スポイトの許容色差（removeColorAt に渡す値）
 *              デフォルト 30 / 範囲 0〜100
 *   splitTolerance: 「分割の細かさ」（列検出のしきい値に変換して使う値）
 *              デフォルト 30 / 範囲 0〜100
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_settings';

export type ThumbBg = 'white' | 'gray' | 'checker' | 'black';

export type SplitLineColor = '#007AFF' | '#FF9500' | '#FF3B30';

export interface AppSettings {
  tolerance: number;
  /**
   * スポイトの許容色差。tolerance とは別に持つ。
   * 四隅からの自動背景除去は上げすぎるとキャラ本体を食うので保守的な値が要るのに対し、
   * スポイトは狙って押す操作でアンチエイリアスやグラデを拾うため高めが欲しく、
   * 求める値の方向が逆になるため共有しない。
   */
  eyedropperTolerance: number;
  /**
   * 「分割の細かさ」スライダー専用の値。tolerance とは別に持つ。
   * eyedropperTolerance を分けているのと同じ理由で、tolerance が「色をどこまで
   * 背景とみなすか」なのに対し、こちらは「どれくらいの隙間を列の切れ目とみなすか」で
   * 対象そのものが別物のため。以前は tolerance を共有していたので、分割の細かさを
   * 動かすと以後に読み込む画像の背景除去の強さまで変わる副作用があった
   * （0付近にすると背景が抜けきらず 1×1 に潰れた）。
   */
  splitTolerance: number;
  /**
   * 輪郭のフェザリング。透過した領域の境界1pxを、背景の混ざり具合に応じて
   * 半透明にし、混入した背景色を差し引く。ONだと白フチが出にくくなる。
   * アンチエイリアスの無い絵では効果が薄いのでOFFにできるようにしてある。
   */
  featherEdges: boolean;
  gridColumns: 2 | 3 | 4;
  thumbBg: ThumbBg;
  splitLineColor: SplitLineColor;
  /** エクスポート完了後にセッション（画像ファイル含む）を自動削除するか */
  autoDeleteOnExport: boolean;
  /** 範囲を調整のチュートリアルをスキップするか */
  skipPolygonTutorial: boolean;
  /** 全体オンボーディングを表示済みか（false = 未表示 = 初回） */
  hasSeenOnboarding: boolean;
}

// 設定のデフォルト値（キーが無い or 未設定項目のフォールバック）。
// export することで Context や useState の初期値として直接使える。
// App.tsx 側にデフォルト値をコピーしなくてよくなり、追加時の変更箇所が1箇所に絞られる。
export const DEFAULTS: AppSettings = {
  tolerance:      30,
  eyedropperTolerance: 30,
  // tolerance の現行デフォルトと同じ値。分離しても既存ユーザーの体感が変わらないようにする。
  splitTolerance: 30,
  featherEdges:   true,
  gridColumns:    3,
  thumbBg:        'white',
  splitLineColor: '#007AFF',
  autoDeleteOnExport: true,
  skipPolygonTutorial: false,
  hasSeenOnboarding: false,
};

/** 設定を読み込む。失敗時はデフォルト値を返す（UI がクラッシュしないよう）。*/
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // 保存済み値とデフォルトをマージ: 未来に追加したキーも DEFAULTS で補完される
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch (e) {
    console.warn('[settings/store] loadSettings failed:', e);
    return { ...DEFAULTS };
  }
}

/** 設定を保存する。既存値との merge は呼び出し側で済ませてから渡す。*/
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[settings/store] saveSettings failed:', e);
  }
}
