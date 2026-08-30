/* =====================================================================
 * build-sw-vite のテスト（実際に動かして確かめる）
 * =====================================================================
 * この仕組みが守っているのは「直した画面が児童の端末に届くこと」。
 * 版が中身に追随しなくなると、古いシェルのキャッシュが掃除されず、
 * 以降の修正すべてが「直したはずなのに直らない」に見える。
 * 2026-08-21 に12リポジトリで同時に上げ忘れる事故が起きた形。
 *
 * スクリプトは実行時に読み込まれる素の .mjs なので、
 * 本物の dist/ をこしらえて子プロセスで走らせる。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-sw-vite.mjs');

/** 疑似の dist/ を持つ作業場を作る */
function makeRepo({ sw, files = {}, config = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sw-'));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'sw.js'), sw);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, 'dist', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  if (config) fs.writeFileSync(path.join(dir, 'sw-build.config.json'), JSON.stringify(config));
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [BUILDER, ...args], { cwd: dir, encoding: 'utf8' });
const swOf = (dir) => fs.readFileSync(path.join(dir, 'dist', 'sw.js'), 'utf8');
const versionOf = (dir) => (swOf(dir).match(/v[0-9a-f]{12}/) || [])[0] || null;

const PLUGIN_CONFIG = { precacheManagedByPlugin: true };
// vite-plugin-pwa が出す形。minify されていて変数名は潰れ、コメントも消えている。
// 目印が文字列の中にあるのはそのため（圧縮しても文字列の中身は残る）
const MINIFIED_SW = 'const n="square100-",i="__APP_VERSION__",r=n+"static-"+i;self.addEventListener("install",()=>{});';

test('先読みをプラグインに任せる形でも、版が刻まれる', () => {
  const dir = makeRepo({ sw: MINIFIED_SW, files: { 'index.html': '<p>あ</p>' }, config: PLUGIN_CONFIG });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(swOf(dir), /v[0-9a-f]{12}/);
  assert.ok(!swOf(dir).includes('__APP_VERSION__'), '目印が残ったまま配られようとしている');
});

test('配信物を1バイト変えると版が変わり、戻すと版も戻る', () => {
  const files = { 'index.html': '<p>あ</p>', 'assets/app.js': 'console.log(1)' };
  const a = makeRepo({ sw: MINIFIED_SW, files, config: PLUGIN_CONFIG });
  run(a);
  const before = versionOf(a);

  const b = makeRepo({ sw: MINIFIED_SW, files: { ...files, 'index.html': '<p>い</p>' }, config: PLUGIN_CONFIG });
  run(b);
  assert.notEqual(versionOf(b), before, '中身を変えたのに版が変わっていない');

  const c = makeRepo({ sw: MINIFIED_SW, files, config: PLUGIN_CONFIG });
  run(c);
  assert.equal(versionOf(c), before, '戻したのに版が戻っていない');
});

test('先読みに入っていないものが変わっても版は変わる', () => {
  // 100マス計算は TensorFlow.js を先読みから外している。外してあるものが
  // 変わったときに版が据え置きだと、古い塊が実行時キャッシュに残り続ける
  const base = { 'index.html': '<p>あ</p>', 'assets/tfjs-abc.js': 'OLD' };
  const a = makeRepo({ sw: MINIFIED_SW, files: base, config: PLUGIN_CONFIG });
  run(a);
  const b = makeRepo({ sw: MINIFIED_SW, files: { ...base, 'assets/tfjs-abc.js': 'NEW' }, config: PLUGIN_CONFIG });
  run(b);
  assert.notEqual(versionOf(b), versionOf(a));
});

test('中身が同じでもファイル名が違えば別の版になる', () => {
  // Vite は中身が変わるとファイル名のハッシュも変える（index-ti_VyL6O.js）。
  // 名前を混ぜずに中身だけをつないで数えると、2つのファイルが中身を
  // 入れ替えただけのときや、名前だけ変わったときを見のがす。
  const a = makeRepo({
    sw: MINIFIED_SW,
    files: { 'assets/index-AAAAAAAA.js': 'おなじ中身' },
    config: PLUGIN_CONFIG,
  });
  run(a);
  const b = makeRepo({
    sw: MINIFIED_SW,
    files: { 'assets/index-BBBBBBBB.js': 'おなじ中身' },   // 名前だけ違う
    config: PLUGIN_CONFIG,
  });
  run(b);
  assert.notEqual(versionOf(b), versionOf(a), 'ファイル名を版に混ぜていない');
});

test('ソースマップは版に混ぜない（中身に関係なく変わってしまうため）', () => {
  const base = { 'index.html': '<p>あ</p>' };
  const a = makeRepo({ sw: MINIFIED_SW, files: base, config: PLUGIN_CONFIG });
  run(a);
  const b = makeRepo({ sw: MINIFIED_SW, files: { ...base, 'assets/app.js.map': '{}' }, config: PLUGIN_CONFIG });
  run(b);
  assert.equal(versionOf(b), versionOf(a));
});

test('目印が無ければ落ちる（据え置きの版で配らせない）', () => {
  const dir = makeRepo({
    sw: 'const n="square100-",i="v1.7.1";',       // 手書きに戻してしまった形
    files: { 'index.html': '<p>あ</p>' },
    config: PLUGIN_CONFIG,
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /__APP_VERSION__ が 0 個/);
});

test('目印が2つ以上あっても落ちる（どれを版にするか決められない）', () => {
  const dir = makeRepo({
    sw: 'const a="__APP_VERSION__",b="__APP_VERSION__";',
    files: { 'index.html': '<p>あ</p>' },
    config: PLUGIN_CONFIG,
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /__APP_VERSION__ が 2 個/);
});

test('既定（プラグインに任せない）では先読み一覧も書き換える', () => {
  // 従来の使い方を壊していないことの確認。quoridor / reversi / qalc がこの形
  const dir = makeRepo({
    sw: "const APP_VERSION = 'dev'; /* __APP_VERSION__ */\nconst PRECACHE_URLS = []; /* __PRECACHE_URLS__ */\n",
    files: { 'index.html': '<p>あ</p>', 'offline.html': '<p>圏外</p>' },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const out = swOf(dir);
  assert.match(out, /const APP_VERSION = 'v[0-9a-f]{12}';/);
  assert.match(out, /const PRECACHE_URLS = \[.*offline\.html.*\];/);
});

/* ── --check と、何度走らせても同じであること ─────────────────
 * 2026-08-30 まで、この道具は 2 回目に必ず落ちた。中身は合っているのに
 * 「目印を書き換えられませんでした」と出るので、読んだ人は public/sw.js を
 * 直しに行くことになる。--check も受けつけていなかった（黙って無視して
 * 書きこむ）のに、SessionStart のフックと共通ルールの表はその形を案内して
 * いた。案内している以上、案内どおりに動かなければならない。
 */

const VITE_SW = "const APP_VERSION = 'dev'; /* __APP_VERSION__ */\n"
  + 'const PRECACHE_URLS = []; /* __PRECACHE_URLS__ */\n';
const VITE_FILES = { 'index.html': '<p>あ</p>', 'offline.html': '<p>圏外</p>' };

test('2 回目も落ちない。合っていれば「最新です」と言って 0 で終わる', () => {
  const dir = makeRepo({ sw: VITE_SW, files: VITE_FILES });
  assert.equal(run(dir).status, 0);
  const once = swOf(dir);

  const again = run(dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /最新です/);
  assert.equal(swOf(dir), once, '2 回目で中身が変わっている');
});

test('--check は合っていれば 0 で終わり、ファイルに触らない', () => {
  const dir = makeRepo({ sw: VITE_SW, files: VITE_FILES });
  run(dir);
  const stamped = swOf(dir);

  const r = run(dir, '--check');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(swOf(dir), stamped);
});

test('--check は刻む前なら落ちる。しかも書きこまない', () => {
  const dir = makeRepo({ sw: VITE_SW, files: VITE_FILES });
  const r = run(dir, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /いま dev \/ あるべき v[0-9a-f]{12}/);
  assert.equal(swOf(dir), VITE_SW, '--check なのに書きこんでいる');
});

test('--check は中身が変わったのに刻み直していないと落ちる', () => {
  const dir = makeRepo({ sw: VITE_SW, files: VITE_FILES });
  run(dir);
  const stamped = swOf(dir);
  fs.writeFileSync(path.join(dir, 'dist', 'offline.html'), '<p>圏外です</p>');

  const r = run(dir, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /中身と合っていません/);
  assert.equal(swOf(dir), stamped, '--check なのに書きこんでいる');
});

test('目印の行が無ければ、どちらのモードでも落ちる', () => {
  // 手書きの版に戻してしまった形。据え置きの版で配らせない
  const dir = makeRepo({
    sw: "const APP_VERSION = 'v1.7.1';\nconst PRECACHE_URLS = [];\n",
    files: VITE_FILES,
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /目印の行が見つかりません/);
  assert.match(r.stderr, /__APP_VERSION__ \/ __PRECACHE_URLS__/);
});

test('プラグインに任せる形でも、2 回目は「最新です」で 0', () => {
  const dir = makeRepo({ sw: MINIFIED_SW, files: { 'index.html': '<p>あ</p>' }, config: PLUGIN_CONFIG });
  assert.equal(run(dir).status, 0);
  const once = swOf(dir);

  const again = run(dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /最新です/);
  assert.equal(swOf(dir), once);
});

test('プラグインに任せる形の --check も、刻む前は落ち、刻んだあとは通る', () => {
  const dir = makeRepo({ sw: MINIFIED_SW, files: { 'index.html': '<p>あ</p>' }, config: PLUGIN_CONFIG });

  const before = run(dir, '--check');
  assert.equal(before.status, 1);
  assert.equal(swOf(dir), MINIFIED_SW, '--check なのに書きこんでいる');

  run(dir);
  assert.equal(run(dir, '--check').status, 0);
});

test('プラグインに任せる形で、中身が変われば --check が落ちる', () => {
  const dir = makeRepo({ sw: MINIFIED_SW, files: { 'index.html': '<p>あ</p>' }, config: PLUGIN_CONFIG });
  run(dir);
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<p>い</p>');
  assert.equal(run(dir, '--check').status, 1);
});

test('先読み一覧にファイル名が増えても、版と一覧はそろって書かれる', () => {
  // 置換文字列に $& が入ると化ける。関数で渡していることの確認
  const dir = makeRepo({
    sw: VITE_SW,
    files: { ...VITE_FILES, 'assets/index-$&AA.js': 'x' },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(swOf(dir).includes('assets/index-$&AA.js'), '$& が化けている');
  assert.equal(run(dir, '--check').status, 0);
});

test('dist/ が無ければ、読めるかたちで落ちる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sw-nodist-'));
  const r = run(dir, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm run build/);
  assert.ok(!/readdirSync|ENOENT/.test(r.stderr), '素の例外がそのまま出ている');
});

test('dist/sw.js が無ければ、読めるかたちで落ちる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sw-nosw-'));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<p>あ</p>');
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sw\.js がありません/);
});
