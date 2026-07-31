/**
 * paths.ts — 保存済みファイルパスを現在のアプリ領域へ貼り直す。
 *
 * 【なぜ必要か】
 * iOS のアプリ領域（Data コンテナ）は
 *   /var/mobile/Containers/Data/Application/<UUID>/Documents
 * という形で、この <UUID> は**アプリを更新・再インストールするたびに変わる**。
 * Apple もコンテナのパスは永続だと仮定してはいけないとしている。
 *
 * このアプリは元画像やサムネの場所を絶対パス（file:// URI）のまま
 * AsyncStorage に保存していた。AsyncStorage 自体は「現在の」コンテナを
 * 経由して読まれるので設定やセッション一覧は生き残るが、その中に入っている
 * 絶対パスは古い UUID を指したままになる。結果として
 * 「設定は残っているのに Documents 内の画像だけ読めない」という症状になる。
 * （実機の更新後に発生。シミュレータでも再インストールで再現し、
 *   保存済みデータが3世代ぶんの旧 UUID を指していることを確認した）
 *
 * 【方針】
 * 保存形式は変えず、読み出し時に貼り直す。
 * 絶対パスのうち "/Documents/" 以降だけを意味のある部分とみなし、
 * 現在の DocumentDirectoryPath に繋ぎ直す。こうすると
 *   - 既存の保存データもそのまま救える（移行処理が要らない）
 *   - 次にコンテナが変わっても自動で追随する
 * 貼り直した値は、次にそのセッションが保存される時に永続化される。
 */
import RNFS from 'react-native-fs';

const DOCUMENTS = RNFS.DocumentDirectoryPath;
const MARKER = '/Documents/';

/**
 * 保存済みのパス/URI を現在のアプリ領域基準に直す。
 *
 * 触らないもの:
 *   - 空値
 *   - 相対パス（先頭が / でない）
 *   - "/Documents/" を含まないもの（Android の files 配下や content:// など）
 *   - 既に現在のコンテナを指しているもの
 */
export function rebaseToCurrentContainer(uri: string): string;
export function rebaseToCurrentContainer(uri: undefined): undefined;
export function rebaseToCurrentContainer(uri?: string): string | undefined;
export function rebaseToCurrentContainer(uri?: string): string | undefined {
  if (!uri) return uri;

  const hasScheme = uri.startsWith('file://');
  const path = hasScheme ? uri.slice('file://'.length) : uri;
  if (!path.startsWith('/')) return uri; // 相対パス・content:// 等は対象外

  // アプリの Documents は必ずパスの末尾側に来るので lastIndexOf で取る
  // （ユーザー名などに Documents が含まれる環境でも誤爆しない）。
  const at = path.lastIndexOf(MARKER);
  if (at < 0) return uri;

  const tail = path.slice(at + MARKER.length);
  const next = `${DOCUMENTS}/${tail}`;
  if (next === path) return uri; // 既に現行コンテナ

  return hasScheme ? `file://${next}` : next;
}
