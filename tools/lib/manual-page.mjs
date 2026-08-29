/**
 * 使い方マニュアルのページ（/apps/<slug>/manual/）を組み立てる。
 *
 * ── なぜ紹介記事と別のページにするのか ──────────────
 *
 * 各アプリのフッターにある「使い方を読む」の行き先は、長らく紹介記事だった。
 * あれは先生に向けて「なぜ作ったか」「教室でどう効くか」を書いたもので、
 * いま画面の前にいて「このボタンは何ですか」と困っている人が
 * 求めているものではない。
 *
 * 記事はそのまま残し、操作のためのページを別に置く。
 *
 * ── 骨組みは紹介ページから借りる ────────────────────
 *
 * ヘッダー・フッター・テーマの先読み・目次・本文の見た目は、
 * article-page.mjs と article-toc.mjs のものをそのまま使う。
 *
 * ⚠️ .prose--article を複製しないこと。本文の見た目が 2 か所に散ると、
 *    朝の組み直しで記事とマニュアルが別々に崩れる。
 *
 * ── 印刷が本命 ────────────────────────────────
 *
 * マニュアルは職員室で紙に刷って配られる。/filtering/ と同じ考え方で、
 * @media print でヘッダー・フッター・操作用のボタンを落としてある。
 * 紙になったときに戻ってこられるよう、URL を本文の末尾に置く
 * （画面では出さない）。
 *
 * ── 「学校で使うときは」は機械が足す ─────────────────
 *
 * 許可するアドレス・アカウントの要否・記録の置き場は data/apps.json にある。
 * 書き手に手で書かせると /filtering/ と食い違い、「許可申請は通ったのに
 * 開かない」といういちばん困る形になる。だからここで組む。
 * 書き手の側では giga-manual スキルの lint が「書かないこと」を見ている。
 */

import { esc } from './article-md.mjs';
import { readingOf, tocOf, withAnchors } from './article-toc.mjs';
import { changelogSection, changesOf } from './changelog.mjs';
import { ACCOUNT_LABEL, STORAGE_LABEL, gradeLabel } from './categories.mjs';
import { HOST_INFO, LEVEL_LABEL, hostsOf } from './hosts.mjs';
import { FOOTER, HEADER, OG_FALLBACK, SITE, THEME_SCRIPT, summaryOf } from './article-page.mjs';

/** URL の最後の一区切り。ここを変えると外から張られたリンクが切れる。 */
export const MANUAL_BASE = 'manual';

export const manualUrl = (slug) => `${SITE}/apps/${slug}/${MANUAL_BASE}/`;

/** 題。書き手が何と書いていても、一覧では同じ形にそろえる。 */
export const manualTitleOf = (name) => `${name} の使い方`;

/**
 * 「学校で使うときは」の節。data/apps.json から組む。
 *
 * ⚠️ ここに書いてあることは /filtering/ と同じ出どころ（tools/lib/hosts.mjs）
 *    から来る。片方だけ手で書くと、学校が的外れな許可申請を出すことになる。
 *
 * @param {object} app data/apps.json の 1 件
 * @returns {string}
 */
