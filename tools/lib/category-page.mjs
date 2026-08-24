/**
 * 教科・分野ごとの入口ページ（/apps/category/<id>/）を組み立てる。
 *
 * ── なぜ静的なページにするのか ──────────────────────
 *
 * トップページには絞り込みがあり、`/?cat=kokugo#apps` を開けば国語のものだけが出る。
 * ただしあれは JavaScript が動いてはじめて効くうえ、行き先はトップページ 1 枚である。
 *
 * つまり「国語 アプリ 小学校」で探している人が着地する場所が無い。
 * 検索の結果に出るのはトップページで、そこには 38 本すべてが並んでいる。
 *
 * 分類ごとにページを分けると、
 *   - JavaScript が無くても分類だけを見られる（絞り込みは JS が要る）
 *   - 紹介の一覧（/apps/）から、押せる入口として並べられる
 *   - 検索から直接その分類に着地できる
 * の 3 つが、同じ 1 つの仕組みで片づく。
 *
 * ── 薄いページを作らないための工夫 ────────────────────
 *
 * 紹介記事だけを並べると、記事が 1 本しかない分類（表現・制作）が
 * 中身のないページになる。そこで、その分類のアプリ（data/apps.json）と
 * 紹介記事（data/articles.json）の両方を載せる。
 * アプリはあるが記事はまだ無い、という分類でもページとして成り立つ。
 */

import { esc } from './article-md.mjs';
import { CATEGORY_LABEL, CATEGORY_COLOR } from './categories.mjs';
import { FOOTER, HEADER, OG_FALLBACK, SITE, THEME_SCRIPT, headlineOf } from './article-page.mjs';

/** 分類ページの置き場所。/apps/<slug>/ と混ざらないよう、1 階層はさむ。 */
export const CATEGORY_BASE = 'apps/category';

export const categoryUrl = (id) => `${SITE}/${CATEGORY_BASE}/${id}/`;

/**
 * その分類に何があるかを数える。
 * @param {object[]} apps data/apps.json の items
 * @param {object[]} articles data/articles.json の items
 * @returns {Map<string, {apps: object[], articles: object[]}>}
 */
export function groupByCategory(apps, articles) {
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  const out = new Map(Object.keys(CATEGORY_LABEL).map((id) => [id, { apps: [], articles: [] }]));

  for (const a of apps) {
    if (a.hidden === true || !a.slug) continue;
    const id = CATEGORY_LABEL[a.category] ? a.category : 'other';
    out.get(id).apps.push(a);
  }
  for (const a of articles) {
    const app = bySlug.get(a.slug);
    if (!app || app.hidden === true) continue;
    const id = CATEGORY_LABEL[app.category] ? app.category : 'other';
    out.get(id).articles.push({ ...a, app });
  }

  for (const g of out.values()) {
    g.apps.sort((x, y) => String(x.name).localeCompare(String(y.name), 'ja'));
    g.articles.sort((x, y) => (y.app.publishedAt || '').localeCompare(x.app.publishedAt || ''));
  }
  return out;
}

/** ほかの分類へ渡る行。いまいる分類は押せないままにして、現在地を示す。 */
function others(current, groups) {
  return Object.entries(CATEGORY_LABEL).map(([id, label]) => {
    const n = groups.get(id).apps.length;
    if (id === current) {
      return `<span class="chip chip--plain" aria-current="page">${esc(label)}`
        + `<span class="count">${n}</span></span>`;
    }
    return `<a class="chip" href="/${CATEGORY_BASE}/${id}/">${esc(label)}`
      + `<span class="count">${n}</span></a>`;
  }).join('');
}

/**
 * 分類ページ 1 枚。
 *
 * @param {object} o
 * @param {string} o.id 分類の id（kokugo など）
 * @param {Map} o.groups groupByCategory() の結果
 * @param {string} o.generatedAt
 * @returns {string}
 */
