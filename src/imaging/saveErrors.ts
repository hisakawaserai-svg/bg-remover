/**
 * saveErrors.ts — 写真アルバムへの書き出し失敗を、日本語の対処案内に変換する。
 *
 * CameraRoll.saveAsset がアルバム指定で失敗すると
 * 「The operation couldn't be completed. (PHPhotosErrorDomain error 3311.)」
 * のような英語のまま出てしまい、ユーザーは原因に辿り着けない。
 *
 * 実際に踏んだ原因は「写真へのアクセスが『選択した写真のみ』になっていた」ケース。
 * iOS の初回ダイアログは「フルアクセスを許可」「写真を選択…」の3択で、
 * 後者を選ぶと Photos 側がカスタムアルバムへの追加を拒否する。
 * この状態が一番多い想定なので、まずそこを案内する。
 *
 * 保存経路（doAutoExport / PreviewScreen）で共通に使う。
 */
import { Platform } from 'react-native';

/** 写真ライブラリの権限まわりが原因と思われるエラーか。 */
function looksLikePhotoPermissionError(msg: string): boolean {
  // iOS: Photos framework のエラードメイン。番号は状況で変わるのでドメイン名で見る。
  // Android: 権限拒否時のメッセージに permission が含まれる。
  return /PHPhotosErrorDomain/i.test(msg)
      || /access|permission|denied|authoriz/i.test(msg);
}

/**
 * 例外から、ユーザーに出すメッセージを作る。
 * 権限が原因らしい場合だけ具体的な手順に差し替え、それ以外は元のメッセージを見せる
 * （見当違いの案内で本当の原因を隠さないため、元文言も併記する）。
 */
export function describeSaveError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');

  if (looksLikePhotoPermissionError(raw)) {
    const path = Platform.OS === 'ios'
      ? '設定 → プライバシーとセキュリティ → 写真 → このアプリ'
      : '設定 → アプリ → このアプリ → 権限 → 写真と動画';
    const choice = Platform.OS === 'ios' ? '「すべての写真」' : '「許可」';
    return [
      '写真アルバムに保存できませんでした。',
      '',
      `写真へのアクセスが制限されている可能性があります。${path} を開き、${choice} を選んでください。`,
      Platform.OS === 'ios'
        ? '※「選択した写真のみ」だと、アルバムへの保存ができません。'
        : '',
      '',
      `（詳細: ${raw}）`,
    ].filter(Boolean).join('\n');
  }

  return raw || '不明なエラー';
}
