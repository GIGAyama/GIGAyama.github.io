/**
 * Markdown を HTML にするところ。
 *
 * ここは紹介記事・開発記録・使い方マニュアルの 3 つが通る唯一の道なので、
 * 壊すと 3 つ同時に、しかも「ページは出るが中身が違う」形で崩れる。
 * ここまでテストが 1 本も無かったので、今回さわった番号の続きと、
 * さわっていない既存の振る舞いの両方を留めておく。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, renderArticle } from './article-md.mjs';

const render = (md) => renderArticle(md, { imageUrl: (t) => `/img/${t}` });

/* -----------------------------------------------------------------
 * 番号つき手順の途中に画面写真を置く（2026-08-29 に直したところ）
 *
 * 「どのボタンを押せば何ができるか」を伝えるマニュアルでは、押す場所の写真を
 * 手順のあいだに置くのがいちばん自然な形になる。以前はそこで <ol> が閉じ、
 * 次の手順が「1.」に戻っていた。手元の Markdown 表示では正しく見えるので、
 * 公開されたページを見るまで気づけない壊れ方だった。
 * --------------------------------------------------------------- */
test('写真をはさんでも番号が続く', () => {
  const { html } = render(`1. ひとつめ。
2. ふたつめ。

![押すところ](a.png)

3. みっつめ。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol start="3">']);
});

test('写真と、その説明文をはさんでも番号が続く', () => {
  const { html } = render(`1. ひとつめ。

![押すところ](a.png)

ここを押します。

2. ふたつめ。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol start="2">']);
});

test('写真を 2 枚続けてはさんでも番号が続く', () => {
  const { html } = render(`1. ひとつめ。

![あ](a.png)

![い](b.png)

2. ふたつめ。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol start="2">']);
});

test('ふつうの段落が入ったら 1 から数え直す（話が変わっている）', () => {
  const { html } = render(`1. ひとつめ。

これは写真の説明ではなく、独立した段落です。前の手順とは関係がありません。

1. あたらしい手順。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol>']);
});

test('見出しが入ったら 1 から数え直す', () => {
  const { html } = render(`1. ひとつめ。

## つぎの節

1. あたらしい手順。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol>']);
});

test('長い段落は説明文とみなさない（120 字を超えたら数え直す）', () => {
  const { html } = render(`1. ひとつめ。

![あ](a.png)

${'あ'.repeat(130)}

2. ふたつめ。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol>']);
});

test('3 つ以上に切れても数え続ける', () => {
  const { html } = render(`1. ひとつめ。

![あ](a.png)

2. ふたつめ。

![い](b.png)

3. みっつめ。
`);
  assert.deepEqual(html.match(/<ol[^>]*>/g), ['<ol>', '<ol start="2">', '<ol start="3">']);
});

test('start は 1 のときには出さない（余計な属性を増やさない）', () => {
  const { html } = render('1. ひとつめ。\n');
  assert.ok(html.includes('<ol>'));
  assert.ok(!html.includes('start='));
});

test('箇条書き（ul）には番号の続きを持ちこまない', () => {
  const { html } = render(`- ひとつ

![あ](a.png)

- ふたつ
`);
  assert.deepEqual(html.match(/<ul[^>]*>/g), ['<ul>', '<ul>']);
  assert.ok(!html.includes('start='));
});

/* -----------------------------------------------------------------
 * ここから下は、今回さわっていない既存の振る舞い。
 * 直したつもりのないところが動いていないことを確かめる。
 * --------------------------------------------------------------- */
test('題は本文に出さず、title として返す', () => {
  const r = render('# アプリの つかいかた\n\nあれこれ。\n');
  assert.equal(r.title, 'アプリの つかいかた');
  assert.ok(!r.html.includes('<h1'));
});

test('画像の直後の 1 行の段落は説明文になり、本文には二度出ない', () => {
  const r = render(`![ホーム](home.png)

まんなかに問題が出ます。
`);
  assert.ok(r.html.includes('<figcaption>まんなかに問題が出ます。</figcaption>'));
  assert.ok(!r.html.includes('<p>まんなかに問題が出ます。</p>'));
  assert.equal(r.images[0].caption, 'まんなかに問題が出ます。');
});

test('alt が空なら、説明文を alt に使う', () => {
  const r = render('![](home.png)\n\nホーム画面です。\n');
  assert.equal(r.images[0].alt, 'ホーム画面です。');
});

test('画像の道は imageUrl に任せる', () => {
  const r = render('![あ](images/01.png)\n');
  assert.equal(r.images[0].src, '/img/images/01.png');
});

test('見出しは level と text を返す', () => {
  const r = render('## おおきい\n\n### ちいさい\n');
  assert.deepEqual(r.headings, [
    { level: 2, text: 'おおきい' },
    { level: 3, text: 'ちいさい' },
  ]);
});

test('最初の段落が lead になる（検索結果の説明文のもと）', () => {
  const r = render('# 題\n\n## はじめに\n\n最初の段落。\n\n次の段落。\n');
  assert.equal(r.lead, '最初の段落。');
});

test('charCount は段落・箇条書き・引用だけを数える', () => {
  const r = render('# 題\n\n## 見出し\n\nあいう\n\n- かきく\n\n> さしす\n');
  assert.equal(r.charCount, 9, '題と見出しは数えない');
});

test('charCount はふりがなを数えない', () => {
  /* <ruby>漢字<rt>かんじ</rt></ruby> は「漢字」の 2 字。生のまま数えると 30 字になり、
     子ども向けマニュアルの「読むのに約 N 分」が 1.5 倍に化ける（2026-08-30）。 */
  const r = render('# 題\n\n## 見出し\n\n<ruby>漢字<rt>かんじ</rt></ruby>を おぼえる\n');
  assert.equal(r.charCount, '漢字を おぼえる'.length);
});

test('charCount はふりがな以外のタグには手を出さない', () => {
  /* すでに公開している記事の字数を動かさないための線引き。 */
  const r = render('# 題\n\n## 見出し\n\n**ふとい**字\n');
  assert.equal(r.charCount, '**ふとい**字'.length);
});

test('囲みの中は本文として扱わない', () => {
  const r = render('```\n1. これは手順ではない\n## これは見出しではない\n```\n');
  assert.ok(r.html.includes('<pre tabindex="0">'), 'キーボードで中を動かせるようにする');
  assert.deepEqual(r.headings, []);
  assert.ok(!r.html.includes('<ol'));
});

test('記号を落とす', () => {
  assert.equal(esc('<a& "b"'), '&lt;a&amp; &quot;b&quot;');
  const r = render('あ <script>alert(1)</script> い\n');
  assert.ok(!r.html.includes('<script>'));
});

/* -----------------------------------------------------------------
 * ふりがな（<ruby>）を通す（2026-08-30 に直したところ）
 *
 * giga-manual の書式は「子ども向けのマニュアルでは、ルビを HTML で
 * そのまま書く」と決めているのに、inline() の esc() が一律にかかるので、
 * 公開ページには「<ruby>学<rt>がく</rt></ruby>」という字がそのまま出ていた。
 * 手元の Markdown 表示でも lint でも正しく見えるため、公開ページを見るまで
 * 気づけない。Qalc のマニュアルで 51 か所 踏んでから分かった。
 *
 * 通すのは <ruby> <rt> <rp> だけ。ここを緩めると、記事の本文に書いた
 * HTML がそのまま動くようになってしまうので、下の 6 本で締めておく。
 * --------------------------------------------------------------- */
test('ふりがなは そのまま出る', () => {
  const { html } = render('<ruby>学<rt>がく</rt></ruby>年です。');
  assert.equal(html, '<p><ruby>学<rt>がく</rt></ruby>年です。</p>');
});

test('ふりがなの外がわの生 HTML は、これまでどおり字になる', () => {
  const { html } = render('あ<script>alert(1)</script>い');
  assert.equal(html, '<p>あ&lt;script&gt;alert(1)&lt;/script&gt;い</p>');
});

test('ふりがなの中に書いたタグも、<rt> <rp> 以外は字になる', () => {
  const { html } = render('<ruby>学<rt><script>x</script></rt></ruby>');
  assert.equal(html, '<p><ruby>学<rt>&lt;script&gt;x&lt;/script&gt;</rt></ruby></p>');
});

test('属性を持った <ruby> は通さない（丸ごと字になる）', () => {
  const { html } = render('<ruby onclick="x">学<rt>がく</rt></ruby>');
  assert.ok(!html.includes('<ruby'), 'ruby 要素として出てはいけない');
  assert.ok(html.includes('&lt;ruby onclick=&quot;x&quot;&gt;'), '字として出る');
});

test('`コード` の中の <ruby> は ふりがなにならない', () => {
  const { html } = render('`<ruby>学<rt>がく</rt></ruby>`');
  assert.equal(html, '<p><code>&lt;ruby&gt;学&lt;rt&gt;がく&lt;/rt&gt;&lt;/ruby&gt;</code></p>');
});

test('ふりがなが 1 行に 2 つ あっても、それぞれ出る', () => {
  const { html } = render('<ruby>学<rt>がく</rt></ruby><ruby>年<rt>ねん</rt></ruby>');
  assert.equal(html, '<p><ruby>学<rt>がく</rt></ruby><ruby>年<rt>ねん</rt></ruby></p>');
});
