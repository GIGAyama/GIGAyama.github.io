/* =====================================================================
 * check-secrets のテスト
 * =====================================================================
 * この道具の値打ちは「秘密は入っていない」と言い切れることにある。
 * 入っているのに緑を返したら、公開リポジトリに鍵が載ったまま
 * 「確かめた」ことになってしまう。
 *
 * 実際 2026-08-22 に、5本のリポジトリが出荷ディレクトリすべてに
 * Google API キーと同じ形の文字列を置いても緑を返していた。
 * ここではその見落としを固定する。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, allowWithoutReason, filesToScan, findSecrets, isAllowed, lineNumberAt,
} from './check-secrets.mjs';

// ⚠️ つなげて書かない。'AIza' + 'ZZZ…' と書くと正規表現に当たらず、
//    「検査が見落とした」というまちがった結論に着く（実際にやった）。
const GOOGLE_KEY = 'AIzaZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

test('Google API キーの形を見つける', () => {
  const hits = findSecrets(`const k = '${GOOGLE_KEY}';`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'GOOGLE_API_KEY');
});

test('秘密鍵そのものを見つける', () => {
  const hits = findSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'PRIVATE_KEY');
});

test('GitHub のトークンを見つける', () => {
  const hits = findSecrets("token: 'ghp_0123456789abcdefghijklmnopqrstuv'");
  assert.equal(hits.map((h) => h.id).join(), 'GITHUB_TOKEN');
});

test('ふつうのコードを秘密と言わない', () => {
  const ordinary = [
    "const url = 'https://example.com/a/b/c';",
    'const sk = skipWaiting;',
    "import { AIzawa } from './names.js';",
    'const id = "abcdefghijklmnopqrstuvwxyz0123456789";',
  ].join('\n');
  assert.deepEqual(findSecrets(ordinary), []);
});

test('何行目かを言う（人が開いて直せるように）', () => {
  const src = `line1\nline2\nconst k = '${GOOGLE_KEY}';`;
  assert.equal(findSecrets(src)[0].line, 3);
  assert.equal(lineNumberAt('a\nb\nc', 4), 3);
});

test('同じファイルに2つあれば2つとも言う', () => {
  const src = `const a = '${GOOGLE_KEY}';\nconst b = '${GOOGLE_KEY}';`;
  assert.equal(findSecrets(src).length, 2);
});

/* ── allow（逃げ道）────────────────────────────────────────────── */

test('理由つきの allow は通す', () => {
  assert.equal(isAllowed('docs/example.md', [{ file: 'docs/example.md', reason: '手順書の見本' }]), true);
});

test('理由の無い allow は効かない', () => {
  assert.equal(isAllowed('a.js', [{ file: 'a.js' }]), false);
  assert.equal(isAllowed('a.js', [{ file: 'a.js', reason: '   ' }]), false);
});

test('理由の無い allow は、それ自体を失敗として報告する', () => {
  // 黙って無視すると「書いたのに効いていない」ことに気づけない
  assert.deepEqual(allowWithoutReason([{ file: 'a.js' }, { file: 'b.js', reason: 'x' }]), ['a.js']);
});

/* ── 走査する場所 ──────────────────────────────────────────────── */

const fakeFs = (tree) => {
  const at = (p) => {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = tree;
    for (const part of parts) node = node?.[part];
    return node;
  };
  return {
    exists: (p) => at(p) !== undefined,
    stat: (p) => ({ isDirectory: () => typeof at(p) === 'object' }),
    // 実際の readdirSync は名前順に返す
    readdir: (p) => Object.keys(at(p) || {}).sort(),
  };
};

const TREE = {
  src: { 'app.js': '', 'style.css': '', sub: { 'deep.js': '' }, 'logo.png': '' },
  public: { 'sw.js': '' },
  node_modules: { 'huge.js': '' },
  dist: { 'bundle.js': '' },
  'index.html': '',
};

test('下の階層まで見る', () => {
  const f = fakeFs(TREE);
  const got = filesToScan('', { scan: ['src'], ignore: [], allow: [] }, f.exists, f.stat, f.readdir);
  assert.deepEqual(got, ['src/app.js', 'src/style.css', 'src/sub/deep.js']);
});

test('画像は中身を見ない（秘密を書けない）', () => {
  const f = fakeFs(TREE);
  const got = filesToScan('', { scan: ['src'], ignore: [], allow: [] }, f.exists, f.stat, f.readdir);
  assert.equal(got.includes('src/logo.png'), false);
});

test('node_modules と dist は見ない（取り寄せたもの・生成物）', () => {
  const f = fakeFs(TREE);
  const got = filesToScan('', {
    scan: ['src', 'node_modules', 'dist'], ignore: ['node_modules', 'dist'], allow: [],
  }, f.exists, f.stat, f.readdir);
  assert.equal(got.some((p) => p.startsWith('node_modules') || p.startsWith('dist')), false);
});

test('ファイルを直に指しても見る', () => {
  const f = fakeFs(TREE);
  const got = filesToScan('', { scan: ['index.html'], ignore: [], allow: [] }, f.exists, f.stat, f.readdir);
  assert.deepEqual(got, ['index.html']);
});

test('無い場所を指されても落ちない（アプリごとに構成が違う）', () => {
  const f = fakeFs(TREE);
  const got = filesToScan('', { scan: ['js', 'src'], ignore: [], allow: [] }, f.exists, f.stat, f.readdir);
  assert.equal(got[0], 'src/app.js');
});

test('形の一覧は空でない（消したら何も見なくなる）', () => {
  assert.ok(PATTERNS.length >= 4);
});
