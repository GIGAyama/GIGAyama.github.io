/**
 * 更新を追えるようにする（Atom）。
 *
 * 一度アプリに辿り着いた人が、次に何が出たかを知る手段がサイトに無かった。
 * X と note は続けるかどうかが本人次第だが、フィードは置いておけば勝手に届く。
 *
 * 中身は「読むもの」に絞る。紹介記事と、記事がまだ無い新しいアプリ。
 * 「最近手を入れたもの」は入れない。細かい push が流れ続けるだけで、
 * 購読している側にとっては報せる値打ちが無い。
 *
 * 日付は data/apps.json の YYYY-MM-DD しか持っていないので、
 * その日の始まり（日本時間）として書く。時刻まで正確である必要はない。
 *
 * ── <updated> に「今日」を混ぜない ──────────────────
 *
 * ⚠️ **この関数は「今日」を受け取らない。** 2026-08-30 の時点で、20 件の entry と
 *    feed 自身の、**21 個すべての `<updated>` が同じ値**になっていた。原因は 3 つ:
 *
 *    1. feed 全体の `<updated>` を `reduce` で求めるときの**初期値が「今日」**だった。
 *       新着が 0 件でも毎日進む。
 *    2. 記事 entry の updated が、記事ではなく**リポジトリの push 日**だった。
 *       正本配布（auto-distribute）が 42 本へ一斉に配るので、全部が同じ日に揃う。
 *    3. アプリだけの entry も push 日を見ていた。
 *
 *    フィードリーダーは `<updated>` の変化で未読を立てる。つまり購読している人には
 *    **中身が 1 文字も変わっていないのに、毎回 20 件ぜんぶが「更新」として届いていた**。
 *
 * ⚠️ **アプリだけの entry は `updated` を `published` に固定する。**
 *    この entry の本文は「◯◯ を公開しました。」で、**未来永劫変わらない**。
 *    push で updated を動かすのは、中身が同じものを読み直せと言っているのと同じ。
 */

import { CATEGORY_LABEL } from './categories.mjs';

const SITE = 'https://giga-school.com';

/** サイトに載せるものか（data/apps.json は転送表も兼ねているので hidden で外す）。 */
const shown = (item) => item.hidden !== true;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const stamp = (iso) => `${iso}T00:00:00+09:00`;

/**
 * @param {object} o
 * @param {object} o.data data/apps.json の中身
 * @param {object[]} [o.articles] data/articles.json の items
 * @param {string} [o.fallback] entry が 0 本のときに置く日付（サイト全体の最終更新日）
 * @returns {{xml: string, updated: string}} updated は YYYY-MM-DD
 */
export function feed({ data, articles = [], fallback = '' }) {
  const byslug = new Map(data.items.map((i) => [i.slug, i]));
  const hasArticle = new Set(articles.map((a) => a.slug));

  /* 紹介記事。読むものとしては、これが本体。
     updatedAt は note 記事の markdown が最後に変わった日（build-articles.mjs）。
     ⚠️ 取れなかったときに app.updatedAt（push 日）へ落とさない。それが直した相手そのもの。 */
  const fromArticles = articles
    .filter((a) => a.slug && byslug.get(a.slug) && shown(byslug.get(a.slug))
      && byslug.get(a.slug).publishedAt)
    .map((a) => {
      const app = byslug.get(a.slug);
      return {
        id: `${SITE}/apps/${a.slug}/`,
        href: `${SITE}/apps/${a.slug}/`,
        title: a.headline || a.title,
        summary: a.summary,
        published: app.publishedAt,
        updated: a.updatedAt || app.publishedAt,
        category: CATEGORY_LABEL[app.category] || CATEGORY_LABEL.other,
      };
    });

  /* 記事がまだ無いアプリ。公開したこと自体は報せる値打ちがある。
     本文が「公開しました」で固定なので、updated も公開日で固定する。 */
  const fromApps = data.items
    .filter((i) => shown(i) && i.slug && i.publishedAt && !hasArticle.has(i.slug))
    .map((i) => ({
      id: `https://${i.slug}.giga-school.com/`,
      href: `https://${i.slug}.giga-school.com/`,
      title: i.name,
      summary: `${i.name} を公開しました。`,
      published: i.publishedAt,
      updated: i.publishedAt,
      category: CATEGORY_LABEL[i.category] || CATEGORY_LABEL.other,
    }));

  /* 新しく公開した順。多すぎても読まれないので 20 件で切る */
  const entries = [...fromArticles, ...fromApps]
    .sort((a, b) => (b.published || '').localeCompare(a.published || '')
      || String(a.title).localeCompare(String(b.title), 'ja'))
    .slice(0, 20);

  /* フィード自体の更新日は、載っている entry のいちばん新しいものに合わせる。
     ⚠️ 初期値に「今日」を置かない（それが 21/21 が同じ値になっていた原因）。
        entry が 0 本で fallback も無いときだけ、いちばん古い公開日に逃がす。
        空のまま stamp() に渡すと `T00:00:00+09:00` という壊れた時刻になる。 */
  const updated = entries.reduce((m, e) => (e.updated > m ? e.updated : m), '')
    || fallback
    || data.items.reduce((min, i) => (i.publishedAt && (!min || i.publishedAt < min)
      ? i.publishedAt : min), '')
    || '1970-01-01';

  const body = entries.map((e) => `  <entry>
    <title>${esc(e.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(e.href)}"/>
    <id>${esc(e.id)}</id>
    <published>${stamp(e.published)}</published>
    <updated>${stamp(e.updated)}</updated>
    <category term="${esc(e.category)}"/>
    <summary type="text">${esc(e.summary)}</summary>
  </entry>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- tools/sync-updates.mjs が data/apps.json と data/articles.json から書き出す。手で書き足さない。 -->
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
  <title>GIGA school｜学校で使える Web アプリ</title>
  <subtitle>小学校の教員がつくった Web アプリと、その紹介記事の更新</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${stamp(updated)}</updated>
  <author>
    <name>GIGAyama</name>
    <uri>${SITE}/</uri>
  </author>
  <rights>© GIGAyama</rights>
${body}
</feed>
`;

  return { xml, updated };
}
