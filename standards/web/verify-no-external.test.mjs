/**
 * verify-no-external.mjs の試験。
 *
 * ⚠️ ここで見ているのは判定と配信の部分だけ。実ブラウザで開く部分は
 *    playwright が要るので、ポータル（package.json を持たない）の CI では走らない。
 *    そちらは .github/workflows/verify-runtime.yml が週次で本番を巡回して確かめる。
 *    **「試験が通った」を「ブラウザで確かめた」と読まないこと。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { undeclared, declaredHosts, findChromium, serveDist } from './verify-no-external.mjs';

/* ── 宣言していない外部ホストを見つける ───────────────── */

const ORIGIN = 'https://typa.giga-school.com';

test('自分のオリジンは外部ではない', () => {
  assert.deepEqual(undeclared([`${ORIGIN}/js/app.js`, `${ORIGIN}/index.html`], ORIGIN, []), []);
});

test('宣言していない外部ホストを出す', () => {
  const found = undeclared([`${ORIGIN}/a.js`, 'https://cdn.jsdelivr.net/x.js'], ORIGIN, []);
  assert.deepEqual(found.map((f) => f.host), ['cdn.jsdelivr.net']);
});

test('スキームを省いた形も、ブラウザが補うので記録には絶対 URL で出る', () => {
  // 2026-08-28 の穴 ①。静的検査は `https?://` でしか見ておらず素通りした。
  // ブラウザは同じスキームを補って要求するので、記録では普通の URL になる。
  const found = undeclared([`${ORIGIN}/a.js`, 'https://cdn.jsdelivr.net/sweetalert2'], ORIGIN, []);
  assert.equal(found[0].host, 'cdn.jsdelivr.net');
});

test('宣言してあれば通す', () => {
  assert.deepEqual(undeclared(['https://api.openbd.jp/v1/get'], ORIGIN, ['api.openbd.jp']), []);
});

test('宣言は下位ドメインにも効く（fonts.gstatic.com を gstatic.com で許す）', () => {
  assert.deepEqual(undeclared(['https://fonts.gstatic.com/s/a.woff2'], ORIGIN, ['gstatic.com']), []);
});

test('似ているだけの別ドメインは許さない', () => {
  // evil-gstatic.com は gstatic.com の下位ドメインではない
  const found = undeclared(['https://evil-gstatic.com/x.js'], ORIGIN, ['gstatic.com']);
  assert.equal(found.length, 1);
});

test('同じホストは何度出ても 1 件にまとめる', () => {
  const found = undeclared(
    ['https://unpkg.com/a.js', 'https://unpkg.com/b.js', 'https://unpkg.com/c.css'], ORIGIN, []);
  assert.equal(found.length, 1);
  assert.ok(found[0].url.includes('unpkg.com/a.js'), '最初に見つかった URL を添える');
});

test('data: と blob: は外に出ないので数えない', () => {
  const urls = ['data:image/png;base64,iVBOR', 'blob:https://x/1', 'about:blank'];
  assert.deepEqual(undeclared(urls, ORIGIN, []), []);
});

test('壊れた URL で落ちない', () => {
  assert.deepEqual(undeclared(['', 'not a url', '://'], ORIGIN, []), []);
});

/* ── 宣言の読み方（giga-reviewer と同じところを読む）───── */

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ext-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

test('quality.config.json の securityExceptions を読む（新しい宣言の形を作らない）', () => {
  const dir = repo({
    'quality.config.json': JSON.stringify({
      securityExceptions: [
        { rule: 'external-runtime-host', value: 'api.openbd.jp', reason: '本の情報' },
        { rule: 'npm-audit-clean', value: 'x', reason: '別の規則' },
      ],
    }),
  });
  try { assert.deepEqual(declaredHosts(dir), ['api.openbd.jp']); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('quality.config.json が無くても落ちない', () => {
  const dir = repo({ 'README.md': 'x' });
  try { assert.deepEqual(declaredHosts(dir), []); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('quality.config.json が壊れていても落ちない', () => {
  const dir = repo({ 'quality.config.json': 'これは JSON ではない' });
  try { assert.deepEqual(declaredHosts(dir), []); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ── Chromium さがし ──────────────────────────────── */

test('CHROME_PATH があればそれを使う', () => {
  assert.equal(findChromium({ CHROME_PATH: '/x/chrome' }), '/x/chrome');
});

test('置き場が無ければ undefined（playwright に任せる）', () => {
  assert.equal(findChromium({ PLAYWRIGHT_BROWSERS_PATH: '/nope' }, { exists: () => false }), undefined);
});

test('新しい版から順にさがす', () => {
  const found = findChromium(
    { PLAYWRIGHT_BROWSERS_PATH: '/pw' },
    {
      exists: (p) => p === '/pw' || p === '/pw/chromium-1194/chrome-linux/chrome',
      readdir: () => ['chromium-1000', 'chromium-1194', 'ffmpeg-1011'],
    },
  );
  assert.equal(found, '/pw/chromium-1194/chrome-linux/chrome');
});

/* ── 本番と同じサブパスで配る ─────────────────────── */

test('サブパスの下で配る（本番が /Typa/ なら、そこに置いたように見せる）', async () => {
  const dir = repo({ 'index.html': '<h1>やあ</h1>', 'js/app.js': 'console.log(1)' });
  const { server, port } = await serveDist(dir, '/Typa/');
  try {
    const html = await fetch(`http://127.0.0.1:${port}/Typa/`).then((r) => r.text());
    assert.ok(html.includes('やあ'));
    const js = await fetch(`http://127.0.0.1:${port}/Typa/js/app.js`);
    assert.equal(js.headers.get('content-type'), 'text/javascript');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('.. でルートの外へ出られない（検査の道具が広い権限で動かない）', async () => {
  const dir = repo({ 'index.html': 'ok' });
  const { server, port } = await serveDist(dir, '/');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);
    assert.ok(res.status === 403 || res.status === 404, `外へ出られてしまった: ${res.status}`);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
