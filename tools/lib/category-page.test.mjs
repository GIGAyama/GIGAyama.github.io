/**
 * 教科・分野ごとの入口ページのテスト。
 *
 * このページは検索から直接来る人の着地点になる。数え違いや、
 * 取り下げたアプリが残ることに気づきにくいので、組み立ての段で押さえておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryPage, categoryUrl, groupByCategory } from './category-page.mjs';

const APPS = [
  { repo: 'A', name: 'あアプリ', kind: 'app', slug: 'a', category: 'kokugo',
    publishedAt: '2026-01-01', updatedAt: '2026-02-01' },
  { repo: 'B', name: 'いアプリ', kind: 'app', slug: 'b', category: 'kokugo',
    publishedAt: '2026-03-01', updatedAt: '2026-03-02' },
  { repo: 'C', name: 'うアプリ', kind: 'app', slug: 'c', category: 'sansu',
    publishedAt: '2026-02-01', updatedAt: '2026-02-02' },
  { repo: 'D', name: '出さないもの', kind: 'app', slug: 'd', category: 'kokugo',
    publishedAt: '2026-01-01', updatedAt: '2026-01-02', hidden: true },
  { repo: 'E', name: '知らない分類', kind: 'app', slug: 'e', category: 'なにか',
    publishedAt: '2026-01-01', updatedAt: '2026-01-02' },
];
const ARTICLES = [
  { slug: 'a', name: 'あアプリ', title: 'あの話', headline: 'あの話', summary: 'あらすじ' },
  { slug: 'd', name: '出さないもの', title: 'だの話', headline: 'だの話', summary: 'だ' },
];

test('hidden のアプリは、どの分類にも入らない', () => {
  const g = groupByCategory(APPS, ARTICLES);
  assert.deepEqual(g.get('kokugo').apps.map((a) => a.slug), ['a', 'b']);
  /* 記事のほうも、アプリが hidden なら落とす */
  assert.deepEqual(g.get('kokugo').articles.map((a) => a.slug), ['a']);
});

test('知らない分類は「そのほか」に寄せる', () => {
  const g = groupByCategory(APPS, ARTICLES);
  assert.deepEqual(g.get('other').apps.map((a) => a.slug), ['e']);
});

test('アプリが 1 本も無い分類も、空の入れ物として返す', () => {
  const g = groupByCategory(APPS, ARTICLES);
  assert.deepEqual(g.get('game'), { apps: [], articles: [] });
});

test('アプリは名前順、紹介は新しい順に並ぶ', () => {
  const g = groupByCategory(APPS, ARTICLES);
  assert.deepEqual(g.get('kokugo').apps.map((a) => a.name), ['あアプリ', 'いアプリ']);
});

test('ページに、その分類のアプリと本数が出る', () => {
  const g = groupByCategory(APPS, ARTICLES);
  const html = categoryPage({ id: 'kokugo', groups: g, lastmod: '2026-08-23' });
  assert.match(html, /<h1 class="article__title">国語・言葉のアプリ<\/h1>/);
  assert.match(html, /2 本あります/);
  assert.match(html, /あアプリ/);
  assert.match(html, /いアプリ/);
  /* 別の分類のアプリは出さない */
  assert.ok(!html.includes('うアプリ'));
  /* 出さないことにしたアプリも出さない */
  assert.ok(!html.includes('出さないもの'));
});

test('紹介のあるアプリにだけ「紹介を読む」が付く', () => {
  const g = groupByCategory(APPS, ARTICLES);
  const html = categoryPage({ id: 'kokugo', groups: g, lastmod: '2026-08-23' });
  assert.equal((html.match(/紹介を読む/g) || []).length, 1);
});

test('紹介が 1 本も無い分類でも、ページとして成り立つ', () => {
  const g = groupByCategory(APPS, []);
  const html = categoryPage({ id: 'sansu', groups: g, lastmod: '2026-08-23' });
  assert.match(html, /うアプリ/);
  assert.ok(!html.includes('<h2 class="cat-title">紹介</h2>'));
  assert.ok(!html.includes('article-list'));
});

test('いまいる分類は、自分自身へのリンクにしない', () => {
  const g = groupByCategory(APPS, ARTICLES);
  const html = categoryPage({ id: 'kokugo', groups: g, lastmod: '2026-08-23' });
  assert.ok(!html.includes('href="/apps/category/kokugo/"'));
  assert.match(html, /aria-current="page">国語・言葉/);
  assert.match(html, /href="\/apps\/category\/sansu\/"/);
});

test('同じ入力を 2 回組むと、バイトまで同じ', () => {
  /* ⚠️ 日付は中身のハッシュで決めている（tools/lib/lastmod.mjs）。並びが日に
     よって変わると、中身が同じでもハッシュが動き、lastmod が毎朝進む形に戻る。
     しかも「直したはず」なので誰も見に行かない。ここで押さえる。 */
  const a = categoryPage({ id: 'kokugo', groups: groupByCategory(APPS, ARTICLES), lastmod: '2026-08-23' });
  const b = categoryPage({ id: 'kokugo', groups: groupByCategory(APPS, ARTICLES), lastmod: '2026-08-23' });
  assert.equal(a, b);
});

test('canonical と JSON-LD の URL がそろっている', () => {
  const g = groupByCategory(APPS, ARTICLES);
  const html = categoryPage({ id: 'kokugo', groups: g, lastmod: '2026-08-23' });
  const url = categoryUrl('kokugo');
  assert.equal(url, 'https://giga-school.com/apps/category/kokugo/');
  assert.match(html, new RegExp(`<link rel="canonical" href="${url}">`));
  assert.match(html, new RegExp(`"@id": "${url}#page"`));
  assert.match(html, /"numberOfItems": 2/);
});
