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
import { deletions, fileStem, deploymentIds } from './gas-deploy.mjs';

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
