/* =====================================================================
 * gas-deploy のテスト
 * =====================================================================
 * このスクリプトの危ないところは push です。clasp push --force は GAS 側を
 * 丸ごと置き換えるので、送るファイルの数え方を1つ間違えると、学校が使って
 * いる最中のアプリからファイルが消えます。戻せません。
 *
 * clasp を動かす部分は実際の通信なのでテストできませんが、
 * 「何を消すことになるか」の判断は純粋な計算なので、ここで固めます。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletions, fileStem, deploymentIds, filesToPush, claspIgnoreRule } from './gas-deploy.mjs';

// ── 消えるファイルの判定 ────────────────────────────────────

test('リポジトリに揃っていれば、消えるものは無い', () => {
  const inGas = ['code.gs', 'index.html', 'appsscript.json'];
  const inRepo = ['code.gs', 'index.html', 'appsscript.json'];
  assert.deepEqual(deletions(inGas, inRepo), []);
});

test('GASにしか無いファイルは「消える」と数える', () => {
  const inGas = ['code.gs', 'index.html', 'Hotfix.gs'];
  const inRepo = ['code.gs', 'index.html'];
  assert.deepEqual(deletions(inGas, inRepo), ['Hotfix.gs']);
});

test('clasp pull が .js で書き出しても、リポジトリの .gs と同じものとみなす', () => {
  // GAS のサーバ側コードは、設定によって .js でも .gs でも書き出される。
  // 拡張子の違いだけで「消える」と誤って騒ぐと、毎回止まって使い物にならない。
  assert.deepEqual(deletions(['Code.js'], ['Code.gs']), []);
});

test('リポジトリにだけあるファイル（新規追加）は、消えるものとして数えない', () => {
  assert.deepEqual(deletions(['code.gs'], ['code.gs', 'Gemini.gs']), []);
});

test('大文字小文字の違うファイル名は別物として扱う（GAS も別物として扱う）', () => {
  assert.deepEqual(deletions(['App.html'], ['app.html']), ['App.html']);
});

test('消えるものが複数あれば、すべて挙げる', () => {
  const gone = deletions(['a.gs', 'b.gs', 'c.html'], ['a.gs']);
  assert.deepEqual(gone, ['b.gs', 'c.html']);
});

// ── ファイル名の見出し ──────────────────────────────────────

test('拡張子だけを落とす', () => {
  assert.equal(fileStem('code.gs'), 'code');
  assert.equal(fileStem('index.html'), 'index');
  assert.equal(fileStem('appsscript.json'), 'appsscript');
});

test('名前の途中にある拡張子らしき文字は落とさない', () => {
  assert.equal(fileStem('App_Js_01_Core.html'), 'App_Js_01_Core');
});

// ── デプロイIDの読み取り ────────────────────────────────────

test('1つだけのときは、そのまま1つ', () => {
  assert.deepEqual(deploymentIds({ GAS_DEPLOYMENT_ID: 'AKfyc1' }), ['AKfyc1']);
});

test('教師用と児童用のように2つあるときは、両方を順に更新する', () => {
  assert.deepEqual(
    deploymentIds({ GAS_DEPLOYMENT_IDS: 'AKfyc1,AKfyc2' }),
    ['AKfyc1', 'AKfyc2']
  );
});

test('カンマのまわりの空白は落とす（画面から貼ると混ざりやすい）', () => {
  assert.deepEqual(
    deploymentIds({ GAS_DEPLOYMENT_IDS: ' AKfyc1 , AKfyc2 ' }),
    ['AKfyc1', 'AKfyc2']
  );
});

test('同じIDを2度書いても、更新は1度だけ', () => {
  assert.deepEqual(deploymentIds({ GAS_DEPLOYMENT_IDS: 'AKfyc1,AKfyc1' }), ['AKfyc1']);
});

test('複数の指定があるときは、そちらを使う', () => {
  assert.deepEqual(
    deploymentIds({ GAS_DEPLOYMENT_IDS: 'AKfyc1,AKfyc2', GAS_DEPLOYMENT_ID: 'AKfyc9' }),
    ['AKfyc1', 'AKfyc2']
  );
});

test('どちらも無ければ空（呼び出し側が止める）', () => {
  assert.deepEqual(deploymentIds({}), []);
  assert.deepEqual(deploymentIds({ GAS_DEPLOYMENT_ID: '   ' }), []);
});

/* ------------------------------------------------------------------ */
/* .claspignore を見ずに「消えるファイル」を数えていた穴（2026-08-23）  */
/*                                                                     */
/* haiku-meeting のリポジトリには index.html があるが、それはサイトの   */
/* トップで、.claspignore で外してある。それでも名前が同じというだけで  */
/* 「安全」と数えられ、本番の index.html が警告なしに消えるところだった。*/
/* ------------------------------------------------------------------ */

