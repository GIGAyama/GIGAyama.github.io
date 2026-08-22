/**
 * プレスキット（/press/）を組み立てる。
 *
 * なぜ要るか
 * ---------------------------------------------------------------------
 * 媒体やディレクトリの担当者が「載せよう」と思ったとき、いまは素材を集める
 * 手間が全部そちら側にかかる。紹介文を自分で書き、ロゴを探し、本数を数え、
 * 転載してよいか問い合わせる——その一つひとつが掲載をやめる理由になる。
 * 先回りして 1 ページにまとめておけば、そのぶん掲載されやすくなる。
 *
 * 数字は data/apps.json と data/articles.json から取る。手で書くと、
 * アプリが増えたときにここだけ古くなり、媒体に古い数字が載ることになる。
 *
 * 文章は「誇張しない」方針のまま書く。ここで盛ると、読んだ人が実物を見て
 * 落差を感じるだけで、いいことがない。
 */

import { esc } from './article-md.mjs';
import { HEADER, FOOTER, THEME_SCRIPT, SITE, OG_FALLBACK } from './article-page.mjs';

/** 何字あるか（コピーする側の判断材料になる） */
const len = (s) => [...s].length;

/**
 * @param {object} o
 * @param {object[]} o.apps     data/apps.json の items
 * @param {object[]} o.articles data/articles.json の items
 * @param {string} o.generatedAt
 */
export function pressPage({ apps, articles, generatedAt }) {
  const url = `${SITE}/press/`;
  const shown = apps.filter((i) => i.hidden !== true);
  const appCount = shown.filter((i) => i.kind === 'app').length;
  const toolCount = shown.filter((i) => i.kind === 'tool').length;
  const dates = shown.map((i) => i.publishedAt).filter(Boolean).sort();
  const since = dates[0] ? dates[0].slice(0, 7).replace('-', '年') + '月' : '';

  /* そのまま貼れる紹介文を 3 つの長さで。媒体によって入る枠が違うため */
  const blurbs = [
    ['一行', `小学校の教員がつくった、学校で使える無償の Web アプリ集`],
    ['短め', `小学校の教員 GIGAyama が、授業と校務のためにつくった Web アプリを ${appCount} 本公開しています。`
      + `ブラウザで開けばそのまま動き、費用はかかりません。ソースコードもすべて公開しています。`],
    ['本文', `小学校の教員 GIGAyama が、日々の授業や学級の仕事で「これがあれば」と思ったものを形にした `
      + `Web アプリ集です。${since}から公開を始め、現在 ${appCount} 本のアプリと ${toolCount} 本の Chrome 拡張機能を`
      + `無償で提供しています。すべてブラウザだけで動き、インストールも利用登録も要りません。`
      + `アクセス解析を入れておらず、外部サービスへ閲覧の記録を渡さない設計です。`
      + `ソースコードは GitHub で公開しているため、導入前に中身を確かめられます。`
      + `各アプリのつくった理由と使い方をまとめた紹介記事も ${articles.length} 本掲載しています。`],
  ];

  const blurbHtml = blurbs.map(([label, text]) => `        <div class="press-blurb">
          <p class="press-blurb__head">
            <b>${label}</b><span>${len(text)} 字</span>
            <button type="button" class="press-copy" data-copy="${esc(text)}" data-copy-label="紹介文">コピー</button>
          </p>
          <p class="press-blurb__body">${esc(text)}</p>
        </div>`).join('\n');

  /* 画面写真は、カテゴリがばらけるように選ぶ */
  const shots = ['online-100square-calculation', 'digital-newspaper', 'townmap-mikke',
    'kana-master', 'schoolplan-editor', 'quarto']
    .filter((slug) => shown.some((i) => i.slug === slug))
    .map((slug) => {
      const app = shown.find((i) => i.slug === slug);
      return `          <li>
            <a href="/assets/thumbs/${slug}-1.webp" download>
              <img src="/assets/thumbs/${slug}-1.webp" alt="${esc(app.name)} の画面" width="640" height="400" loading="lazy" decoding="async">
              <span>${esc(app.name)}</span>
            </a>
          </li>`;
    }).join('\n');

  const facts = [
    ['サイト名', 'GIGA school'],
    ['URL', `<a href="${SITE}/">giga-school.com</a>`],
    ['運営', 'GIGAyama（小学校教員・個人）'],
    ['公開中のアプリ', `${appCount} 本`],
    ['Chrome 拡張機能ほか', `${toolCount} 本`],
    ['紹介記事', `${articles.length} 本`],
    ['公開開始', since],
    ['利用料金', '無償（利用登録・課金の仕組みなし）'],
    ['動作環境', 'Web ブラウザ（Chromebook・iPad・Windows）'],
    ['ソースコード', '<a href="https://github.com/GIGAyama" rel="noopener">GitHub で公開</a>'],
  ].map(([k, v]) => `          <div class="press-fact"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('\n');

  const faq = [
    ['費用はかかりますか。', 'かかりません。利用登録や課金の仕組みはありません。'],
    ['アカウントは必要ですか。',
      '多くのアプリは不要です。一部、Google アカウントでの認可（ログイン）が必要なものがあります。'
      + 'カードの説明文に書いてあります。'],
    ['児童のデータはどこに保存されますか。',
      'アプリによって違います。端末の中だけに残るものが多くあります。'
      + 'アプリごとにプライバシーポリシーを置いているので、そちらをご確認ください。'],
    ['学校で使ってよいですか。',
      '各設置者の定めるルールに従って、内容をご確認のうえご判断ください。'],
    ['公式なサービスですか。',
      'いいえ。個人がひとりで開発・運用しているものです。学校や教育委員会の公式なものではありません。'],
  ].map(([q, a]) => `        <div class="press-faq">
          <p class="press-faq__q">${esc(q)}</p>
          <p class="press-faq__a">${esc(a)}</p>
        </div>`).join('\n');

  const description = `GIGA school（giga-school.com）を紹介・掲載していただくための資料です。`
    + `そのまま使える紹介文、ロゴ、画面写真、数字、転載してよい範囲をまとめています。`;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        name: '掲載用の資料（プレスキット）',
        description,
        inLanguage: 'ja',
        url,
        isPartOf: { '@id': `${SITE}/#website` },
        dateModified: generatedAt,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'GIGA school', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: '掲載用の資料', item: url },
        ],
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>掲載用の資料（プレスキット）｜GIGA school</title>
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
  <meta property="og:title" content="掲載用の資料（プレスキット）｜GIGA school">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${OG_FALLBACK}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="stylesheet" href="/assets/style.css">
  <script src="/assets/app.js" defer></script>
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
      <span aria-current="page">掲載用の資料</span>
    </nav>

    <header class="article__head">
      <h1 class="article__title">掲載用の資料</h1>
      <p class="article__meta">
        紹介・掲載していただくための素材です。ご連絡なしでお使いいただけます。
      </p>
    </header>

    <section class="press-section" aria-labelledby="blurb-title">
      <h2 class="press-title" id="blurb-title">そのまま使える紹介文</h2>
      <p class="press-lead">枠の大きさに合わせてお選びください。書き替えていただいてもかまいません。</p>
