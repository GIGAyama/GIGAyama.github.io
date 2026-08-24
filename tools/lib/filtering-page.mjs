/**
 * 校内のフィルタリングに出す「許可するアドレス」の一覧（/filtering/）。
 *
 * ── なぜ 1 枚にまとめるのか ────────────────────────
 *
 * 紹介記事 31 本のうち 29 本が、それぞれ「校内のフィルタリングで許可を」と
 * 書いている。ただし記事の中だけで、一覧はどこにも無かった。
 *
 * 先生が情報担当に申請を出すには、38 本の記事を開いて拾い集めることになる。
 * しかもアプリごとに要るものが違う。書体だけのもの、Google のログインが要るもの、
 * 端末どうしをつなぐもの。集め落とすと、許可が通ったのに開かない、という
 * いちばん困る形になる。
 *
 * ── 手で書かない ──────────────────────────────
 *
 * このページは data/apps.json から組み立てる。アプリが増えても手直しが要らず、
 * 記事の言い回しが変わっても中身がずれない。
 * tools/check-cards.mjs が、ページと data/apps.json が同じであることを見ている。
 *
 * ── 印刷して渡せるようにする ──────────────────────
 *
 * 情報担当とのやりとりは紙のことがある。@media print で、
 * ヘッダー・フッター・案内の枠を落とし、表だけが出るようにしてある。
 */

import { esc } from './article-md.mjs';
import { HOST_INFO, LEVEL_LABEL, hostsOf, sortHosts } from './hosts.mjs';
import { FOOTER, HEADER, OG_FALLBACK, SITE, THEME_SCRIPT } from './article-page.mjs';

export const FILTERING_URL = `${SITE}/filtering/`;

/** 塞いだときの影響の重い順。表の並びと、まとめの並びに使う */
const LEVELS = ['must', 'partial', 'look'];

/**
 * 使うアプリ全部で要るアドレスを、重なりを取り除いて集める。
 * 申請書に貼るのはこの一覧なので、重複していると読みにくい。
 *
 * @param {object[]} apps
 * @returns {{host: string, level: string, why: string, apps: string[]}[]}
 */
export function allHosts(apps) {
  const map = new Map();
  for (const a of apps) {
    for (const h of a.hosts ?? []) {
      if (!map.has(h)) map.set(h, []);
      map.get(h).push(a.name);
    }
  }
  return sortHosts([...map.keys()]).map((h) => ({
    host: h,
    level: HOST_INFO[h]?.level ?? 'must',
    why: HOST_INFO[h]?.why ?? '',
    apps: map.get(h),
  }));
}

/**
 * @param {{apps: object[], generatedAt: string}} input
 * @returns {string}
 */