const HAIKU_CLASPIGNORE = [
  '# コメント行は無視する',
  '**/**',
  '!appsscript.json',
  '!*.gs',
  '!app.html',
  '!css.html',
  '!app-shell.html',
  '!vendor.html',
].join('\n');

const REPO_FILES = [
  'appsscript.json', 'code.gs', 'app-shell.html', 'app.html', 'css.html', 'vendor.html',
  'index.html', 'privacy.html', 'terms.html', 'package.json', 'quality.config.json',
];

test('.claspignore で外したファイルは「送るもの」に数えない', () => {
  assert.deepEqual(
    filesToPush(REPO_FILES, HAIKU_CLASPIGNORE).sort(),
    ['app-shell.html', 'app.html', 'appsscript.json', 'code.gs', 'css.html', 'vendor.html']
  );
});

test('外したファイルと同じ名前のものが GAS にあれば、消えると分かる', () => {
  // これがこの修正の要。以前は index.html を「リポジトリにある」と数えたため、
  // 本番の index.html が消えることに気づけなかった。
  const inRepo = filesToPush(REPO_FILES, HAIKU_CLASPIGNORE);
  assert.deepEqual(deletions(['index.html', 'code.gs'], inRepo), ['index.html']);
});

test('.claspignore が無いときは、絞り込まない（clasp の既定に任せる）', () => {
  assert.deepEqual(filesToPush(REPO_FILES, null), REPO_FILES);
});

test('空の .claspignore でも、絞り込まない', () => {
  assert.deepEqual(filesToPush(REPO_FILES, '\n#だけ\n'), REPO_FILES);
});

test('あとに書いた規則が勝つ（gitignore と同じ）', () => {
  assert.deepEqual(filesToPush(['a.gs', 'b.gs'], '*.gs\n!b.gs'), ['b.gs']);
  assert.deepEqual(filesToPush(['a.gs', 'b.gs'], '!b.gs\n*.gs'), []);
});

test('** は区切りをまたぐが、* はまたがない', () => {
  assert.deepEqual(filesToPush(['dist/a.gs', 'a.gs'], 'dist/**'), ['a.gs']);
  assert.deepEqual(filesToPush(['dist/a.gs', 'a.gs'], '*.gs'), ['dist/a.gs']);
});

test('node_modules のような入れ子も外せる', () => {
  const files = ['code.gs', 'node_modules/x/y.js', 'node_modules/x/z.json'];
  assert.deepEqual(filesToPush(files, 'node_modules/**'), ['code.gs']);
});

test('知らない書き方は、分かったふりをせず例外にする', () => {
  // 素通りさせると「送らないのに安全と数える」穴が別の形で開く。
  assert.throws(() => claspIgnoreRule('src/[ab].gs'), /読み取れません/);
  assert.throws(() => claspIgnoreRule('a?.gs'), /読み取れません/);
});

test('点を含む名前を、正規表現の「任意の1文字」として扱わない', () => {
  assert.deepEqual(filesToPush(['axhtml', 'a.html'], '!a.html\n**/**'), []);
  assert.deepEqual(filesToPush(['axhtml', 'a.html'], '**/**\n!a.html'), ['a.html']);
});

test('GAS_ROOT_DIR で下げていても、規則は送るファイルの相対パスに当てる', () => {
  // .claspignore はリポジトリ直下にあり、送るファイルの一覧は GAS_ROOT_DIR の
  // 下から取る。規則はその相対パスに当たる（clasp の見方に合わせる）。
  const files = ['Gemini.gs', 'index.html', 'README.md'];
  assert.deepEqual(
    filesToPush(files, '**/**\n!appsscript.json\n!*.gs\n!index.html'),
    ['Gemini.gs', 'index.html']
  );
});
