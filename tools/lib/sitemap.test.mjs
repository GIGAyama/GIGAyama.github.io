/**
 * sitemap.xml の組み立てのテスト。
 *
 * ここは「Google にいつ再訪してほしいか」を伝える唯一の口。日付が実態と
 * 合っていないと、Google は lastmod を**まるごと無視する**ようになる。
 * 2026-08-30 の時点で 90 URL 中 88 が同じ日付で、本当に更新した 1 本も
 * 区別されていなかった。同じ壊れ方に戻らないよう、形と出どころを押さえる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sitemap } from './sitemap.mjs';

const DATA = {
  items: [
    { repo: 'A', name: 'あアプリ', kind: 'app', slug: 'a', category: 'kokugo',
      publishedAt: '2026-01-01', updatedAt: '2026-08-29', changedAt: '2026-05-01' },
    { repo: 'B', name: 'いアプリ', kind: 'app', slug: 'b', category: 'sansu',
      publishedAt: '2026-02-01', updatedAt: '2026-08-29', changedAt: '' },
    { repo: 'C', name: 'う拡張', kind: 'tool', slug: 'c', category: 'other',
      publishedAt: '2026-03-01', updatedAt: '2026-08-29', changedAt: '2026-07-07' },
    { repo: 'D', name: '出さないもの', kind: 'app', slug: 'd', category: 'kokugo',
      publishedAt: '2026-01-01', updatedAt: '2026-08-29', changedAt: '2026-08-29', hidden: true },
  ],
};
const ARTICLES = [{ slug: 'a', updatedAt: '2026-04-04' }, { slug: 'b', updatedAt: '' }];
const MANUALS = [{ slug: 'a', updatedAt: '2026-06-06' }];
const DEVLOG = [
  { slug: 'site', name: '2026-08-24-x', date: '2026-08-24' },
  { slug: 'site', name: '2026-07-01-y', date: '2026-07-01' },
  { slug: 'a', name: '2026-03-03-z', date: '2026-03-03' },
];
const STAMPS = {
  '/': '2026-08-30',
  '/apps/': '2026-08-25',
  '/apps/category/kokugo/': '2026-08-25',
  '/filtering/': '2026-08-29',
  '/press/': '2026-08-29',
  '/profile/': '2026-08-26',
};

const build = (over = {}) => sitemap({
  data: DATA, articles: ARTICLES, devlog: DEVLOG, manuals: MANUALS,
  stamps: STAMPS, feedUpdated: '2026-08-10', ...over,
});

/** <loc> と、その直後の <lastmod>（無ければ null）の対応表。 */
function rows(xml) {
  const out = new Map();
  for (const block of xml.split('<url>').slice(1)) {
    const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1];
    out.set(loc, block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null);
  }
  return out;
}

test('「今日」を引数に取らない', () => {
  /* 受け取れるようにすると、いつか誰かが「日付が無いから今日でいいか」と
     書いて、90 URL 中 88 が同じ日付になっていた形に戻る。 */
  assert.equal(sitemap.length, 1, 'sitemap() の引数が増えている');
  assert.equal(build(), build(), '同じ入力から違うものが出た（決定論でない）');
});

test('組み立てたページの lastmod は、台帳から来る', () => {
  const r = rows(build());
  assert.equal(r.get('https://giga-school.com/'), '2026-08-30');
  assert.equal(r.get('https://giga-school.com/apps/'), '2026-08-25');
  assert.equal(r.get('https://giga-school.com/filtering/'), '2026-08-29');
  assert.equal(r.get('https://giga-school.com/press/'), '2026-08-29');
  assert.equal(r.get('https://giga-school.com/profile/'), '2026-08-26');
});

test('書き出していない分野の入口は載せない（消したページが 404 で並ぶのを避ける）', () => {
  const r = rows(build());
  assert.ok(r.has('https://giga-school.com/apps/category/kokugo/'));
  assert.ok(!r.has('https://giga-school.com/apps/category/sansu/'),
    '台帳に無い分野が載っている');
});

test('/feed.xml の日付は、feed.xml 自身の <updated> と同じ', () => {
  assert.equal(rows(build()).get('https://giga-school.com/feed.xml'), '2026-08-10');
});

test('紹介ページとマニュアルは、元の markdown が変わった日を使う', () => {
  const r = rows(build());
  assert.equal(r.get('https://giga-school.com/apps/a/'), '2026-04-04');
  assert.equal(r.get('https://giga-school.com/apps/a/manual/'), '2026-06-06');
});

test('開発記録は記事の日付。入口はいちばん新しい記事に合わせる', () => {
  const r = rows(build());
  assert.equal(r.get('https://giga-school.com/devlog/site/2026-08-24-x/'), '2026-08-24');
  assert.equal(r.get('https://giga-school.com/devlog/site/'), '2026-08-24');
  assert.equal(r.get('https://giga-school.com/devlog/a/'), '2026-03-03');
  assert.equal(r.get('https://giga-school.com/devlog/'), '2026-08-24');
});

test('アプリ本体は changedAt を使う（push 日ではない）', () => {
  /* updatedAt は 3 本とも 2026-08-29 で揃っている。正本配布が 42 本へ
     毎日 push するせいで、push 日を使うと必ずこうなる。 */
  const r = rows(build());
  assert.equal(r.get('https://a.giga-school.com/'), '2026-05-01');
  assert.equal(r.get('https://c.giga-school.com/'), '2026-07-07');
});

test('日付が分からなければ <lastmod> を出さない（嘘を書くより黙る）', () => {
  const r = rows(build());
  assert.equal(r.get('https://b.giga-school.com/'), null, 'changedAt が空なのに日付が出た');
  assert.equal(r.get('https://giga-school.com/apps/b/'), null);
  assert.doesNotMatch(build(), /<lastmod><\/lastmod>/, '空の <lastmod> を書いている');
});

test('hidden のアプリは載せない（転送表としては残っている）', () => {
  assert.ok(!rows(build()).has('https://d.giga-school.com/'));
});

test('同じ URL が 2 回出ない', () => {
  const locs = [...build().matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, new Set(locs).size, '重複した <loc> がある');
});

test('全 URL が同じ日付に揃わない（88/90 だった状態に戻っていない）', () => {
  const dates = [...rows(build()).values()].filter(Boolean);
  const most = Math.max(...[...new Set(dates)].map((d) => dates.filter((x) => x === d).length));
  assert.ok(most <= dates.length / 2,
    `同じ lastmod が ${most}/${dates.length} を占めている`);
});

test('記事も開発記録も無いときでも組める', () => {
  const xml = sitemap({ data: DATA });
  assert.match(xml, /<urlset/);
  assert.ok(!xml.includes('/feed.xml'), '記事が 0 本ならフィードの行も出さない');
});