export function filteringPage({ apps, generatedAt }) {
  const title = '校内のフィルタリングで許可するアドレス';
  const description = `giga-school.com のアプリ ${apps.length} 本を校内で使うために、`
    + 'フィルタリングで許可するアドレスの一覧です。アプリごとに要るものと、'
    + '塞いだときに何が起きるかを書いています。印刷して情報担当の先生にお渡しください。';

  const shared = allHosts(apps);
  const noExtra = apps.filter((a) => !(a.hosts ?? []).length);

  /* 申請書にそのまま貼れる形。アプリの数だけ並ぶので、まず自分のサブドメイン、
     次に共通で要るものを出す。1 行 1 アドレスにしておくと、
     たいていの申請書の様式にそのまま入る。 */
  const plain = [
    ...apps.map((a) => `${a.slug}.giga-school.com`),
    ...shared.map((h) => h.host),
  ].join('\n');

  const sharedRows = LEVELS.map((lv) => {
    const rows = shared.filter((h) => h.level === lv);
    if (!rows.length) return '';
    return `        <tr class="fl-head"><th colspan="3" scope="colgroup">${esc(LEVEL_LABEL[lv])}</th></tr>
${rows.map((h) => `        <tr>
          <td><code>${esc(h.host)}</code></td>
          <td>${esc(h.why)}</td>
          <td class="fl-count">${h.apps.length} 本</td>
        </tr>`).join('\n')}`;
  }).filter(Boolean).join('\n');

  const appRows = apps.map((a) => {
    const extra = sortHosts(a.hosts);
    return `        <tr>
          <th scope="row"><a href="https://${a.slug}.giga-school.com/">${esc(a.name)}</a></th>
          <td><code>${a.slug}.giga-school.com</code></td>
          <td>${extra.length
            ? extra.map((h) => `<code>${esc(h)}</code>`).join('<br>')
            : '<span class="fl-none">ほかに要りません</span>'}</td>
        </tr>`;
  }).join('\n');

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${FILTERING_URL}#page`,
        name: title,
        description,
        inLanguage: 'ja',
        url: FILTERING_URL,
        isPartOf: { '@id': `${SITE}/#website` },
        dateModified: generatedAt,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'トップ', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: title, item: FILTERING_URL },
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
  <link rel="canonical" href="${FILTERING_URL}">

  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="alternate" type="application/atom+xml" title="GIGA school の更新" href="/feed.xml">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GIGA school">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${FILTERING_URL}">
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
    <nav class="crumbs no-print" aria-label="パンくず">
      <a href="/">トップ</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">フィルタリング</span>
    </nav>

    <header class="article__head">
      <h1 class="article__title">校内のフィルタリングで許可するアドレス</h1>
      <p class="article__meta">
        アプリ ${apps.length} 本ぶんです。このページを印刷して、情報担当の先生にお渡しください。
      </p>
    </header>

    <div class="prose prose--article">
      <p><strong>使うアプリの分だけで足ります。</strong>全部を許可する必要はありません。
        下の「アプリごとの一覧」から、使うものの行だけを見てください。</p>

      <p>どのアプリも、まず<strong>そのアプリ自身のアドレス</strong>（<code>&lt;アプリ名&gt;.giga-school.com</code>）が要ります。
        それに加えて要るものが、アプリによってあります。${noExtra.length} 本は、自分のアドレスだけで動きます。</p>

      <h2 id="s-1">アプリ自身のほかに要るもの</h2>
      <p>塞いだときに何が起きるかで分けています。全部は開けられないときは、上から順に通してください。</p>
    </div>

    <!-- ⚠️ tabindex="0" と role="region" が要る。横に流れる枠は、
             キーボードだけで使う人が中を動かせないと届かない部分が出る。
             枠に名前（aria-label）も付ける。「スクロールできる何か」では分からない。 -->
    <div class="fl-scroll" tabindex="0" role="region" aria-label="アプリ自身のアドレス以外に許可が要るもの">
      <table class="fl">
        <caption class="visually-hidden">アプリ自身のアドレス以外に許可が要るもの</caption>
        <thead>
          <tr><th scope="col">アドレス</th><th scope="col">何に使うか</th><th scope="col">使うアプリ</th></tr>
        </thead>
        <tbody>
${sharedRows}
        </tbody>
      </table>
    </div>

    <div class="prose prose--article">
      <h2 id="s-2">アプリごとの一覧</h2>
    </div>

    <div class="fl-scroll" tabindex="0" role="region" aria-label="アプリごとに許可が要るアドレス">
      <table class="fl">
        <caption class="visually-hidden">アプリごとに許可が要るアドレス</caption>
        <thead>
          <tr><th scope="col">アプリ</th><th scope="col">アプリ自身のアドレス</th><th scope="col">ほかに要るもの</th></tr>
        </thead>
        <tbody>
${appRows}
        </tbody>
      </table>
    </div>

    <div class="prose prose--article">
      <h2 id="s-3">申請書に貼る用</h2>
      <p>1 行に 1 つ並べたものです。使わないアプリの行は消してください。</p>
    </div>
    <pre class="fl-plain" tabindex="0" role="region" aria-label="申請書に貼るアドレスの一覧"><code>${esc(plain)}</code></pre>

    <div class="prose prose--article">
      <h2 id="s-4">この一覧の作り方</h2>
      <p>記事の文章からは拾っていません。<strong>アプリが実際に読み込んでいるもの</strong>を見ています。
        配られるファイルの中の読み込み（<code>script src</code> / <code>link rel=stylesheet</code> /
        <code>img</code> / <code>fetch</code> など）と、アプリが宣言している
        Content-Security-Policy の両方です。</p>
      <p>ページの中のリンク（<code>&lt;a href&gt;</code>）は数えていません。押したときに移動するだけで、
        ブラウザが勝手に取りに行くものではないためです。共有カードの画像も同じ理由で外しています。</p>
      <p>Google Apps Script で動くアプリが外へ出す通信（<code>UrlFetchApp</code>）も入れていません。
        <strong>あれは Google のサーバーの中で動きます。</strong>教室の端末からは出て行かないので、
        校内のフィルタリングには関係しません。</p>
      <p>このページは <code>data/apps.json</code> から自動で組み立てています。手で書いていないので、
        アプリが増えても書き忘れが起きません。</p>
    </div>

    <p class="article__actions no-print">
      <a class="btn btn--primary" href="/">アプリの一覧へ</a>
      <a class="btn btn--ghost" href="/apps/">紹介を読む</a>
    </p>
  </main>

${FOOTER}
</body>

</html>
`;
}
