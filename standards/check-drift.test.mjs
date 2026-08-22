/* =====================================================================
 * check-drift のテスト
 * =====================================================================
 * このツールの値打ちは「正本と揃っている」と言い切れることにある。
 * 揃っていないのに緑を返したら、そのあとの判断が全部その嘘の上に乗る。
 *
 * 実際に digitalcloset で起きていた: standards-map.json が無いだけで
 * 「このリポジトリは正本コピーを持ちません」と言って exit 0 を返していたが、
 * scripts/lib/giga-v5-checks.mjs（正本と同じ場所・同じ名前の 304 行の別物）を
 * 現に持っていた。ここではその見落としを固定する。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NORMALIZERS, canonicalIndex, findLookalikes, unregistered } from './check-drift.mjs';

/** メモリ上の疑似ファイル木から readdir / statSync を作る */
function fakeFs(tree) {
  const at = (p) => {
    const parts = p.split('/').filter(Boolean);
    let node = tree;
    for (const part of parts) node = node?.[part];
    return node;
  };
  return {
    // 実際の readdirSync は名前順に返す。並び順は結果を変える（同じ名前が
    // 複数あると先に見つけたほうを採るため）ので、ここでもそろえておく。
    readdir: (p) => Object.keys(at(p) || {}).sort(),
    stat: (p) => ({ isDirectory: () => typeof at(p) === 'object' }),
  };
}

const STANDARDS = {
  lib: { 'giga-v5-checks.mjs': '', 'giga-v5-checks.test.mjs': '', 'run-giga-checks.mjs': '' },
  gas: { 'Gemini.gs': '', 'gas-deploy.mjs': '', 'deploy.yml': '' },
  records: { 'records-export.js': '', 'records-export.html': '' },
  // docs には読み物のほかに例示の HTML が置かれることがある。
  // 拡張子だけでは外れないので、docs/ そのものを除外できているかを見る
  docs: { 'gas-type-e.md': '', 'app-hardening.md': '', 'records-export.html': '' },
  'README.md': '',
};

// ── 正本の索引 ──────────────────────────────────────────────

test('配るファイルだけを索引にする', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.get('giga-v5-checks.mjs'), 'lib/giga-v5-checks.mjs');
  assert.equal(index.get('Gemini.gs'), 'gas/Gemini.gs');
  assert.equal(index.get('records-export.html'), 'records/records-export.html');
});

test('README.md を索引に入れない（どのリポジトリにもあるので毎回引っかかる）', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  assert.equal(canonicalIndex('s', readdir, stat).has('README.md'), false);
});

test('docs/ は読み物なので配布物として数えない', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.has('gas-type-e.md'), false);
  assert.equal(index.has('app-hardening.md'), false);
});

test('docs/ の中の HTML も配布物として数えない（例示であって正本ではない）', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  // 同名の正本が records/ にある。docs/ 側に引っぱられていないこと
  assert.equal(index.get('records-export.html'), 'records/records-export.html');
});

test('テストファイルは配らないので手がかりにしない', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  assert.equal(canonicalIndex('s', readdir, stat).has('giga-v5-checks.test.mjs'), false);
});

// ── リポジトリ側の走査 ──────────────────────────────────────

test('正本と同じ名前のファイルを、階層の深さによらず見つける', () => {
  const { readdir, stat } = fakeFs({
    s: STANDARDS,
    repo: { scripts: { lib: { 'giga-v5-checks.mjs': '' } }, 'index.html': '' },
  });
  const index = canonicalIndex('s', readdir, stat);
  assert.deepEqual(findLookalikes('repo', index, readdir, stat), [
    { local: 'scripts/lib/giga-v5-checks.mjs', canonical: 'lib/giga-v5-checks.mjs' },
  ]);
});

test('node_modules と dist は見ない（コピーではなく取り寄せたもの・生成物）', () => {
  const { readdir, stat } = fakeFs({
    s: STANDARDS,
    repo: {
      node_modules: { x: { 'Gemini.gs': '' } },
      dist: { 'records-export.js': '' },
      '.git': { 'deploy.yml': '' },
    },
  });
  const index = canonicalIndex('s', readdir, stat);
  assert.deepEqual(findLookalikes('repo', index, readdir, stat), []);
});

