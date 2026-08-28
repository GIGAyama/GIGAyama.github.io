/**
 * 開発記録のページ（/devlog/）を組み立てる。
 *
 * ── 何のためのページか ────────────────────────────
 *
 * 読み手は、生成 AI でアプリを作っている人と、このアプリを使ってどう作ったか
 * 知りたい人。**先生向けではない。**
 *
 * 紹介ページ（/apps/<slug>/）は「使ってみませんか」だが、こちらは「こうやりました」。
 * 出したプロンプトをそのまま載せるので、読んだ人が自分のリポジトリで同じことをできる。
 *
 * ── どこから来るか ──────────────────────────────
 *
 * アプリ側の docs/devlog/*.md。紹介記事（docs/note/*-note-article.md）と同じで、
 * 毎朝 tools/build-devlog.mjs が GitHub API で取ってきて、ここで HTML にする。
 * 書き手は standards/skills/devlog-article/ のスキルで書く。
 *
 * ⚠️ front matter の published: true のものだけが来る。ここでは絞らない。
 *    絞るのは build-devlog.mjs の仕事で、二重にやると片方を直したときに食いちがう。
 *
 * ── トップページには出さない ────────────────────
 *
 * 先生がアプリを選ぶ列に、開発の話を混ぜない。入口はフッターと、
 * 各紹介ページの末尾と、自己紹介のページ。
 */

import { esc } from './article-md.mjs';
import { tocOf, readingOf } from './article-toc.mjs';
import { shareOf } from './article-share.mjs';
import { FOOTER, HEADER, OG_FALLBACK, SITE, THEME_SCRIPT } from './article-page.mjs';

export const DEVLOG_BASE = 'devlog';
export const devlogUrl = (slug, name) =>
  `${SITE}/${DEVLOG_BASE}/` + (slug ? `${slug}/` : '') + (name ? `${name}/` : '');

/** 日付を「2026/08/24」の形に。記事の中では和暦にしない */
const jp = (d) => String(d ?? '').replace(/-/g, '/');

