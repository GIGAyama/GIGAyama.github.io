/**
 * 日付の台帳のテスト。
 *
 * ここが崩れると、公開ページの lastmod が毎朝いっせいに「今日」へ動く。
 * 2026-08-30 の時点で sitemap の 90 URL 中 88 が同じ日付になっていて、
 * Google は lastmod をまるごと無視する状態だった。しかも**直したはず**の
 * あとに崩れると、誰も見に行かないので気づけない。だから検査で押さえる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SENTINEL, hashOf, normalizeLedger, resolveLastmod, serializeLedger,
  siteLastmod, stamp, stampStatic,
} from './lastmod.mjs';

const TODAY = '2026-08-31';

/** 日付を本文に出すページの見立て（press-page.mjs がこの形）。 */
const build = (body) => (lastmod) => `<p>${lastmod} 現在</p><main>${body}</main>`;

test('中身が変わらなければ、日付は動かない', () => {
  const led = normalizeLedger(null);
  const first = stamp(led, '/press/', build('あ'), '2026-08-20');
  assert.equal(first.lastmod, '2026-08-20');
  assert.equal(first.changed, true);

  /* 別の日に、同じ中身で組み直す */
  const again = stamp(led, '/press/', build('あ'), TODAY);
  assert.equal(again.lastmod, '2026-08-20', '中身が同じなのに日付が動いた');
  assert.equal(again.changed, false);
});

test('中身が変われば、その日の日付になる', () => {
  const led = normalizeLedger(null);
  stamp(led, '/press/', build('あ'), '2026-08-20');
  const next = stamp(led, '/press/', build('い'), TODAY);
  assert.equal(next.lastmod, TODAY);
  assert.equal(next.changed, true);
});

test('日付だけ違う 2 つの描画は、同じハッシュになる', () => {
  /* ここが崩れると、日付が変わる→ハッシュが変わる→日付が変わる、で
     自分自身を追いかけて毎日動く。SENTINEL を置いて測る理由そのもの。 */
  const page = build('あ');
  assert.equal(hashOf(page(SENTINEL)), hashOf(page(SENTINEL)));
  assert.notEqual(page('2026-08-20'), page('2026-08-31'));

  const led = normalizeLedger(null);
  stamp(led, '/press/', page, '2026-08-20');
  const stored = led.pages['/press/'].hash;
  /* 台帳に入っているのは SENTINEL 描画のハッシュ。日付入りのものとは別 */
  assert.equal(stored, hashOf(page(SENTINEL)));
  assert.notEqual(stored, hashOf(page('2026-08-20')));
});

test('書き出す中身には、SENTINEL ではなく決まった日付が入る', () => {
  const led = normalizeLedger(null);
  const r = stamp(led, '/press/', build('あ'), '2026-08-20');
  assert.match(r.text, /2026-08-20 現在/);
  assert.doesNotMatch(r.text, /0000-00-00/, 'SENTINEL がページに出てしまっている');
});

test('台帳に無い道は、その日の日付になる', () => {
  const led = normalizeLedger(null);
  assert.deepEqual(resolveLastmod(led, '/はじめて/', 'abc', TODAY),
    { lastmod: TODAY, changed: true });
});

test('組み立てない静的なページも、中身で日付が決まる', () => {
  const led = normalizeLedger(null);
  assert.equal(stampStatic(led, '/profile/', '<h1>自己紹介</h1>', '2026-08-26').lastmod,
    '2026-08-26');
  assert.equal(stampStatic(led, '/profile/', '<h1>自己紹介</h1>', TODAY).lastmod,
    '2026-08-26', '中身が同じなのに日付が動いた');
  assert.equal(stampStatic(led, '/profile/', '<h1>自己紹介（新）</h1>', TODAY).lastmod, TODAY);
});

test('壊れた台帳は、空として扱う（朝の流れを止めない）', () => {
  assert.deepEqual(normalizeLedger(null).pages, {});
  assert.deepEqual(normalizeLedger('こわれている').pages, {});
  assert.deepEqual(normalizeLedger({ pages: null }).pages, {});
  /* 日付の形をしていない行は落とす。そのページは次に今日で入り直す */
  assert.deepEqual(normalizeLedger({ pages: { '/': { hash: 'a', lastmod: 'きのう' } } }).pages, {});
  assert.deepEqual(normalizeLedger({ pages: { '/': { hash: 'a', lastmod: '2026-08-20' } } }).pages,
    { '/': { hash: 'a', lastmod: '2026-08-20' } });
});

test('サイト全体の最終更新は、いちばん新しいページの日付', () => {
  const led = normalizeLedger({
    pages: {
      '/': { hash: 'a', lastmod: '2026-08-20' },
      '/press/': { hash: 'b', lastmod: '2026-08-29' },
      '/profile/': { hash: 'c', lastmod: '2026-08-26' },
    },
  });
  assert.equal(siteLastmod(led), '2026-08-29');
  assert.equal(siteLastmod(normalizeLedger(null)), '', '空の台帳で日付を作ってはいけない');
});

test('書き出しは道の順に並ぶ（差分が読める・順で結果が変わらない）', () => {
  const a = normalizeLedger(null);
  stamp(a, '/press/', build('あ'), TODAY);
  stamp(a, '/', build('い'), TODAY);
  const b = normalizeLedger(null);
  stamp(b, '/', build('い'), TODAY);
  stamp(b, '/press/', build('あ'), TODAY);
  assert.equal(serializeLedger(a), serializeLedger(b), '入れた順で書き出しが変わった');
});
