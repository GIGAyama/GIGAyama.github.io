/**
 * アプリのリポジトリに置いてある note 記事の Markdown を、ページの本文に変える。
 *
 * ⚠️ 汎用の Markdown 変換ではない。記事の書き方は 31 本ともそろっているので、
 *    そこで実際に使われている記法だけを扱う。使っていない記法まで相手にすると、
 *    取りこぼしたときに黙って崩れた HTML が出る。
 *
 *    実際に使われているもの（31 本を数えた結果）
 *      # 見出し1（題）・## 見出し2・### 見出し3
 *      ![説明](images/01-home.png)   画像
 *      1. 手順 / - 箇条書き
 *      ``` コード枠 ・ `インラインコード`
 *      > 引用 ・ **太字**
 *      <https://…> と、むき出しの URL
 *
 * ── 画像の下の一文について ────────────────────────
 *
 * 記事では、画像のすぐ下に説明の一文を置く書き方でそろえてある。
 * 投稿ランチャー（XXX_automatic）の parseArticle は、その一文を控えつつ
 * 本文からは消さない。note では画像とキャプションが別の欄になるためである。
 *
 * こちらは逆に、figcaption にしたうえで本文からは外す。
 * ページでは画像のすぐ下に同じ文が二度出ることになり、壊れて見えるため。
 * 見立てを外すと一段落ぶん消えるので、条件は向こうと同じにそろえてある
 * （1 行であること、120 字以内であること）。
 */

/** 画像の下の一文を説明とみなす上限。XXX_automatic の CAPTION_MAX_CHARS と同じ。 */
const CAPTION_MAX_CHARS = 120;

