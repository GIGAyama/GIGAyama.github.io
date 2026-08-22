/* =====================================================================
 * build-sw-static のテスト
 * =====================================================================
 * 配信物をコミットするアプリの版づけ。守っているのは
 * 「直した画面が端末に届くこと」で、版が中身に追随しなくなると
 * 古いシェルのキャッシュが掃除されず、以降の修正すべてが
 * 「直したはずなのに直らない」に見える。
 *
 * 純関数（shellFilesOf / versionOf）を直に確かめる。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellFilesOf, versionOf } from './build-sw-static.mjs';

const SW = (list, konst = 'PRECACHE_URLS') =>
  `const APP_VERSION = 'v0'; /* __APP_VERSION__ */\nconst ${konst} = [\n${
    list.map((x) => `  '${x}',`).join('\n')}\n];\n`;

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sw-static-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

// ── 先読み一覧の読み取り ────────────────────────────────────

test("'./' はディレクトリそのもの。実体は index.html", () => {
  const got = shellFilesOf(SW(['./', './app.js']), '.', 'PRECACHE_URLS');
  assert.deepEqual(got.map((x) => x.file), ['index.html', 'app.js']);
});

test("'/' も同じくディレクトリそのもの（独自ドメイン直下に置くリポジトリの書き方）", () => {
  // ポータルの sw.js がこの形。取りこぼすと readFileSync が
  // ディレクトリを読もうとして EISDIR で落ちる
  const got = shellFilesOf(SW(['/', '/index.html', '/assets/app.js'], 'SHELL_FILES'), '.', 'SHELL_FILES');
  assert.deepEqual(got.map((x) => x.file), ['index.html', 'index.html', 'assets/app.js']);
});

test('下の階層のディレクトリ指定も index.html に解く', () => {
  // gamification の SHELL_ASSETS が './manabi-portal/' を持っている。
  // 末尾の '/' を取りこぼすと readFileSync がディレクトリを読んで EISDIR で落ちる
  const got = shellFilesOf(SW(['./', './manabi-portal/', './records-hub.html']), '.', 'PRECACHE_URLS');
  assert.deepEqual(got.map((x) => x.file),
    ['index.html', 'manabi-portal/index.html', 'records-hub.html']);
});

test('baseDir の下に置いているリポジトリでも解ける', () => {
  const got = shellFilesOf(SW(['./', './offline.html']), 'docs', 'PRECACHE_URLS');
  assert.deepEqual(got.map((x) => x.file), ['docs/index.html', 'docs/offline.html']);
});

test('コメントの中の文字列を先読み対象と読み違えない', () => {
  const src = `const PRECACHE_URLS = [\n  './a.js',\n  // './b.js' は入れない\n  /* './c.js' も */\n];`;
  assert.deepEqual(shellFilesOf(src, '.', 'PRECACHE_URLS').map((x) => x.entry), ['./a.js']);
});

test('スプレッド（ビルド注入型）は、別の道具を使うよう言って断る', () => {
  const src = "const PRECACHE_URLS = [\n  ...self.__WB_MANIFEST,\n];";
  assert.throws(() => shellFilesOf(src, '.', 'PRECACHE_URLS'), /build-sw-vite/);
});

test('一覧そのものが無ければ、形を示して断る', () => {
  assert.throws(() => shellFilesOf('const X = 1;', '.', 'PRECACHE_URLS'), /PRECACHE_URLS/);
});

// ── 版の決まりかた ──────────────────────────────────────────

test('中身が1バイト変われば版も変わり、戻せば版も戻る', () => {
  const a = tree({ 'index.html': 'あ', 'app.js': 'x' });
  const files = (d) => [
    { entry: './', file: path.join(d, 'index.html') },
    { entry: './app.js', file: path.join(d, 'app.js') },
  ];
  const before = versionOf(files(a));

  const b = tree({ 'index.html': 'い', 'app.js': 'x' });
  assert.notEqual(versionOf(files(b)), before);

  const c = tree({ 'index.html': 'あ', 'app.js': 'x' });
  assert.equal(versionOf(files(c)), before);
});

test('中身が同じでも、一覧での名前が違えば別の版になる', () => {
  // 名前を混ぜないと、ファイルを入れ替えただけの変更を見のがす
  const d = tree({ 'a.js': 'おなじ', 'b.js': 'おなじ' });
  const one = versionOf([{ entry: './a.js', file: path.join(d, 'a.js') }]);
  const two = versionOf([{ entry: './b.js', file: path.join(d, 'b.js') }]);
  assert.notEqual(one, two);
});
