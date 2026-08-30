import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderArticle } from './article-md.mjs';
import { MANUAL_BASE, manualPage, manualTitleOf, manualUrl, markHeadings, schoolSection } from './manual-page.mjs';

const APP = {
  repo: 'SchoolPlan_Editor', name: '週案エディタ', slug: 'schoolplan-editor',
  category: 'koumu', hosts: ['script.google.com', 'drive.google.com'],
  grades: [], account: 'google', storage: 'google',
  publishedAt: '2026-02-11', updatedAt: '2026-08-29',
};

const MD = `# 週案エディタ の つかいかた

## はじめに

週案づくりを助けるアプリです。

## さいしょに

1. 配られた URL を ひらきます。

## 画面の見かた

![ホーム画面](https://schoolplan-editor.giga-school.com/manual/images/01-home.png)

まんなかに週案が出ます。

## できること

### 週案を印刷する

1 週間ぶんを A4 に出せます。

## こまったとき

### 画面が真っ白のまま

開き直してください。
`;

const render = (md = MD) => renderArticle(md, { imageUrl: (t) => t });
const page = (over = {}) => manualPage({ app: APP, manual: render(), hasArticle: true, ...over });

test('URL の形は /apps/<slug>/manual/', () => {
  assert.equal(MANUAL_BASE, 'manual');
  assert.equal(manualUrl('qalc'), 'https://giga-school.com/apps/qalc/manual/');
  assert.equal(manualTitleOf('Qalc'), 'Qalc の使い方');
});

test('canonical と JSON-LD の行き先がそろっている', () => {
  const html = page();
  assert.ok(html.includes('<link rel="canonical" href="https://giga-school.com/apps/schoolplan-editor/manual/">'));
  assert.ok(html.includes('"mainEntityOfPage": "https://giga-school.com/apps/schoolplan-editor/manual/"'));
  assert.ok(html.includes('"@type": "TechArticle"'));
});

test('本文の囲みが search-index.mjs の見ている形と同じ', () => {
  /* ⚠️ tools/lib/search-index.mjs の BODY_RE は
     <div class="prose prose--article">\n … \n    </div> に完全一致する。
     クラスを足したり字下げを変えたりすると、索引から黙って落ちる。 */
  const html = page();
  assert.ok(html.includes('<div class="prose prose--article">\n'), '囲みのクラスを増やさない');
  assert.match(html, /<div class="prose prose--article">\n[\s\S]*?\n    <\/div>/);
});

test('見出しに記事と同じ id が振られる（目次と外からのリンク）', () => {
  const html = page();
  for (const id of ['s-1', 's-2', 's-3', 's-4', 's-4-1', 's-5']) {
    assert.ok(html.includes(`id="${id}"`), `${id} があること`);
  }
});

test('紹介記事があるときは、そこへのパンくずと導線を出す', () => {
  const html = page({ hasArticle: true });
  assert.ok(html.includes('<a href="/apps/schoolplan-editor/">週案エディタ</a>'));
  assert.ok(html.includes('つくった理由を読む'));
});

test('紹介記事が無いアプリでは、404 になる先を指さない', () => {
  /* /apps/<slug>/ は build-articles.mjs が作るもので、記事の無いアプリには無い */
  const html = page({ hasArticle: false });
  assert.ok(!html.includes('href="/apps/schoolplan-editor/"'), 'パンくずも導線も出さないこと');
  assert.ok(!html.includes('つくった理由を読む'));
  assert.ok(!html.includes('"item": "https://giga-school.com/apps/schoolplan-editor/"'),
    'JSON-LD のパンくずにも出さないこと');
  /* マニュアル自身への道は残る */
  assert.ok(html.includes('https://giga-school.com/apps/schoolplan-editor/manual/'));
});

test('利用規約とプライバシーは、届くと確かめたものだけ出す', () => {
  const none = page();
  assert.ok(!none.includes('利用規約'), '渡していなければ 1 度も出さない');
  assert.ok(!none.includes('プライバシーポリシー'));

  const both = page({
    termsUrl: 'https://schoolplan-editor.giga-school.com/terms.html',
    privacyUrl: 'https://schoolplan-editor.giga-school.com/privacy.html',
  });
  assert.ok(both.includes('href="https://schoolplan-editor.giga-school.com/terms.html"'));
  assert.ok(both.includes('href="https://schoolplan-editor.giga-school.com/privacy.html"'));

  const one = page({ termsUrl: 'https://schoolplan-editor.giga-school.com/terms.html' });
  assert.ok(one.includes('利用規約'));
  assert.ok(!one.includes('プライバシーポリシー'), '片方だけでも出せること');
});

test('「学校で使うときは」は data/apps.json から組む（手書きさせない）', () => {
  const html = page();
  assert.ok(html.includes('学校で使うときは'));
  /* 自分のサブドメインは必ず要る。hostsOf がそれを足している */
  assert.ok(html.includes('schoolplan-editor.giga-school.com'));
  assert.ok(html.includes('script.google.com'));
  assert.ok(html.includes('アプリ本体が動く場所'), '何のためのアドレスかを添えること');
  assert.ok(html.includes('Google アカウントが必要'));
  assert.ok(html.includes('記録は Google に保存'));
  assert.ok(html.includes('href="/filtering/"'), '一覧への道があること');
});

test('書いていない項目は出さない（「まだ決めていない」を「不要」と読ませない）', () => {
  const html = schoolSection({ ...APP, account: undefined, storage: undefined, grades: undefined });
  assert.ok(!html.includes('アカウント'));
  assert.ok(!html.includes('記録の置き場所'));
  /* アドレスは slug から必ず出る */
  assert.ok(html.includes('schoolplan-editor.giga-school.com'));
});