export function categoryPage({ id, groups, generatedAt }) {
  const label = CATEGORY_LABEL[id];
  const color = CATEGORY_COLOR[id] || CATEGORY_COLOR.other;
  const { apps, articles } = groups.get(id);
  const url = categoryUrl(id);
  const title = `${label}のアプリ（${apps.length} 本）`;
  const description = articles.length
    ? `小学校の教員がつくった「${label}」の Web アプリ ${apps.length} 本と、`
      + `つくった理由と使い方をまとめた紹介記事 ${articles.length} 本の一覧です。`
    : `小学校の教員がつくった「${label}」の Web アプリ ${apps.length} 本の一覧です。`;

  const appRows = apps.map((a) => `        <li class="cat-app">
          <a class="cat-app__open" href="https://${a.slug}.giga-school.com/">${esc(a.name)}</a>
          ${articles.some((x) => x.slug === a.slug)
            ? `<a class="cat-app__note" href="/apps/${a.slug}/">紹介を読む</a>` : ''}
        </li>`).join('\n');

  const articleRows = articles.map((a) => `        <li class="article-item" style="--cat:${color}">
          <a class="article-item__media" href="/apps/${a.slug}/" tabindex="-1" aria-hidden="true">
            <img src="/assets/thumbs/${a.slug}-1.webp" alt="" width="640" height="400" loading="lazy" decoding="async">
          </a>
          <div class="article-item__body">
            <p class="article-item__top">
              <span class="article-item__app">${esc(a.name)}</span>
            </p>
            <h2 class="article-item__title"><a href="/apps/${a.slug}/">${esc(headlineOf(a.title))}</a></h2>
            <p class="article-item__lead">${esc(a.summary)}</p>
            <p class="article-item__meta">
              <time datetime="${a.app.publishedAt}">${a.app.publishedAt.replace(/-/g, '/')}</time>
              <span>公開</span>
            </p>
          </div>
        </li>`).join('\n');

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        name: title,
        description,
        inLanguage: 'ja',
        url,
        isPartOf: { '@id': `${SITE}/#website` },
        dateModified: generatedAt,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: apps.length,
          itemListElement: apps.map((a, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: a.name,
            url: `https://${a.slug}.giga-school.com/`,
          })),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'GIGA school', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: '紹介', item: `${SITE}/apps/` },
          { '@type': 'ListItem', position: 3, name: label, item: url },
        ],
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}｜GIGA school</title>
  <meta name="description" content="${esc(description)}">
  <meta name="author" content="GIGAyama">
  <meta name="theme-color" content="#ffffff">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${url}">

  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="alternate" type="application/atom+xml" title="GIGA school の更新" href="/feed.xml">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GIGA school">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${OG_FALLBACK}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="stylesheet" href="/assets/style.css">
${THEME_SCRIPT}

  <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
  </script>
</head>

<body>
${HEADER}

  <main class="wrap article">
    <nav class="crumbs" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
      <a href="/apps/">紹介</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">${esc(label)}</span>
    </nav>

    <header class="article__head">
      <h1 class="article__title">${esc(label)}のアプリ</h1>
      <p class="article__meta">
        ${apps.length} 本あります。${articles.length ? `そのうち ${articles.length} 本には、つくった理由と使い方を書いた紹介があります。` : ''}
      </p>
      <p class="article__actions">
        <a class="btn btn--primary" href="/?cat=${id}#apps">画面写真つきで見る</a>
        <a class="btn btn--ghost" href="/apps/">紹介の一覧へ</a>
      </p>
    </header>

    <h2 class="cat-title">この分類のアプリ</h2>
    <ul class="cat-apps">
${appRows}
    </ul>

${articles.length ? `    <h2 class="cat-title">紹介</h2>
    <ul class="article-list">
${articleRows}
    </ul>
` : ''}
    <h2 class="cat-title">ほかの分類</h2>
    <div class="chips">${others(id, groups)}</div>
  </main>

${FOOTER}
</body>

</html>
`;
}