const TITLE_RE = /^#\s+(.+?)\s*$/;
const HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)\s*$/;
const OL_RE = /^\s*(\d+)\.\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```/;

/** `コード` を先に預けるときの目印。本文に出てこない形にしてある。 */
const CODE_SLOT = (i) => `%%code${i}%%`;
const CODE_SLOT_RE = /%%code(\d+)%%/g;

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 行のなかの記法。順番に意味がある（コードを先に逃がしてから、ほかを見る）。 */
function inline(text) {
  const code = [];
  let s = String(text)
    // `コード` は中身をそのまま見せたい。先に預けておき、最後に戻す。
    .replace(/`([^`]+)`/g, (_, c) => CODE_SLOT(code.push(c) - 1));

  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // [文字](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, t, u) => `<a href="${u}" rel="noopener">${t}</a>`)
    // <https://…>（esc 済みなので &lt; &gt; の形で来る）
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
      (_, u) => `<a href="${u}" rel="noopener">${u}</a>`)
    // むき出しの URL。すでにリンクにしたものは拾わない
    .replace(/(^|[^"=>])(https?:\/\/[^\s<)）」、。]+)/g,
      (_, before, u) => `${before}<a href="${u}" rel="noopener">${u}</a>`);

  return s.replace(CODE_SLOT_RE, (_, i) => `<code>${esc(code[Number(i)])}</code>`);
}

/**
 * Markdown を切り分ける。段落は空行で切れる。
 * @returns {{kind: string}[]}
 */
function blocksOf(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const blocks = [];
  let para = [];
  let list = null;      // {kind:'ol'|'ul', items:string[]}
  let quote = null;     // string[]
  let fence = null;     // string[]

  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', text: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flushQuote = () => { if (quote) { blocks.push({ kind: 'quote', lines: quote }); quote = null; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (fence) {
      if (FENCE_RE.test(line)) { blocks.push({ kind: 'code', lines: fence }); fence = null; }
      else fence.push(raw);
      continue;
    }
    if (FENCE_RE.test(line)) { flushAll(); fence = []; continue; }

    if (line.trim() === '') { flushAll(); continue; }

    let m;
    if ((m = line.match(TITLE_RE))) { flushAll(); blocks.push({ kind: 'title', text: m[1] }); continue; }
    if ((m = line.match(HEADING_RE))) {
      flushAll();
      blocks.push({ kind: 'h', level: Math.min(m[1].length, 6), text: m[2] });
      continue;
    }
    if ((m = line.match(IMAGE_RE))) {
      flushAll();
      blocks.push({ kind: 'image', alt: m[1], target: m[2] });
      continue;
    }
    if ((m = line.match(QUOTE_RE))) { flushPara(); flushList(); (quote ??= []).push(m[1]); continue; }
    if ((m = line.match(OL_RE))) {
      flushPara(); flushQuote();
      if (list?.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    if ((m = line.match(UL_RE))) {
      flushPara(); flushQuote();
      if (list?.kind !== 'ul') { flushList(); list = { kind: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }

    flushList(); flushQuote();
    para.push(line.trim());
  }
  if (fence) blocks.push({ kind: 'code', lines: fence });   // 閉じ忘れは、そこまでを枠にする
  flushAll();
  return blocks;
}

/** 段落が、直前の画像の説明として使える形か。 */
const looksLikeCaption = (block) =>
  block?.kind === 'p' && !block.text.includes('\n') && block.text.length <= CAPTION_MAX_CHARS;

/**
 * 記事の Markdown を、ページに入れる HTML にする。
 *
 * @param {string} markdown
 * @param {object} options
 * @param {(target: string) => string} options.imageUrl  記事の中の相対パスを、出す URL に変える
 * @returns {{title: string, html: string, images: {src: string, alt: string, caption: string}[],
 *            lead: string, charCount: number, headings: {level: number, text: string}[]}}
 */
export function renderArticle(markdown, { imageUrl }) {
  const blocks = blocksOf(markdown);
  const out = [];
  const images = [];
  const headings = [];
  let title = '';
  let lead = '';
  let charCount = 0;
  let skipNext = false;

  blocks.forEach((b, at) => {
    if (skipNext) { skipNext = false; return; }

    switch (b.kind) {
      case 'title':
        // 題は <h1> としてページ側が出す。本文には入れない。
        if (!title) title = b.text;
        return;

      case 'h':
        headings.push({ level: b.level, text: b.text });
        out.push(`<h${b.level}>${inline(b.text)}</h${b.level}>`);
        return;

      case 'image': {
        const next = blocks[at + 1];
        const caption = looksLikeCaption(next) ? next.text : '';
        if (caption) skipNext = true;   // 同じ文を本文にも出さない
        const src = imageUrl(b.target);
        const alt = b.alt || caption || '';
        images.push({ src, alt, caption });
        /* 画像はリンクで包む。JavaScript があれば拡大して見せ、
           無ければ画像そのものが開く。縦長の画面写真は、本文の中では
           高さで頭を打たせてあるので、大きく見る道をどちらでも残しておく。 */
        out.push(
          '<figure class="prose__fig">'
          + `<a class="prose__zoom" href="${esc(src)}">`
          + `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`
          + '</a>'
          + (caption ? `<figcaption>${inline(caption)}</figcaption>` : '')
          + '</figure>');
        return;
      }

      case 'p':
        charCount += b.text.length;
        if (!lead) lead = b.text;
        out.push(`<p>${inline(b.text)}</p>`);
        return;

      case 'ol':
      case 'ul':
        b.items.forEach((i) => { charCount += i.length; });
        out.push(`<${b.kind}>` + b.items.map((i) => `<li>${inline(i)}</li>`).join('') + `</${b.kind}>`);
        return;

      case 'quote':
        b.lines.forEach((l) => { charCount += l.length; });
        out.push('<blockquote>' + b.lines.map((l) => `<p>${inline(l)}</p>`).join('') + '</blockquote>');
        return;

      case 'code':
        out.push(`<pre><code>${esc(b.lines.join('\n'))}</code></pre>`);
        return;
    }
  });

  return { title, html: out.join('\n'), images, lead, charCount, headings };
}
