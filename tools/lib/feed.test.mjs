/**
 * Atom フィードの組み立てのテスト。
 *
 * フィードリーダーは <updated> の変化で未読を立てる。2026-08-30 の時点で
 * 20 件の entry と feed 自身の**21 個すべてが同じ値**になっていて、
 * 中身が 1 文字も変わっていないのに毎回 20 件ぜんぶが「更新」として
 * 購読者に届いていた。原因が 3 つあったので、3 つとも押さえる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feed } from './feed.mjs';

const DATA = {
  items: [
    { repo: 'A', name: 'あアプリ', kind: 'app', slug: 'a', category: 'kokugo',
      publishedAt: '2026-01-01', updatedAt: '2026-08-29' },
    { repo: 'B', name: 'いアプリ', kind: 'app', slug: 'b', category: 'sansu',
      publishedAt: '2026-02-01', updatedAt: '2026-08-29' },
    { repo: 'D', name: '出さないもの', kind: 'app', slug: 'd', category: 'kokugo',
      publishedAt: '2026-01-01', updatedAt: '2026-08-29', hidden: true },
  ],
};
/* 記事があるのは a だけ。b は「公開しました」の entry になる */
const ARTICLES = [{ slug: 'a', title: 'あの話', headline: 'あの話', summary: 'あらすじ',
  updatedAt: '2026-04-04' }];

/** entry ごとの id → updated。 */
function entries(xml) {
  const out = new Map();
  for (const block of xml.split('<entry>').slice(1)) {
    out.set(block.match(/<id>([^<]*)<\/id>/)?.[1],
      block.match(/<updated>([^<]*)<\/updated>/)?.[1]);
  }
  return out;
}

test('「今日」を引数に取らない', () => {
  assert.equal(feed.length, 1, 'feed() の引数が増えている');
});

test('同じ入力から 2 回組むと、バイトまで同じ', () => {
  /* 実行日が混ざっていれば、日をまたいだ瞬間にここが崩れる */
  const a = feed({ data: DATA, articles: ARTICLES });
  const b = feed({ data: DATA, articles: ARTICLES });
  assert.equal(a.xml, b.xml);
  assert.equal(a.updated, b.updated);
});

test('記事の entry は、記事そのものが変わった日を使う', () => {
  const e = entries(feed({ data: DATA, articles: ARTICLES }).xml);
  assert.equal(e.get('https://giga-school.com/apps/a/'), '2026-04-04T00:00:00+09:00');
});

test('アプリだけの entry は、updated を公開日に固定する', () => {
  /* この entry の本文は「◯◯ を公開しました。」で未来永劫変わらない。
     push で updated を動かすのは、中身が同じものを読み直せと言うのと同じ。 */
  const e = entries(feed({ data: DATA, articles: ARTICLES }).xml);
  assert.equal(e.get('https://b.giga-school.com/'), '2026-02-01T00:00:00+09:00');
});

test('フィード全体の <updated> に「今日」が混ざらない', () => {
  /* 以前は reduce の初期値が generatedAt（＝今日）だったので、
     新着 0 件でも毎日進んでいた。載っている entry の最大値であること。 */
  const r = feed({ data: DATA, articles: ARTICLES });
  assert.equal(r.updated, '2026-04-04');
  assert.match(r.xml, /<id>https:\/\/giga-school\.com\/<\/id>\s*<updated>2026-04-04T00:00:00\+09:00<\/updated>/);
});

test('全 entry の updated が同じ値に揃わない（21/21 だった状態に戻っていない）', () => {
  const vals = [...entries(feed({ data: DATA, articles: ARTICLES }).xml).values()];
  assert.ok(new Set(vals).size > 1, `全 entry が同じ updated（${vals[0]}）になっている`);
});

test('hidden のアプリは載せない', () => {
  const e = entries(feed({ data: DATA, articles: ARTICLES }).xml);
  assert.ok(!e.has('https://d.giga-school.com/'));
});

test('entry が 0 本でも、壊れた時刻を書かない', () => {
  /* 空のまま組むと `T00:00:00+09:00` という日付の無い時刻になっていた */
  const r = feed({ data: { items: [] }, articles: [], fallback: '2026-08-20' });
  assert.equal(r.updated, '2026-08-20');
  assert.doesNotMatch(r.xml, /<updated>T/);

  const bare = feed({ data: { items: [] }, articles: [] });
  assert.match(bare.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(bare.xml, /<updated>T/);
});

test('20 件で切る', () => {
  const many = { items: Array.from({ length: 30 }, (_, n) => ({
    repo: `R${n}`, name: `アプリ${n}`, kind: 'app', slug: `s${n}`, category: 'other',
    publishedAt: `2026-01-${String(n + 1).padStart(2, '0')}`, updatedAt: '2026-08-29',
  })) };
  assert.equal(entries(feed({ data: many, articles: [] }).xml).size, 20);
});
