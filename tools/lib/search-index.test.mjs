/**
 * 記事の中を探すための索引のテスト。
 *
 * 索引が静かに空になっても、画面には「見つかりませんでした」と出るだけで、
 * 壊れていることに気づけない。切り出しの形をここで押さえておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchIndex, sectionsOf } from './search-index.mjs';

const PAGE = `<!DOCTYPE html>
<html lang="ja">
<body>
  <main class="wrap article">
    <div class="prose prose--article">
<h2 id="s-1">🏫 はじめに</h2>
<p>ローマ字の <strong>入力</strong>で つまずく子がいます。</p>
<h2 id="s-2">📱 このアプリでできること</h2>
<p>Google Apps Script で動きます。</p>
<figure class="prose__fig"><img src="a.png" alt="画面"><figcaption>説明</figcaption></figure>
<h2 id="s-3">📝 まとめ</h2>
<p>おわり。</p>
    </div>
  </main>
</body>
</html>`;

const APP = { slug: 'typa', name: 'Typa（タイパ）' };

test('見出しごとに切り出す', () => {
  const secs = sectionsOf(PAGE, APP);
  assert.equal(secs.length, 3);
  assert.deepEqual(secs.map((x) => x.i), ['s-1', 's-2', 's-3']);
  assert.deepEqual(secs.map((x) => x.h), ['🏫 はじめに', '📱 このアプリでできること', '📝 まとめ']);
  assert.equal(secs[0].s, 'typa');
  assert.equal(secs[0].n, 'Typa（タイパ）');
});

test('本文からタグを外し、探せる文字だけにする', () => {
  const secs = sectionsOf(PAGE, APP);
  assert.equal(secs[0].t, 'ローマ字の 入力で つまずく子がいます。');
  assert.ok(!secs[0].t.includes('<'));
});

test('空白は落とさず 1 つにまとめる', () => {
  /* 落とすと「GoogleAppsScript」になり、抜き出して見せたときに詰まる */
  const secs = sectionsOf(PAGE, APP);
  assert.match(secs[1].t, /Google Apps Script/);
});

test('画像の説明も本文に入る', () => {
  const secs = sectionsOf(PAGE, APP);
  assert.match(secs[1].t, /説明/);
});

test('最後の節は、本文の終わりまでを持つ', () => {
  const secs = sectionsOf(PAGE, APP);
  assert.equal(secs[2].t, 'おわり。');
});

test('本文が見つからないページからは、何も取り出さない', () => {
  assert.deepEqual(sectionsOf('<html><body>からっぽ</body></html>', APP), []);
  assert.deepEqual(sectionsOf('', APP), []);
  assert.deepEqual(sectionsOf(undefined, APP), []);
});

test('中身の無い節は落とす', () => {
  const empty = PAGE.replace('<p>おわり。</p>', '');
  assert.equal(sectionsOf(empty, APP).length, 2);
});

test('索引は slug の順に並び、読むためではないので詰めて書く', () => {
  const json = searchIndex([
    { slug: 'zzz', name: 'あとの', html: PAGE },
    { slug: 'aaa', name: 'さきの', html: PAGE },
  ], '2026-08-23');
  const data = JSON.parse(json);
  assert.equal(data.generatedAt, '2026-08-23');
  assert.equal(data.items.length, 6);
  assert.equal(data.items[0].n, 'さきの');
  assert.ok(!json.includes('\\n  "items"'), '字下げを入れていない');
});
