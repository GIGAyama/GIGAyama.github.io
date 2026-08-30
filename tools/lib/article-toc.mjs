/**
 * 紹介ページの目次と、読むのにかかる時間。
 *
 * ── なぜ目次が要るのか ────────────────────────
 *
 * 紹介記事は 1 本が平均 7,300 字。字数だけなら長くはない。
 * 長いのは画面の縦で、1 本に 22 枚の画面写真が入る。高さで頭を打たせてあってなお、
 * 縦の半分以上は画像である。文字を追う速さでは進まない一方、
 * 節は 8〜10 あって、それぞれ用が違う（導入手順、使い方、メリット）。
 *
 * 「管理者向けの導入手順だけ確かめたい」「使い方の画面写真だけ見たい」という
 * 読み方がいちばん多いはずなのに、そこへ跳ぶ手段が無く、
 * 開いた人は先頭から順に送るしかなかった。
 *
 * 31 本はすべて同じ並び（はじめに → できること → 機能 → メリット →
 * 導入手順 → 使い方 → まとめ）で書かれている。見出しに絵文字も付いている。
 * つまり目次は、記事に手を入れなくても、組み立てのときに機械で作れる。
 *
 * ── 記事の Markdown ではなく、組み上がった HTML を見る理由 ──────
 *
 * 見出しの id も、読むのにかかる時間も、renderArticle() が返す
 * headings / charCount から作ることもできた。そうしなかったのは、
 * すでに書き出してあるページに後から同じ処理を当てられなくなるためである。
 * 出来上がった HTML だけを入力にしておけば、朝の組み直しと、
 * 手元での作り直しが、必ず同じ結果になる。
 *
 * どの関数も、同じ HTML を何度通しても結果が変わらない（id は振り直す）。
 */
import { plainText, rubyOnly } from './plain-text.mjs';

/** h2・h3 を丸ごと拾う。すでに id が振ってあっても拾えるように属性は読み飛ばす。 */
const HEADING_RE = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/g;

/** 目次を出す下限。見出しが 2 本しかない記事に目次を付けても、場所を取るだけ。 */
const TOC_MIN = 3;

/** 日本語を読む速さ。400〜600 字／分といわれるうちの真ん中を取る。 */
const CHARS_PER_MINUTE = 500;

/**
 * 見出しの中の文字だけ。ふりがな（`<rt>`）は中身ごと落とす。
 * 落とさないと「学がく年ねん」になる（`plain-text.mjs` に経緯がある）。
 */
const textOf = (html) => plainText(html).replace(/\s+/g, ' ').trim();

/**
 * 目次のリンクに置く中身。ふりがなだけ残して、ほかのタグは外す。
 *
 * 外すのは、見出しの中にリンクや `<code>` があると目次の `<a>` の中へ
 * 入れ子になってしまうため。ふりがなを残すのは、目次は漢字が読めない子が
 * 最初に見るところで、そこだけ振り仮名が消えると読めなくなるため。
 * 中身はすでにエスケープ済みなので、そのまま HTML に置ける。
 */
const labelOf = (html) => rubyOnly(html).replace(/\s+/g, ' ').trim();

/**
 * 見出しに id を振り、目次の材料を取り出す。
 *
 * id は `s-1` `s-1-2` の連番にしてある。見出しの文字から作らないのは、
 * 日本語の見出しだと URL が長い percent-encoding の列になるうえ、
 * 記事の言い回しを直しただけで、外から張られたリンクが切れるため。
 *
 * @param {string} html 本文（renderArticle が返す html）
 * @returns {{html: string,
 *            headings: {level: number, id: string, text: string, label: string}[]}}
 *          text はふりがなを落とした素の文字（数える・検索に載せる用）。
 *          label はふりがなを残した HTML（目次に置く用）。
 */
export function withAnchors(html) {
  const headings = [];
  let h2 = 0;
  let h3 = 0;

  const out = String(html ?? '').replace(HEADING_RE, (_, lv, inner) => {
    const level = Number(lv);
    if (level === 2) { h2 += 1; h3 = 0; } else { h3 += 1; }
    const id = level === 2 ? `s-${h2}` : `s-${h2}-${h3}`;
    headings.push({ level, id, text: textOf(inner), label: labelOf(inner) });
    return `<h${lv} id="${id}">${inner}</h${lv}>`;
  });

  return { html: out, headings };
}

/**
 * 目次の HTML。見出しが少ない記事には出さない（空文字を返す）。
 *
 * <details> にしてあるのは、JavaScript を使わずに畳めるようにするため。
 * 既定は開いた状態。8 本前後なので、開いていても本文までは遠くない。
 *
 * @param {{level: number, id: string, text: string}[]} headings
 * @returns {string}
 */
export function tocOf(headings) {
  const list = Array.isArray(headings) ? headings : [];
  if (list.filter((h) => h.level === 2).length < TOC_MIN) return '';

  const items = [];
  for (const h of list) {
    /* label はふりがなを残した HTML。無い呼び出し元のために text へ落ちる */
    const link = `<a href="#${h.id}">${h.label || h.text}</a>`;
    if (h.level === 2) {
      items.push({ link, children: [] });
      continue;
    }
    /* h2 より先に h3 が来る記事はないが、来ても落とさない */
    if (!items.length) items.push({ link: '', children: [] });
    items[items.length - 1].children.push(link);
  }

  const li = items.map((i) => '          <li>' + i.link
    + (i.children.length
      ? '\n            <ol class="toc__sub">'
        + i.children.map((c) => `<li>${c}</li>`).join('')
        + '</ol>\n          '
      : '')
    + '</li>').join('\n');

  return `    <details class="toc" open>
      <summary class="toc__head">目次<span class="toc__hint">読みたいところから読めます</span></summary>
      <nav aria-label="目次">
        <ol class="toc__list">
${li}
        </ol>
      </nav>
    </details>
`;
}

/**
 * 読むのにかかるおおよその時間。
 *
 * かかる時間を先に言う。15 分と分かっていれば、人は目次のほうを使う。
 * 分からないまま読み始めると、途中でやめて、戻ってこない。
 *
 * 5 分単位に丸めるのは、1 分の差に意味がないため。
 * 「38 分」と書くと、数えた本人にしか意味のない正確さになる。
 *
 * @param {string} html
 * @returns {{minutes: number, chars: number}}
 */
export function readingOf(html) {
  /* ふりがなを数に入れない。子ども向けの本文は総ルビに近いことがあり、
     入れると読む時間が倍近く出る。 */
  const chars = plainText(html)
    .replace(/\s+/g, '')
    .length;
  const minutes = Math.max(5, Math.round(chars / CHARS_PER_MINUTE / 5) * 5);
  return { minutes, chars };
}
