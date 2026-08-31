/**
 * sitemap.xml を組み立てる。
 *
 * トップページのほかに、各アプリのサブドメイン（<slug>.giga-school.com）も載せる。
 * アプリは 1 本ずつ別のホストなので、トップページを見ただけでは Google が
 * すべてを追い切れない。ここに並べておくと取りこぼしが減る。
 *
 * 別ホストの URL を 1 つのサイトマップに書けるのは、Search Console で
 * giga-school.com を「ドメイン プロパティ」として登録し、サブドメインまで
 * 所有権が確認できている場合。URL プレフィックスのプロパティしかないと、
 * サブドメインの行は無視される。
 *
 * ── lastmod の決め方 ────────────────────────────
 *
 * ⚠️ **この関数は「今日」を受け取らない。** 受け取れるようにすると、いつか誰かが
 *    「日付が無いから今日でいいか」と書いて、元の壊れ方に戻る。日付はすべて
 *    呼ぶ側で決めて渡す。検査（tools/lib/sitemap.test.mjs）が引数の数で見張っている。
 *
 * - 組み立てたページ（/ や /apps/ など）… tools/lib/lastmod.mjs の台帳が決めた日
 * - 紹介ページ・マニュアル … その元になった markdown が最後に変わった日
 * - 開発記録 … 記事そのものの日付
 * - アプリ本体（サブドメイン）… 正本配布を除いた最後のコミット日（changedAt）
 *
 * ⚠️ **日付が分からないときは `<lastmod>` を出さない。**
 *    sitemaps.org の仕様で lastmod は省略できる。嘘の日付を並べるより
 *    黙っているほうがいい。2026-08-30 の時点で 90 URL 中 88 が同じ日付になっており、
 *    そうなると Google は lastmod を**まるごと無視する**（本当に更新した 1 本も
 *    区別されなくなる）。
 */

import { CATEGORY_LABEL } from './categories.mjs';
import { CATEGORY_BASE } from './category-page.mjs';

const SITE = 'https://giga-school.com';

/** サイトに載せるものか（data/apps.json は転送表も兼ねているので hidden で外す）。 */
const shown = (item) => item.hidden !== true;

/**
 * 1 本ぶんの <url>。
 *
 * lastmod が空なら、その行ごと出さない（要素を空で置くと不正な日付になる）。
 */
