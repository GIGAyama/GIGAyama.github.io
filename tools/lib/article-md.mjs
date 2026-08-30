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

/* ── ふりがな（<ruby>）だけは、書いたまま通す ────────────────────
 *
 * ここは生の HTML を一律に esc() している。本文に <script> を書かれても
 * ただの字として出る、という守りかたで、それ自体は変えない。
 *
 * ただ 1 つだけ困っていたのが ふりがな だった。giga-manual の書式は
 * 「子ども向けのマニュアルでは、ルビを HTML でそのまま書く」と決めていて、
 * 対象学年が 1〜6 年のアプリでは そう書くのが正しい。ところが esc() が
 * 一律にかかるので、公開ページには
 *   &lt;ruby&gt;学&lt;rt&gt;がく&lt;/rt&gt;&lt;/ruby&gt;
 * つまり「<ruby>学<rt>がく</rt></ruby>」という字がそのまま出ていた。
 * 手元の Markdown 表示でも lint でも正しく見えるので、公開ページを
 * 見るまで気づけない壊れ方をする（2026-08-30、Qalc のマニュアルで実際に
 * 51 か所 踏んだ）。
 *
 * そこで `コード` と同じやり方で、esc() の前に預けて後で戻す。
 * 許すのは <ruby> と、その中の <rt> <rp> だけ。属性は 1 つも通さない。
 *
 * ⚠️ 見出しでは使わないこと。目次（article-toc.mjs の textOf）は
 *    タグを落として文字だけにするので、「学年」が「学がく年ねん」になる。
 *    lint-manual.mjs がそこを見ている。 */
const RUBY_SLOT = (i) => `%%ruby${i}%%`;
const RUBY_SLOT_RE = /%%ruby(\d+)%%/g;

/** <ruby>…</ruby> ひとかたまり。入れ子は考えない（ふりがなに入れ子はない）。 */
const RUBY_RE = /<ruby>((?:(?!<\/?ruby>)[\s\S])*)<\/ruby>/g;

/**
 * <ruby> の中身を、許したタグだけ残して組み立て直す。
 * 文字はすべて esc() を通すので、<rt> <rp> 以外は字として出る。
 */
const rubyHtml = (inner) => `<ruby>${
  String(inner).replace(/<\/?(?:rt|rp)>|[\s\S]/g, (piece) => (
    /^<\/?(?:rt|rp)>$/.test(piece) ? piece : esc(piece)
  ))
}</ruby>`;

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 行のなかの記法。順番に意味がある（コードを先に逃がしてから、ほかを見る）。 */
function inline(text) {
  const code = [];
  const ruby = [];
  let s = String(text)
    // `コード` は中身をそのまま見せたい。先に預けておき、最後に戻す。
    .replace(/`([^`]+)`/g, (_, c) => CODE_SLOT(code.push(c) - 1))
    // ふりがなも預ける。`コード` のあとに見るので、コードの中の
    // <ruby> は ふりがなにならず、字のまま出る。
    .replace(RUBY_RE, (_, inner) => RUBY_SLOT(ruby.push(rubyHtml(inner)) - 1));

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

  return s
    .replace(CODE_SLOT_RE, (_, i) => `<code>${esc(code[Number(i)])}</code>`)
    .replace(RUBY_SLOT_RE, (_, i) => ruby[Number(i)]);
}

/**
 * いま始まる番号つき手順が、少し前の手順の続きなら、その次の番号を返す。続きでなければ 1。
 *
 * ── なぜ要るのか ──────────────────────────────
 *
 * 手順の途中に画面写真を置くと、そこで <ol> がいったん閉じる。何もしないと、
 * 写真の次の手順が「1.」に戻る。書いた人は 1・2・3…と番号を振っているのに、
 * 出来上がったページでは 1・1・1 と並ぶ。**手元の Markdown 表示では正しく見えるので、
 * 公開されたページを見るまで気づけない。**
 *
 * 「どのボタンを押せば何ができるか」を伝えるマニュアルでは、押す場所の写真を
 * 手順のあいだに置くのがいちばん自然な形なので、そちらを禁じずにこちらで続ける。
 *
 * ⚠️ 続きとみなすのは「画像と、その説明文だけ」をはさんだときに限る。
 *    ふつうの段落や見出しが入ったら、そこで話が変わっているので 1 から数え直す。
 */
function continuedFrom(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'image') continue;                       // 写真は、はさんでよい
    /* 写真の説明文も、はさんでよい（renderArticle が figcaption にする分） */
    if (b.kind === 'p' && blocks[i - 1]?.kind === 'image' && looksLikeCaption(b)) continue;
    if (b.kind === 'ol') return (b.start ?? 1) + b.items.length;
    return 1;                                               // ほかのものが入ったら数え直す
  }
  return 1;
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
      if (list?.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [], start: continuedFrom(blocks) }; }
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
      case 'ul': {
        b.items.forEach((i) => { charCount += i.length; });
        /* 画面写真をはさんだ手順は、番号を続ける（b.start は blocksOf が決める）。
           付けないと、写真のたびに番号が 1 に戻る。 */
        const start = b.kind === 'ol' && b.start > 1 ? ` start="${b.start}"` : '';
        out.push(`<${b.kind}${start}>` + b.items.map((i) => `<li>${inline(i)}</li>`).join('') + `</${b.kind}>`);
        return;
      }

      case 'quote':
        b.lines.forEach((l) => { charCount += l.length; });
        out.push('<blockquote>' + b.lines.map((l) => `<p>${inline(l)}</p>`).join('') + '</blockquote>');
        return;

      case 'code':
        /* ⚠️ tabindex="0" が要る。長い行があると <pre> は横に流れるので、
           付けないとキーボードだけで使う人が中を動かせない（axe が拾う）。
           開発記録はプロンプトを囲みで出すので、ここが効く。 */
        out.push(`<pre tabindex="0"><code>${esc(b.lines.join('\n'))}</code></pre>`);
        return;
    }
  });

  return { title, html: out.join('\n'), images, lead, charCount, headings };
}
