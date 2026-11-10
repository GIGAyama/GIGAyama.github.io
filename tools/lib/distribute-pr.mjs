/**
 * 正本の配布が作る PR の題・本文・枝の名前と、`gh pr create` への渡しかた。
 *
 * ── なぜ別のファイルなのか ────────────────────────────
 *
 * tools/distribute.mjs は読みこむと配布が始まるので、テストから import できない。
 * ここに置いたものだけが試験できる。
 *
 * ── 何を防ぐのか ──────────────────────────────────────
 *
 * 2026-11-10 まで、PR の本文は**シェルの二重引用符の中**に入れて渡していた。
 *
 *   run(`gh pr create … --body "${PR_BODY}" …`)
 *
 * 本文には `GIGAyama.github.io/standards/` と `auto-distribute` がバッククォートで
 * 書いてある。シェルはそれを**コマンドとして実行**し、失敗して空文字に置きかえる。
 * 43 本の配布 PR はどれも
 *
 *   -  の最新正本（SW・品質ゲート・スキル・ルール）と完全同期
 *   -  による自動配備
 *
 * と、肝心の 2 語が抜けた本文で作られていた（手元で同じコマンドを走らせて確かめた）。
 * エラーにはならない。`sh: auto-distribute: not found` がログに出るだけで、
 * PR は作られるので、配布は成功と数えられる。
 *
 * 引数は配列のまま execFile に渡す。シェルを通さなければ、何を書いても字のまま届く。
 */

export const BRANCH_NAME = 'chore/sync-standards';

/* ⚠️ この題を変えるときは tools/lib/gh.mjs の isDistributionCommit も一緒に見ること。
      あちらは題で「配布のコミットか」を見分け、アプリの更新日から除いている。
      食い違うと、配布のたびに 43 本ぜんぶの更新日が今日になる。
      食い違っていないことは distribute-pr.test.mjs が見ている。 */
export const PR_TITLE = 'chore(standards): Sync with latest standards';

export const PR_BODY = `### Summary
- \`GIGAyama.github.io/standards/\` の最新正本（SW・品質ゲート・スキル・ルール）と完全同期
- \`auto-distribute\` による自動配備`;

/** `gh` に渡す引数（配列のまま execFile に渡すこと。文字列につながない） */
export function prCreateArgs(owner, repo, base) {
  return [
    'pr', 'create',
    '--repo', `${owner}/${repo}`,
    '--title', PR_TITLE,
    '--body', PR_BODY,
    '--base', base,
  ];
}