function urlEntry(loc, lastmod, changefreq, priority) {
  const when = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return `  <url>
    <loc>${loc}</loc>${when}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

/** 開発記録のうち、その slug のいちばん新しい日付。 */
const newestDate = (list) => list.reduce((max, e) => (e.date > max ? e.date : max), '');

/**
 * @param {object} o
 * @param {object} o.data data/apps.json の中身
 * @param {object[]} [o.articles] data/articles.json の items
 * @param {object[]} [o.devlog] data/devlog.json の items
 * @param {object[]} [o.manuals] data/manuals.json の items
 * @param {Record<string,string>} [o.stamps] 組み立てたページの道 → 日付
 * @param {string} [o.feedUpdated] feed.xml の <updated> の日付部分
 * @returns {string}
 */
export function sitemap({ data, articles = [], devlog = [], manuals = [], stamps = {}, feedUpdated = '' }) {
  const at = (key) => stamps[key] || '';
  const entries = [urlEntry(`${SITE}/`, at('/'), 'weekly', '1.0')];

  /* 紹介ページの一覧。記事が増えるたびに変わる */
  if (articles.length) {
    entries.push(urlEntry(`${SITE}/apps/`, at('/apps/'), 'weekly', '0.9'));
    /* フィードも載せておく。更新の速いページとしてクローラに拾わせる。
       ⚠️ 日付は feed.xml 自身の <updated> と同じにする。食い違うと、
          サイトマップとフィードのどちらを信じればいいのか分からなくなる。 */
    entries.push(urlEntry(`${SITE}/feed.xml`, feedUpdated, 'daily', '0.5'));
  }
  /* 教科・分野ごとの入口。「国語 アプリ 小学校」で探している人の着地点になる。
     トップページの絞り込み（?cat=）は JavaScript が要るうえ、行き先が
     トップページ 1 枚なので、検索の受け皿にならない */
  Object.keys(CATEGORY_LABEL).forEach((id) => {
    const path = `/${CATEGORY_BASE}/${id}/`;
    /* 書き出されていない分野（アプリが 1 本も無い）は載せない。
       載せると、消したページが 404 のままサイトマップに並ぶ。 */
    if (!at(path)) return;
    entries.push(urlEntry(`${SITE}${path}`, at(path), 'weekly', '0.7'));
  });
  /* 校内のフィルタリングの一覧。「アプリ名 フィルタリング 許可」で探す
     情報担当の先生の着地点になる */
  entries.push(urlEntry(`${SITE}/filtering/`, at('/filtering/'), 'weekly', '0.6'));
  /* 開発記録。読み手が違う（生成 AI でアプリを作っている人）ので、
     アプリの一覧より低い優先度にしてある。
     ⚠️ 公開されている記事だけを載せる。下書きを載せると 404 が並ぶ */
  for (const e of devlog) {
    entries.push(urlEntry(`${SITE}/devlog/${e.slug}/${e.name}/`, e.date, 'yearly', '0.4'));
  }
  /* /devlog/ は 0 本でも存在する。全ページのフッターが張ってあるので、
     build-devlog.mjs が空の入口だけは必ず書く（あちらのコメントと対）。
     日付は載っている記事のいちばん新しいもの。0 本なら日付を出さない。 */
  entries.push(urlEntry(`${SITE}/devlog/`, newestDate(devlog), 'weekly', '0.5'));
  if (devlog.length) {
    for (const slug of [...new Set(devlog.map((e) => e.slug))].sort()) {
      entries.push(urlEntry(`${SITE}/devlog/${slug}/`,
        newestDate(devlog.filter((e) => e.slug === slug)), 'monthly', '0.4'));
    }
  }
  /* 自己紹介。だれがつくっているのかは、学校で使うかどうかの判断材料になる。
     どの道具も書き出していないので、台帳がファイルの中身を直に見ている */
  entries.push(urlEntry(`${SITE}/profile/`, at('/profile/'), 'monthly', '0.5'));
  /* 掲載用の資料。めったに変わらないが、媒体の担当者に見つけてほしい */
  entries.push(urlEntry(`${SITE}/press/`, at('/press/'), 'monthly', '0.4'));

  /* 紹介ページ。アプリ本体より先に置く。中身のある文章はこちらにある。
     ⚠️ lastmod は note 記事の markdown が最後に変わった日で、アプリの push 日ではない
        （tools/build-articles.mjs と tools/lib/gh.mjs の ghFileChangedAt を見ること）。 */
  articles
    .filter((a) => a.slug)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach((a) => {
      entries.push(urlEntry(`${SITE}/apps/${a.slug}/`, a.updatedAt || '', 'monthly', '0.9'));
    });

  /* 使い方マニュアル。紹介ページより少し低い重み。
     ⚠️ lastmod は manual.md が最後に変わった日で、アプリの push 日ではない
        （tools/build-manuals.mjs を見ること）。 */
  manuals
    .filter((m) => m.slug)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach((m) => {
      entries.push(urlEntry(`${SITE}/apps/${m.slug}/manual/`, m.updatedAt || '', 'monthly', '0.7'));
    });

  /* アプリ本体。changedAt は正本配布のコミットを除いた最後の更新日。
     ⚠️ updatedAt（リポジトリの push 日）は使わない。auto-distribute が
        42 本へ一斉に配るので、全部が同じ日に揃ってしまう。
        changedAt が取れなかったものは lastmod を出さない。 */
  data.items
    .filter((i) => shown(i) && i.slug)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach((i) => {
      entries.push(urlEntry(`https://${i.slug}.giga-school.com/`, i.changedAt || '', 'monthly',
        i.kind === 'app' ? '0.8' : '0.6'));
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- tools/sync-updates.mjs が data/apps.json から書き出す。手で書き足さない。 -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}
