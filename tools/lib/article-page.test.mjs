/**
 * 紹介ページの組み立て。ここまでテストが無かったところに、
 * 今回さわった 2 つ（マニュアルへの入口・カードのリンク貼り）を留めておく。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArticle } from './article-md.mjs';
import { articlePage, linkCards, summaryOf } from './article-page.mjs';

const APP = {
  repo: 'Qalc', name: 'Qalc', slug: 'qalc', category: 'sansu', hosts: [],
  grades: [3, 4], account: 'none', storage: 'device',
  publishedAt: '2026-01-01', updatedAt: '2026-08-29',
};
const article = renderArticle(`# 教室で使えるかもしれないもの作り #9 ためしの題

## 🏫 はじめに

あれこれ。

## 📱 このアプリでできること

これこれ。
`, { imageUrl: (t) => t });

const page = (over = {}) => articlePage({ app: APP, article, ...over });

test('マニュアルがあるアプリでは、入口を 2 か所に出す', () => {
  const html = page({ hasManual: true });
  const hits = [...html.matchAll(/href="\/apps\/qalc\/manual\/"/g)].length;
  assert.equal(hits, 2, '題のすぐ下と、読み終わりの 2 か所');
  assert.ok(html.includes('使い方マニュアル'));
});

test('マニュアルが無いアプリでは、1 文字も出さない（空の入口は行き止まり）', () => {
  const html = page({ hasManual: false });
  assert.ok(!html.includes('/apps/qalc/manual/'));
  assert.ok(!html.includes('使い方マニュアル'));
});

test('渡さなければ出ない（既定は出さない側）', () => {
  assert.ok(!page().includes('/apps/qalc/manual/'));
});

test('「コードを見る」より上に置く', () => {
  /* 3 本のうちいちばん押されないのがコード。先生向けのサイトで、
     開発者向けの入口が使う人向けより上に在るのは順番が逆になる */
  const html = page({ hasManual: true });
  assert.ok(html.indexOf('使い方マニュアル') < html.indexOf('コードを見る'));
});

/* -----------------------------------------------------------------
 * トップのカードへのリンク貼り。
 *
 * ⚠️ ここは card__actions を丸ごと入れ替える作りなので、紹介とマニュアルを
 *    別々に貼ると、あとから貼ったほうが前のを消す。1 回で貼ること。
 * --------------------------------------------------------------- */
const card = (slug) => `        <li class="card" data-slug="${slug}">
          <h3 class="card__title"><a href="https://${slug}.giga-school.com/">${slug}</a></h3>
          <p class="card__foot">
              <a class="card__open" href="https://${slug}.giga-school.com/">開く</a>
          </p>
        </li>`;
const HTML = `<ul>\n${card('qalc')}\n${card('typa')}\n</ul>`;

test('紹介とマニュアルを 1 回でまとめて貼る', () => {
  const { html, added } = linkCards(HTML, {
    articles: new Set(['qalc', 'typa']), manuals: new Set(['qalc']),
  });
  assert.equal(added, 3);
  assert.equal((html.match(/href="\/apps\/qalc\/"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/apps\/qalc\/manual\/"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/apps\/typa\/"/g) ?? []).length, 1);
  assert.ok(!html.includes('/apps/typa/manual/'), 'マニュアルの無いアプリには貼らない');
});

test('二度通しても同じ HTML（貼り足しにならない）', () => {
  const arg = { articles: new Set(['qalc', 'typa']), manuals: new Set(['qalc']) };
  const once = linkCards(HTML, arg).html;
  const twice = linkCards(once, arg).html;
  assert.equal(twice, once);
});

test('マニュアルだけあるアプリにも入口ができる', () => {
  /* 紹介記事の無いアプリは /apps/<slug>/ が存在しないので、
     トップのカードが唯一の入口になる */
  const { html } = linkCards(HTML, { articles: new Set(), manuals: new Set(['qalc']) });
  assert.ok(html.includes('href="/apps/qalc/manual/"'));
  assert.ok(!html.includes('href="/apps/qalc/"'));
});

test('どちらも無いアプリには、空の枠を作らない', () => {
  const { html, added } = linkCards(HTML, { articles: new Set(), manuals: new Set() });
  assert.equal(added, 0);
  assert.ok(!html.includes('card__actions'));
});

test('前に貼ったものが要らなくなったら外す', () => {
  const arg = { articles: new Set(['qalc', 'typa']), manuals: new Set(['qalc']) };
  const linked = linkCards(HTML, arg).html;
  /* マニュアルを取り下げた朝 */
  const after = linkCards(linked, { articles: new Set(['qalc', 'typa']), manuals: new Set() }).html;
  assert.ok(!after.includes('/apps/qalc/manual/'));
  assert.ok(after.includes('href="/apps/qalc/"'), '紹介のほうは残ること');
});

test('manuals を渡さなくても落ちない（呼ぶ側を直し忘れたとき）', () => {
  const { html } = linkCards(HTML, { articles: new Set(['qalc']) });
  assert.ok(html.includes('href="/apps/qalc/"'));
});

/* ── ふりがな ──────────────────────────────────────
 * summaryOf に渡ってくるのは本文の最初の段落の素の Markdown。
 * 子ども向けマニュアルはそこにふりがなを振るので、落とさないと
 * <meta name="description"> と og:description と JSON-LD に
 * 生のタグが入る。検索結果に出るのはこの文字列である。
 */

test('説明文にふりがなのタグを残さない', () => {
  const lead = 'この アプリは <ruby>計算<rt>けいさん</rt></ruby>の れんしゅうを します。';
  assert.equal(summaryOf(lead), 'この アプリは 計算の れんしゅうを します。');
});

test('ふりがなを落としてから長さを数える', () => {
  // 落とす前に数えると、ふりがなのぶんだけ早く切られて本文が入らない
  const lead = '<ruby>計算<rt>けいさん</rt></ruby>'.repeat(20);
  assert.equal(summaryOf(lead, 110), '計算'.repeat(20));
});

test('説明文では、ふりがな以外の < > を食わない', () => {
  // 渡ってくるのは Markdown。タグらしきものを丸ごと外すと素の文が消える
  const lead = '1 < 2 のとき > を使います。';
  assert.equal(summaryOf(lead), lead);
});

test('同じ入力を 2 回組むと、バイトまで同じ', () => {
  /* ⚠️ 日付は中身のハッシュで決めている（tools/lib/lastmod.mjs）。組み立てが
     日によって揺れると、中身が同じでもハッシュが動き、lastmod が毎朝進む形に
     戻る。しかも「直したはず」なので誰も見に行かない。ここで押さえる。 */
  assert.equal(page(), page());
  assert.equal(page({ hasManual: true }), page({ hasManual: true }));
});