${blurbHtml}
    </section>

    <section class="press-section" aria-labelledby="facts-title">
      <h2 class="press-title" id="facts-title">数字と基本情報</h2>
      <p class="press-lead">${esc(generatedAt)} 時点。毎朝、公開しているものから数え直しています。</p>
      <dl class="press-facts">
${facts}
      </dl>
    </section>

    <section class="press-section" aria-labelledby="assets-title">
      <h2 class="press-title" id="assets-title">ロゴ・画面写真</h2>
      <p class="press-lead">押すとダウンロードできます。画面写真は実際のアプリのものです。</p>
      <p class="press-logos">
        <a class="btn btn--ghost" href="/assets/logo.svg" download>ロゴ（SVG）</a>
        <a class="btn btn--ghost" href="/assets/icon-512.png" download>アイコン（PNG 512px）</a>
        <a class="btn btn--ghost" href="/assets/og.png" download>バナー（PNG 1200×630）</a>
      </p>
      <ul class="press-shots">
${shots}
      </ul>
    </section>

    <section class="press-section" aria-labelledby="terms-title">
      <h2 class="press-title" id="terms-title">使ってよい範囲</h2>
      <div class="press-terms">
        <p><b>ご連絡なしでどうぞ。</b>出典（<code>https://giga-school.com/</code>）を示していただければ、
        次のことは自由にしていただけます。</p>
        <ul>
          <li>このページの紹介文をそのまま、または書き替えて使うこと</li>
          <li>ロゴ・画面写真を記事や資料に載せること</li>
          <li>リンクを貼ること（報告は要りません）</li>
        </ul>
        <p>いっぽう、<b>紹介記事の全文転載</b>と、<b>ロゴを当サイトと関係があるかのように使うこと</b>だけは
        ご相談ください。断るためではなく、どこにどう載るのかが分かると助かる、という趣旨です。
        くわしくは <a href="https://github.com/GIGAyama/GIGAyama.github.io/blob/main/LICENSE-CONTENT.md" rel="noopener">LICENSE-CONTENT.md</a>
        にあります。</p>
      </div>
    </section>

    <section class="press-section" aria-labelledby="faq-title">
      <h2 class="press-title" id="faq-title">よくいただく質問</h2>
${faq}
    </section>

    <section class="press-section" aria-labelledby="contact-title">
      <h2 class="press-title" id="contact-title">連絡先</h2>
      <div class="press-terms">
        <p>取材・掲載のご相談、記載内容の確認は、こちらへお願いします。</p>
        <p><a href="mailto:basstar.1102@gmail.com">basstar.1102@gmail.com</a>（GIGAyama）</p>
        <p>個人で運営しているため、お返事にお時間をいただくことがあります。</p>
      </div>
    </section>
  </main>

${FOOTER}
</body>

</html>
`;
}