/** ページの外枠。3 種類とも同じなので 1 か所にまとめる */
function shell({ title, description, url, body, extraHead = '' }) {
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

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="GIGA school">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${OG_FALLBACK}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="stylesheet" href="/assets/style.css">
${THEME_SCRIPT}
${extraHead}
</head>

<body>
${HEADER}

${body}

${FOOTER}
</body>

</html>
`;
}

/**
 * 1 本の記事の見出し行。一覧でも記事の頭でも使う。
 *
 * ⚠️ .article__len は ::before で「・」を出す。紹介ページと同じく
 *    .article__meta の中に入れること。別の p にすると、行の頭に「・」だけが落ちる。
 */
function metaLine(e) {
  const bits = [`<time datetime="${e.date}">${jp(e.date)}</time>`];
  if (e.appName) bits.push(`<a href="/${DEVLOG_BASE}/${e.slug}/">${esc(e.appName)}</a>`);
  if (e.stat) bits.push(`${e.stat.files} ファイル ＋${e.stat.additions} −${e.stat.deletions}`);
  return bits.join('<span aria-hidden="true"> ・ </span>');
}

/**
 * 記事 1 本。
 *
 * @param {{entry: object, html: string, headings: object[], prev?: object, next?: object}} input
 */
export function devlogPost({ entry, html, headings, prev, next }) {
  const url = devlogUrl(entry.slug, entry.name);
  const toc = tocOf(headings);
  const { minutes } = readingOf(html);
  /* 紹介記事と同じ枠。広い画面では本文の右の柱になる */
  const rail = `    <aside class="article__rail" aria-label="この記事の案内">
${toc}${shareOf({ url, title: entry.title })}    </aside>

`;

  /* PR があれば、差分の規模と行き先を添える。本文では繰り返さない約束にしてある */
  const source = entry.pr
    ? `      <p class="devlog__source">
        この記事のもとになった変更は
        <a href="https://github.com/GIGAyama/${esc(entry.repo)}/pull/${entry.pr}">${esc(entry.repo)} #${entry.pr}</a>
        です。
      </p>\n`
    : '';

  const nav = (prev || next) ? `    <nav class="devlog__nav" aria-label="このアプリのほかの記録">
${prev ? `      <a class="devlog__nav-item" href="/${DEVLOG_BASE}/${prev.slug}/${prev.name}/"><span>前の記録</span>${esc(prev.title)}</a>\n` : ''}${next ? `      <a class="devlog__nav-item" href="/${DEVLOG_BASE}/${next.slug}/${next.name}/"><span>次の記録</span>${esc(next.title)}</a>\n` : ''}    </nav>\n` : '';

  const body = `  <main class="wrap article article--read">
    <nav class="crumbs" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
      <a href="/${DEVLOG_BASE}/">開発記録</a>
      <span aria-hidden="true">›</span>
      <a href="/${DEVLOG_BASE}/${entry.slug}/">${esc(entry.appName)}</a>
    </nav>

    <header class="article__head">
      <h1 class="article__title">${esc(entry.title)}</h1>
      <p class="article__meta">${metaLine(entry)}<span class="article__len">読むのに約 ${minutes} 分</span></p>
    </header>

${rail}    <div class="prose prose--article">
${html}
    </div>

${source}${nav}    <div class="article__end">
      <p class="devlog__back">
        ${entry.isSite
          ? '<a class="btn btn--primary" href="/">アプリの一覧を見る</a>'
          : `<a class="btn btn--primary" href="https://${entry.slug}.giga-school.com/">${esc(entry.appName)}を開く</a>`}
        ${entry.hasArticle ? `<a class="btn btn--ghost" href="/apps/${entry.slug}/">使い方の紹介を読む</a>` : ''}
        <a class="btn btn--ghost" href="/${DEVLOG_BASE}/">ほかの開発記録</a>
      </p>
    </div>
  </main>`;

  return shell({
    title: entry.title,
    description: entry.summary || `${entry.appName}の開発記録。出したプロンプトと、うまくいかなかったこと、そこで新しく知ったことを書いています。`,
    url,
    body,
  });
}

/** 一覧に並べる 1 行。トップの一覧でもアプリごとの一覧でも同じ形を使う */
const row = (e, { showApp }) => `        <li class="devlog-item">
          <p class="devlog-item__top">${showApp ? `<span class="devlog-item__app">${esc(e.appName)}</span>` : ''}<time datetime="${e.date}">${jp(e.date)}</time></p>
          <h3 class="devlog-item__title"><a href="/${DEVLOG_BASE}/${e.slug}/${e.name}/">${esc(e.title)}</a></h3>
          ${e.summary ? `<p class="devlog-item__lead">${esc(e.summary)}</p>` : ''}
        </li>`;

/**
 * アプリ 1 本ぶんの一覧。
 * ⚠️ 古い順に並べる。開発記録は成長の記録として読めるほうがよいので、
 *    ここだけはトップの一覧（新しい順）と向きが逆になる。
 */
export function devlogApp({ slug, appName, entries, hasArticle, isSite }) {
  const url = devlogUrl(slug);
  const asc = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const body = `  <main class="wrap article">
    <nav class="crumbs" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
      <a href="/${DEVLOG_BASE}/">開発記録</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">${esc(appName)}</span>
    </nav>

    <header class="article__head">
      <h1 class="article__title">${esc(appName)}のつくり方</h1>
      <p class="article__meta">記録 ${entries.length} 本。古い順に並べています。</p>
      <p class="article__actions">
        ${isSite
          ? '<a class="btn btn--primary" href="/">アプリの一覧を見る</a>'
          : `<a class="btn btn--primary" href="https://${slug}.giga-school.com/">アプリを開く</a>`}
        ${hasArticle ? `<a class="btn btn--ghost" href="/apps/${slug}/">使い方の紹介を読む</a>` : ''}
      </p>
    </header>

    <h2 class="cat-title">記録</h2>
    <ul class="devlog-list">
${asc.map((e) => row(e, { showApp: false })).join('\n')}
    </ul>
  </main>`;

  return shell({
    title: `${appName}のつくり方`,
    description: `${appName}をどう作ったかの記録 ${entries.length} 本。出したプロンプトと、うまくいかなかったことを書いています。`,
    url,
    body,
  });
}

/** 全体の入口。新しい順 */
export function devlogIndex({ entries, byApp }) {
  const desc = '小学校の教員が、生成 AI を使って学校向けの Web アプリを作った記録です。'
    + '出したプロンプトをそのまま載せているので、同じことを試せます。';
  const body = `  <main class="wrap article">
    <nav class="crumbs" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">開発記録</span>
    </nav>

    <header class="article__head">
      <h1 class="article__title">開発記録</h1>
      <p class="article__meta">${entries.length ? `記録 ${entries.length} 本 ・ アプリ ${byApp.length} 本` : '準備中'}</p>
    </header>

    <div class="prose prose--article">
      <p>学校向けの Web アプリを、生成 AI を使って作っています。ここはその記録です。
        出したプロンプトをそのまま載せているので、同じことを自分のリポジトリで試せます。</p>
      <p>うまくいったことだけでなく、行き止まりも書いています。
        そちらのほうが、次に同じことをする人の役に立つと思うからです。</p>
      <p>アプリそのものを探しに来た方は<a href="/">アプリの一覧</a>へ、
        使い方を知りたい方は<a href="/apps/">紹介の記事</a>へどうぞ。</p>
    </div>

${entries.length ? `    <h2 class="cat-title">アプリごとに読む</h2>
    <ul class="cat-apps">
${byApp.map((a) => `      <li class="cat-app">
        <a class="cat-app__open" href="/${DEVLOG_BASE}/${a.slug}/">${esc(a.appName)}</a>
        <span class="cat-app__note">${a.entries.length} 本</span>
      </li>`).join('\n')}
    </ul>

    <h2 class="cat-title">新しい順に読む</h2>
    <ul class="devlog-list">
${entries.map((e) => row(e, { showApp: true })).join('\n')}
    </ul>` : `    <h2 class="cat-title">いまは 1 本もありません</h2>
    <div class="prose prose--article">
      <p>公開している記録がまだありません。書いたものは毎朝ここに並びます。</p>
    </div>`}
  </main>`;

  return shell({ title: '開発記録', description: desc, url: devlogUrl(), body });
}
