/**
 * 記事 1 本ぶんのページを組み立てる。
 *
 * 骨組み（ヘッダー・フッター・テーマの先読み）は 404.html にそろえてある。
 * トップページのヘッダーには検索と絞り込みが載っているが、あれは app.js が要る。
 * 記事のページでは使わないので、404.html と同じ「ロゴだけ」の形にする。
 */

import { esc } from './article-md.mjs';

/** 記事の題につけてある連載名。ページでは見出しから外し、上に小さく添える。 */
export const SERIES_RE = /^教室で使えるかもしれないもの作り\s*#\S*\s*/;

export const SITE = 'https://giga-school.com';
const OG_FALLBACK = `${SITE}/assets/og.png`;

/** 題から連載名を外す。外れなければそのまま使う。 */
export const headlineOf = (title) => String(title).replace(SERIES_RE, '').trim() || String(title).trim();

/** 説明文。長すぎると検索結果で切られるので、句点で切って整える。 */
export function summaryOf(lead, limit = 110) {
  const s = String(lead).replace(/\s+/g, ' ').trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('、'));
  return (at > limit * 0.5 ? cut.slice(0, at + 1) : cut) + '…';
}

const HEADER = `  <header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="/" aria-label="GIGA school トップページ">
        <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M24.66 11A10 10 0 1 0 25.9 17.39" fill="none" stroke="var(--brand)"
                stroke-width="3.8" stroke-linecap="round"/>
          <path d="M17 17.39h8.9" fill="none" stroke="var(--accent)"
                stroke-width="3.8" stroke-linecap="round"/>
        </svg>
        <span class="brand__text">
          <span class="brand__name"><b>GIGA</b> school</span>
          <span class="brand__sub">学校で使える Web アプリ</span>
        </span>
      </a>
    </div>
  </header>`;

const FOOTER = `  <footer class="site-footer">
    <div class="wrap site-footer__inner">
      <div class="site-footer__meta"><strong>GIGA school</strong><span>学校で使える Web アプリ</span></div>
      <nav class="site-footer__links" aria-label="フッター">
        <a href="/#apps">アプリ</a>
        <a href="/#about">このサイトについて</a>
        <a href="/#contact">お問い合わせ</a>
      </nav>
    </div>
  </footer>`;

/* 表示前にテーマを決め、切り替え時のちらつきを防ぐ。index.html・404.html と同じもの。 */
const THEME_SCRIPT = `  <script>
    (function () {
      try {
        var t = localStorage.getItem('giga-school:theme');
        if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  </script>`;

/**
 * @param {object} o
 * @param {{name: string, slug: string, repo: string, publishedAt: string, updatedAt: string}} o.app
 * @param {{title: string, html: string, images: object[], lead: string}} o.article
 * @returns {string} ページ 1 枚ぶんの HTML
 */
export function articlePage({ app, article }) {
  const url = `${SITE}/apps/${app.slug}/`;
  const appUrl = `https://${app.slug}.giga-school.com/`;
  const headline = headlineOf(article.title);
  const summary = summaryOf(article.lead);
  /* og:image は記事の 1 枚目。中身が見えるカードになる。
     画像が 1 枚も無いときだけ、サイト共通の絵に落とす。 */
  const ogImage = article.images[0]?.src || OG_FALLBACK;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline,
        description: summary,
        image: ogImage,
        inLanguage: 'ja',
        datePublished: app.publishedAt,
        dateModified: app.updatedAt,
        author: { '@id': `${SITE}/#person` },
        publisher: { '@id': `${SITE}/#person` },
        mainEntityOfPage: url,
        about: {
          '@type': 'WebApplication',
          name: app.name,
          url: appUrl,
          operatingSystem: 'Web ブラウザ',
          inLanguage: 'ja',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'GIGA school', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'アプリ', item: `${SITE}/#apps` },
          { '@type': 'ListItem', position: 3, name: app.name, item: url },
        ],
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(headline)}｜GIGA school</title>
  <meta name="description" content="${esc(summary)}">
  <meta name="author" content="GIGAyama">
  <meta name="theme-color" content="#ffffff">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${url}">

  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="GIGA school">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(headline)}">
  <meta property="og:description" content="${esc(summary)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="article:published_time" content="${app.publishedAt}">
  <meta property="article:modified_time" content="${app.updatedAt}">
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
      <a href="/#apps">アプリ</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">${esc(app.name)}</span>
    </nav>

    <header class="article__head">
      <p class="article__series">教室で使えるかもしれないもの作り</p>
      <h1 class="article__title">${esc(headline)}</h1>
      <p class="article__meta">
        <time datetime="${app.updatedAt}">${app.updatedAt.replace(/-/g, '/')}</time> 現在
      </p>
      <p class="article__actions">
        <a class="btn btn--primary" href="${appUrl}">${esc(app.name)} を開く</a>
        <a class="btn btn--ghost" href="https://github.com/GIGAyama/${esc(app.repo)}" rel="noopener">コードを見る</a>
      </p>
    </header>

    <div class="prose prose--article">
${article.html}
    </div>

    <aside class="article__end">
      <p class="article__end-lead">${esc(app.name)} は、ブラウザだけで動く無償のアプリです。</p>
      <p class="article__actions">
        <a class="btn btn--primary" href="${appUrl}">${esc(app.name)} を開く</a>
        <a class="btn btn--ghost" href="/#apps">ほかのアプリを見る</a>
      </p>
    </aside>
  </main>

${FOOTER}
</body>

</html>
`;
}

/**
 * トップページのカードから、紹介ページへのリンクを貼り直す。
 *
 * カードは index.html に直接書いてあるので、手で足すこともできる。
 * それをしないのは、アプリが増えたときに片方だけ古くなるため。
 * 記事のある slug の一覧を渡して、毎回まるごと貼り直す。
 *
 * 目印は class="card__note"。これが付いたリンクだけを外して入れ直すので、
 * 何度走らせても同じ形になる。
 */
export function linkCards(html, slugs) {
  const CARD = /<li class="card"[\s\S]*?<\/li>/g;
  let added = 0;

  const next = html.replace(CARD, (card) => {
    // どのアプリのカードかは「開く」のリンク先で見分ける
    const m = card.match(/class="card__open" href="https:\/\/([a-z0-9-]+)\.giga-school\.com\//);
    const slug = m?.[1];

    // 以前に貼ったものを、まず外す
    let out = card.replace(/\s*<a class="card__note"[\s\S]*?<\/a>/g, '');
    if (!slug || !slugs.has(slug)) return out;

    const link = `<a class="card__note" href="/apps/${slug}/">`
      + '<svg class="ic" aria-hidden="true" focusable="false"><use href="#i-book"/></svg>しょうかい</a>';

    // card__foot の先頭に置く。プライバシーや利用規約より先に読ませたい
    const at = out.indexOf('<p class="card__foot">');
    if (at === -1) return out;
    const insert = at + '<p class="card__foot">'.length;
    added++;
    return out.slice(0, insert) + '\n              ' + link + out.slice(insert);
  });

  return { html: next, added };
}