// ── 未登録の判定 ────────────────────────────────────────────

const found = [
  { local: 'scripts/lib/giga-v5-checks.mjs', canonical: 'lib/giga-v5-checks.mjs' },
  { local: 'scripts/gas-deploy.mjs', canonical: 'gas/gas-deploy.mjs' },
];

test('対応表に載っていれば未登録ではない', () => {
  assert.deepEqual(unregistered(found, ['scripts/lib/giga-v5-checks.mjs'], []), [found[1]]);
});

test('unmanaged に理由つきで宣言してあれば未登録ではない', () => {
  assert.deepEqual(unregistered(found, [], ['scripts/lib/giga-v5-checks.mjs']), [found[1]]);
});

test('どちらにも無ければ未登録として報告する', () => {
  // これが digitalcloset で起きていたこと。以前は「持ちません」と言って緑だった
  assert.deepEqual(unregistered(found, [], []), found);
});

test('照合するものが無くても、別物として宣言していれば「コピーが無い」とは言わない', () => {
  // digitalcloset は 304 行のフォークを unmanaged に宣言している。
  // files が空だからといって「正本のコピーは見つかりませんでした」と言うと、
  // フォークを現に持っているという事実と食い違う。
  // （この判断は check-drift.mjs の main() 側にあるので、ここでは
  //   unregistered が空になること＝宣言が効くことを固定する）
  assert.deepEqual(unregistered(found, [], found.map((f) => f.local)), []);
});

test('全部宣言してあれば何も残らない', () => {
  assert.deepEqual(
    unregistered(found, ['scripts/gas-deploy.mjs'], ['scripts/lib/giga-v5-checks.mjs']),
    []
  );
});

/* ── normalize ────────────────────────────────────────────────────────
 * 「1行だけ変えてよい」を機械で言い切るための仕組み。ここが広すぎると
 * 正本を直しても届かなくなり、狭すぎると毎回ずれとして出る。
 * どちらも「ドリフト検知が通ったから揃っている」という判断を壊す。
 * ================================================================== */

const HTML = (name, src) => `<!DOCTYPE html>
<title>学習ログの受け渡し口｜${name}</title>
<p>このページは、${name}の学習記録を集計ページへ受け渡すためのものです。</p>
<p><a href="./">← ${name}に もどる</a></p>
<script type="module" src="${src}"></script>`;

test('app-name: アプリ名の違いだけなら同じものとして扱う', () => {
  const canonical = NORMALIZERS['app-name'](HTML('__APP_NAME__', './records-export.js'));
  const local = NORMALIZERS['app-name'](HTML('九九カード', './records-export.js'));
  assert.equal(local, canonical);
});

test('app-name: 名前の入る場所しか潰さない（文言を書き替えたらずれとして出る）', () => {
  const canonical = NORMALIZERS['app-name'](HTML('__APP_NAME__', './records-export.js'));
  // 「学習記録」を別の言い方に書き替えたコピー
  const reworded = NORMALIZERS['app-name'](
    HTML('九九カード', './records-export.js').replace('の学習記録を', 'のべんきょうのきろくを'));
  assert.notEqual(reworded, canonical);
});

test('records-export-import: <script src> の置き場の違いを許す', () => {
  const canonical = NORMALIZERS['records-export-import'](HTML('x', './records-export.js'));
  const local = NORMALIZERS['records-export-import'](HTML('x', './js/records-export.js'));
  assert.equal(local, canonical);
});

test('records-export-import: 別のファイルを読みこんでいたら、ずれとして出る', () => {
  const canonical = NORMALIZERS['records-export-import'](HTML('x', './records-export.js'));
  const other = NORMALIZERS['records-export-import'](HTML('x', './records-hub-client.js'));
  assert.notEqual(other, canonical);
});