export function schoolSection(app) {
  const rows = hostsOf(app).map((host) => {
    const info = HOST_INFO[host] ?? { level: 'must', why: 'アプリを配っている場所' };
    return `        <li><code>${esc(host)}</code>`
      + `<span class="manual__why">${esc(info.why)}</span>`
      + `<span class="manual__level manual__level--${esc(info.level)}">`
      + `${esc(LEVEL_LABEL[info.level] ?? '')}</span></li>`;
  }).join('\n');

  /* 書いていない項目は出さない。「まだ決めていない」を「不要」と
     読ませると、学校が誤った前提で導入を決めることになる。 */
  const facts = [
    ACCOUNT_LABEL[app.account] ? ['アカウント', ACCOUNT_LABEL[app.account]] : null,
    STORAGE_LABEL[app.storage] ? ['記録の置き場所', STORAGE_LABEL[app.storage]] : null,
    gradeLabel(app.grades) ? ['対象', gradeLabel(app.grades)] : null,
  ].filter(Boolean);

  return `    <section class="manual__school" aria-labelledby="school-title">
      <h2 id="school-title">学校で使うときは</h2>
      <p class="manual__school-lead">ここは <a href="/">giga-school.com</a> が
        アプリの設定から組み立てています。マニュアルの書き手が手で書いたものではないので、
        アプリが変われば、ここも変わります。</p>
${facts.length ? `      <dl class="manual__facts">
${facts.map(([k, v]) => `        <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
      </dl>\n` : ''}      <h3>校内のフィルタリングで許可するアドレス</h3>
      <ul class="manual__hosts">
${rows}
      </ul>
      <p class="manual__school-more">ほかのアプリとまとめて申請するときは、
        <a href="/filtering/">許可するアドレスの一覧</a>が使えます（印刷できます）。</p>
    </section>

`;
}

/**
 * マニュアルのページ 1 枚。
 *
 * @param {object} o
 * @param {object} o.app          data/apps.json の 1 件
 * @param {{title: string, html: string, images: object[], lead: string}} o.manual
 * @param {boolean} [o.hasArticle] 紹介記事があるか。無ければパンくずも導線も出さない
 * @param {string} [o.ogCard]
 * @param {string} [o.changelog]
 * @param {string} [o.privacyUrl] 実際に届くと確かめられたときだけ渡す
 * @param {string} [o.termsUrl]
 * @param {string} [o.updatedAt]  manual.md が最後に変わった日
 * @returns {string}
 */
export function manualPage({ app, manual, hasArticle = false, ogCard = '', changelog = '',
                             privacyUrl = '', termsUrl = '', updatedAt = '' }) {
  const url = manualUrl(app.slug);
  const appUrl = `https://${app.slug}.giga-school.com/`;
  const title = manualTitleOf(app.name);
  const summary = summaryOf(manual.lead || `${app.name} の使い方をまとめたページです。`);
  const day = updatedAt || app.updatedAt;

  /* og:image は 1 枚目の画面写真。ただし raw.githubusercontent.com のものは
     使わない（SNS のクローラが取りに行けないことがある）。article-page.mjs と同じ判断。 */
  const first = manual.images[0]?.src || '';
  const ownHost = /^https:\/\/([a-z0-9-]+\.)?giga-school\.com\//.test(first);
  const ogImage = ownHost ? first : (ogCard || OG_FALLBACK);

  const { html: body, headings } = withAnchors(manual.html);
  const toc = tocOf(headings);
  const reading = readingOf(body);
  const steps = headings.filter((h) => h.level === 2).length;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        /* HowTo ではなく TechArticle。HowTo は「1 本の手順」を表すもので、
           マニュアルは手順の集まりなので当てはまらない。 */
        '@type': 'TechArticle',
        '@id': `${url}#manual`,
        headline: title,
        description: summary,
        image: ogImage,
        inLanguage: 'ja',
        proficiencyLevel: 'Beginner',
        datePublished: app.publishedAt,
        dateModified: day,
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
          { '@type': 'ListItem', position: 2, name: '紹介', item: `${SITE}/apps/` },
          /* 紹介記事の無いアプリでは、そこへのパンくずを出さない。
             /apps/<slug>/ が存在しないので、押すと 404 になる。 */
          ...(hasArticle
            ? [{ '@type': 'ListItem', position: 3, name: app.name, item: `${SITE}/apps/${app.slug}/` },
               { '@type': 'ListItem', position: 4, name: '使い方', item: url }]
            : [{ '@type': 'ListItem', position: 3, name: title, item: url }]),
        ],
      },
    ],
  };

  const crumbs = hasArticle
    ? `      <a href="/apps/">紹介</a>
      <span aria-hidden="true">›</span>
      <a href="/apps/${app.slug}/">${esc(app.name)}</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">使い方</span>`
    : `      <a href="/apps/">紹介</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">${esc(title)}</span>`;

  /* 右の柱。記事では「伝える」（SNS へ）を置いているが、マニュアルは
     人に送るものではなく手元で使うものなので、印刷とコピーに替える。 */
  const rail = `    <aside class="article__rail" aria-label="このページの案内">
${toc}      <div class="manual__tools no-print">
        <button type="button" class="btn btn--ghost" data-print>印刷する</button>
        <button type="button" class="btn btn--ghost" data-copy="${esc(url)}"
                data-copy-label="このページのリンク">リンクをコピー</button>
      </div>
    </aside>

`;

  /* 利用規約とプライバシーポリシーは、届くと確かめられたものだけ出す。
     推測で出すと、押した先が 404 になる。 */
  const legal = [
    termsUrl ? `<a href="${esc(termsUrl)}" rel="noopener">利用規約</a>` : '',
    privacyUrl ? `<a href="${esc(privacyUrl)}" rel="noopener">プライバシーポリシー</a>` : '',
  ].filter(Boolean);

  const legalBlock = legal.length ? `      <p class="manual__legal">${app.name} の
        ${legal.join('と')}も読めます。</p>\n` : '';

  const articleLink = hasArticle
    ? `        <a class="btn btn--ghost" href="/apps/${app.slug}/">つくった理由を読む</a>\n`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}｜GIGA school</title>
  <meta name="description" content="${esc(summary)}">
  <meta name="author" content="GIGAyama">
  <meta name="theme-color" content="#ffffff">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${url}">

  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GIGA school">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(summary)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="stylesheet" href="/assets/style.css">
  <script src="/assets/article.js" defer></script>
  <script src="/assets/copy.js" defer></script>
${THEME_SCRIPT}

  <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
  </script>
</head>

<body>
${HEADER}

  <main class="wrap article article--read manual">
    <nav class="crumbs no-print" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
${crumbs}
    </nav>

    <header class="article__head">
      <p class="article__series">使い方マニュアル</p>
      <h1 class="article__title">${esc(title)}</h1>
      <p class="article__meta">
        <time datetime="${day}">${day.replace(/-/g, '/')}</time> 現在の画面です
        <span class="article__len">全 ${steps} 章・読むのに約 ${reading.minutes} 分</span>
      </p>
      <p class="article__actions no-print">
        <a class="btn btn--primary" href="${appUrl}">${esc(app.name)} を開く</a>
${articleLink}      </p>
    </header>

${rail}    <div class="prose prose--article">
${body}
    </div>

${schoolSection(app)}${changelogSection(changesOf(changelog), esc)}    <!-- 紙に刷って回覧されたとき、ここへ戻ってこられる唯一の手がかり。
         画面では出さない（すぐ上のアドレスバーに同じものが出ている） -->
    <p class="manual__url">このマニュアルは ${url} にあります（${day.replace(/-/g, '/')} 現在）</p>

    <!-- 狭い画面でだけ、読んでいるあいだ下に貼り付く。マニュアルは
         アプリを触りながら読むものなので、記事より効く -->
    <p class="article__sticky no-print">
      <a class="btn btn--primary" href="${appUrl}">${esc(app.name)} を開く</a>
    </p>

    <aside class="article__end no-print">
      <p class="article__end-lead">${esc(app.name)} は、ブラウザだけで動く無償のアプリです。</p>
${legalBlock}      <p class="article__actions">
        <a class="btn btn--primary" href="${appUrl}">${esc(app.name)} を開く</a>
        <a class="btn btn--ghost" href="/#contact">うまくいかないときは</a>
      </p>
    </aside>
  </main>

${FOOTER}
</body>

</html>
`;
}
