/**
 * 紹介記事の中を探せるようにするための索引をつくる。
 *
 * ── なぜ要るのか ──────────────────────────────
 *
 * トップページの検索は、カードの data-name と data-keywords しか見ていない。
 * 紹介記事は 31 本で 226,000 字あるが、その中身は検索の外にあった。
 * 「ローマ字」「あのね帳」「二学期」で探しても、何も出てこない。
 *
 * ── 節ごとに切る理由 ──────────────────────────
 *
 * 1 本まるごとを 1 件にすると、当たったことは分かっても、
 * 21,000 字のどこに書いてあるかは分からない。読み手はまた先頭から探すことになる。
 *
 * 見出し（h2）で切って 254 件にすると、当たった節の名前を出せて、
 * /apps/<slug>/#s-3 のように、その節へ直接つなげられる。
 * 目次で振った id（article-toc.mjs）がそのまま行き先になる。
 *
 * ── 本文を削らない理由 ────────────────────────
 *
 * 索引は 663KB（gzip をかけて配ると 182KB）ある。本文を 300 字までに切れば
 * 67KB まで小さくなるが、そうすると 7 割の文字が探せなくなる。
 *
 * 書いてある言葉で探して「見つかりません」と出るのは、検索が無いより悪い。
 * 大きさは、検索の欄に触れるまで読み込まないことで避ける。
 *
 * ── 書き出したページから作る理由 ────────────────────
 *
 * 記事の Markdown ではなく apps/<slug>/index.html を読む。
 * GitHub を見に行かなくても作り直せるので、朝の組み直しが
 * 途中で失敗した日でも、索引だけが古いまま取り残されることがない。
 */

/** 本文の始まりと終わり。build-articles.mjs / build-manuals.mjs が書き出す形と同じ。 */
const BODY_RE = /<div class="prose prose--article">\n([\s\S]*?)\n    <\/div>/;
/** 目次で id を振ってある見出し。節の切れ目になる。 */
const SECTION_RE = /<h2 id="(s-\d+)">([\s\S]*?)<\/h2>/g;

const strip = (html) => String(html).replace(/<[^>]+>/g, '');

/**
 * 索引に入れる形。
 *
 * ⚠️ 空白は「落とす」のではなく「1 つにまとめる」。
 *    当たったところの前後を抜き出して見せるのに、この同じ文字列を使うため、
 *    落としてしまうと「GoogleAppsScript」のように詰まって出る。
 *    日本語には語の切れ目が無いので、まとめるだけで探すには足りる。
 */
const flatten = (html) => strip(html)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * 紹介ページ 1 枚から、節ごとの索引を取り出す。
 *
 * @param {string} html apps/<slug>/index.html の中身
 * @param {{slug: string, name: string, url?: string}} app
 *        url は、紹介ページ以外（使い方マニュアルなど）のときだけ渡す
 * @returns {{s: string, n: string, i: string, h: string, t: string}[]}
 */
export function sectionsOf(html, { slug, name, url = '' }) {
  const body = BODY_RE.exec(String(html ?? ''))?.[1];
  if (!body) return [];

  const marks = [...body.matchAll(SECTION_RE)];
  return marks.map((m, at) => {
    const from = m.index + m[0].length;
    const to = at + 1 < marks.length ? marks[at + 1].index : body.length;
    return {
      s: slug,
      n: name,
      i: m[1],
      h: flatten(m[2]),
      t: flatten(body.slice(from, to)),
      /* 行き先。紹介ページ（/apps/<slug>/）のときは入れない。
         索引は 663KB あり、同じ文字列を 254 回書くと目に見えて重くなる。
         入っていない項目は、読む側（assets/search.js）が既定の
         /apps/<slug>/ に落とす。使い方マニュアルのときだけ入る。 */
      ...(url ? { u: url } : {}),
    };
  }).filter((x) => x.t.length > 0);
}

/**
 * 索引ぜんたい。
 *
 * @param {{slug: string, name: string, html: string, url?: string}[]} pages
 * @param {string} generatedAt
 * @returns {string} 書き出す JSON
 */
export function searchIndex(pages, generatedAt) {
  const items = pages
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .flatMap((p) => sectionsOf(p.html, p));

  /* 読むためのものではないので、詰めて書く。
     663KB あり、字下げを入れると 1 割ほど増える。 */
  return JSON.stringify({
    _comment: 'tools/sync-updates.mjs が紹介ページから書き出す。手で書き足さない。',
    generatedAt,
    items,
  }) + '\n';
}