test('印刷のための仕掛けがある', () => {
  const html = page();
  assert.ok(html.includes('data-print'), '印刷のボタン');
  assert.ok(html.includes('class="manual__url"'), '紙から戻ってこられる URL');
  assert.ok(html.includes('https://giga-school.com/apps/schoolplan-editor/manual/ にあります'));
  /* 紙に写しても押せないものには no-print を付ける */
  for (const part of ['crumbs no-print', 'article__actions no-print', 'article__sticky no-print']) {
    assert.ok(html.includes(part), `${part} があること`);
  }
});

test('コピーのボタンを拾う copy.js を読んでいる', () => {
  /* 2026-08-29 に紹介ページ 32 本で踏んだのと同じ穴 */
  const html = page();
  assert.ok(html.includes('data-copy='));
  assert.ok(html.includes('/assets/copy.js'));
});

test('アプリ名の記号を落とす', () => {
  const html = manualPage({
    app: { ...APP, name: 'A&B <script>' }, manual: render(), hasArticle: false,
  });
  assert.ok(html.includes('A&amp;B &lt;script&gt;'));
  assert.ok(!html.includes('<script>A'), '生の記号を通さないこと');
});

test('章の数と読む時間を出す', () => {
  const html = page();
  assert.match(html, /全 5 章・読むのに約 \d+ 分/);
});

test('画面写真がサブドメインのものなら、共有の絵にそれを使う', () => {
  const html = page();
  assert.ok(html.includes('<meta property="og:image" content="https://schoolplan-editor.giga-school.com/manual/images/01-home.png">'));
});

test('画面写真が raw のときは、共有の絵に使わない（クローラが取れない）', () => {
  const md = MD.replace('https://schoolplan-editor.giga-school.com/manual/images/01-home.png',
    'https://raw.githubusercontent.com/GIGAyama/SchoolPlan_Editor/HEAD/docs/manual/images/01-home.png');
  const html = manualPage({ app: APP, manual: render(md), hasArticle: true });
  assert.ok(!html.includes('og:image" content="https://raw.'));
  assert.ok(html.includes('og:image" content="https://giga-school.com/assets/og.png"'));
});

test('manual.md が変わった日を出す（アプリの push 日ではない）', () => {
  /* 印刷して配るものなので「いつの画面か」で嘘をつかない */
  const html = page({ updatedAt: '2026-08-20' });
  assert.ok(html.includes('<time datetime="2026-08-20">2026/08/20</time> 現在の画面です'));
  assert.ok(html.includes('（2026/08/20 現在）'));
});

test('見出しの目印に、ページ上でも重みが付く', () => {
  /* 目印を目次の文字としてしか扱わないと、書き手は色が付くつもりで書いて、
     出てきたページでは他の節とまったく同じ見え方になる */
  const html = markHeadings('<h3 id="s-2-1">【重要】自分用のコピーを作る</h3>');
  assert.ok(html.includes('<h3 id="s-2-1" class="prose__h--important">'));
  assert.ok(html.includes('【重要】自分用のコピーを作る'), '目印の字は消さない（目次と索引に同じ字で出る）');
});

test('取り返しのつかない操作の目印は、注意より強く出る', () => {
  /* 【！！】は【！】を含まないが、順を取り違えると弱いほうに落ちる形なので固定する */
  assert.ok(markHeadings('<h2 id="s-9">【！！】データベースを消す</h2>')
    .includes('class="prose__h--danger"'));
  assert.ok(markHeadings('<h3 id="s-9-1">【！】書き込む前に確かめる</h3>')
    .includes('class="prose__h--note"'));
});

test('目印の無い見出しは、そのまま通す', () => {
  const before = '<h2 id="s-1">はじめに</h2><h3 id="s-1-1">このマニュアルについて</h3>';
  assert.equal(markHeadings(before), before);
});

test('目印のクラスは style.css に実体がある', async () => {
  /* クラスだけ振って装飾が無いと、書き手には何も起きていないのと同じになる */
  const css = await readFile(new URL('../../assets/style.css', import.meta.url), 'utf8');
  for (const cls of ['prose__h--important', 'prose__h--danger', 'prose__h--note']) {
    assert.ok(css.includes(`.${cls}`), `${cls} の装飾が style.css に無い`);
  }
});

/* ── 見出しの目印とふりがな ──────────────────────────────
 * 子ども向けのマニュアルは、書式のとおりに書くと
 * 【<ruby>重要<rt>じゅうよう</rt></ruby>】になる（重も要も 1年配当より上）。
 * 素のまま探すと目印が見つからず、書き手は色が付くつもりで書いたのに、
 * いちばん強い注意の節が他とまったく同じ見え方になる。
 */

test('目印にふりがなが振ってあっても、見出しに重みが付く', () => {
  const html = '<h2 id="s-1">【<ruby>重要<rt>じゅうよう</rt></ruby>】かならず '
    + '<ruby>読<rt>よ</rt></ruby>む</h2>';
  const out = markHeadings(html);
  assert.match(out, /class="prose__h--important"/);
  assert.match(out, /<ruby>重要<rt>じゅうよう<\/rt><\/ruby>/, '目印のふりがなまで落ちている');
});

test('【！！】は【重要】より先に見る（ふりがなが入っても順は変わらない）', () => {
  const html = '<h2 id="s-1">【！！】<ruby>取<rt>と</rt></ruby>りけせません</h2>';
  assert.match(markHeadings(html), /class="prose__h--danger"/);
});

test('目印が無い見出しは、そのまま返す', () => {
  const html = '<h2 id="s-1"><ruby>設定<rt>せってい</rt></ruby>を かえる</h2>';
  assert.equal(markHeadings(html), html);
});
