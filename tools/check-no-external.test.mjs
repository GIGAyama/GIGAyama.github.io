/* tools/check-no-external.mjs のテスト。
 *
 * 見張っているのは 2 つ。
 *   ① 外からの読み込みを、ほんとうに拾えるか
 *   ② 読み込みでないもの（共有ボタンのリンクなど）で赤くならないか
 *
 * ②が要るのは、いつも赤い検査は読まれなくなるから。共有ボタンは
 * x.com / facebook / はてな / LINE を指していて、これは消せない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOwn, loadsIn, servedFiles } from './check-no-external.mjs';

test('自分の側と外を見分ける', () => {
  for (const u of ['/assets/manual/qalc/01-home.webp', 'style.css', '#s-1',
    'data:image/svg+xml,x', 'https://giga-school.com/feed.xml',
    'https://qalc.giga-school.com/docs/manual/images/01.png'])
    assert.equal(isOwn(u), true, u);

  for (const u of ['https://raw.githubusercontent.com/GIGAyama/Qalc/HEAD/a.png',
    'https://cdn.jsdelivr.net/npm/x', 'https://fonts.googleapis.com/css2?family=X',
    'http://unpkg.com/x'])
    assert.equal(isOwn(u), false, u);
});

test('スキームを省いた //cdn… を通さない', () => {
  /* 2026-08-28 に、この形が静的検査を素通りしている。
     `http` で始まらないので、うっかり書くと「相対の道」の側へ落ちる。 */
  assert.equal(isOwn('//cdnjs.cloudflare.com/ajax/libs/x/x.js'), false);
  assert.equal(isOwn('//giga-school.com/assets/style.css'), true);
});

test('giga-school.com に似せた別のドメインは外', () => {
  assert.equal(isOwn('https://giga-school.com.example.net/x.js'), false);
  assert.equal(isOwn('https://notgiga-school.com/x.js'), false);
});

test('読み込みを拾う', () => {
  const html = `
    <img src="https://raw.githubusercontent.com/a/b/HEAD/x.png">
    <img srcset="https://cdn.example.com/a.png 1x, /assets/a.png 2x">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">
    <style>@import "https://cdn.example.com/x.css"; body{background:url(https://cdn.example.com/b.png)}</style>
    <script>importScripts('https://cdn.example.com/sw.js')</script>`;
  const outside = loadsIn(html).filter((l) => !isOwn(l.url)).map((l) => l.url);
  /* 並びは「拾い方ごと」。src → srcset → link → url() → @import → importScripts */
  assert.deepEqual(outside, [
    'https://raw.githubusercontent.com/a/b/HEAD/x.png',
    'https://cdn.example.com/a.png',
    'https://fonts.googleapis.com/css2?family=X',
    'https://cdn.example.com/b.png',
    'https://cdn.example.com/x.css',
    'https://cdn.example.com/sw.js',
  ], outside.join('\n'));
});

test('url() 付きの @import を、2 回数えない', () => {
  /* 同じ 1 件が 2 行で出ると、報告の件数が実態と合わなくなる */
  const found = loadsIn('@import url("https://cdn.example.com/x.css");');
  assert.equal(found.filter((l) => !isOwn(l.url)).length, 1);
});

test('リンクと申告は読み込みではないので拾わない', () => {
  /* ここが緩むと、共有ボタンと OGP で毎回赤くなる */
  const html = `
    <a href="https://x.com/intent/post?url=x">X で共有</a>
    <a href="https://b.hatena.ne.jp/entry/x">はてな</a>
    <meta property="og:image" content="https://giga-school.com/assets/og.png">
    <link rel="canonical" href="https://giga-school.com/apps/qalc/manual/">
    <link rel="alternate" type="application/atom+xml" href="/feed.xml">
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>`;
  assert.deepEqual(loadsIn(html).filter((l) => !isOwn(l.url)), []);
});

test('rel を知らない <link> は、数える側へ倒れる', () => {
  const found = loadsIn('<link rel="なにか新しいもの" href="https://cdn.example.com/x.css">');
  assert.equal(found.length, 1);
  assert.equal(isOwn(found[0].url), false);
});

test('走査の対象に、道具や正本を混ぜない', () => {
  const files = servedFiles();
  assert.ok(files.length > 0);
  assert.ok(files.includes('index.html'));
  assert.ok(files.some((f) => f.startsWith('apps/')));
  for (const f of files)
    assert.ok(!/^(standards|tools|docs|\.github|\.claude|\.agents)\//.test(f), f);
});

test('いま配信しているものに、外からの読み込みが無い', () => {
  /* 本体。ここが赤いときは、公開中のページが外を読んでいる */
  const root = new URL('..', import.meta.url);
  const bad = [];
  for (const f of servedFiles())
    for (const l of loadsIn(readFileSync(new URL(f, root), 'utf8')))
      if (!isOwn(l.url)) bad.push(`${f}  ${l.how} → ${l.url}`);
  assert.deepEqual(bad, []);
});
