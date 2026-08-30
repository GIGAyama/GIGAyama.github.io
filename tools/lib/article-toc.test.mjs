/**
 * 目次と読了時間のテスト。
 *
 * ここが静かに壊れると、31 本の紹介ページの目次が一斉に壊れる。
 * しかも朝の組み直しで上書きされるので、気づいたときには全部が同じ形で崩れている。
 * とくに「何度通しても同じ結果になること」は、手元で当て直したページと
 * 朝の組み直しの結果を一致させるための前提なので、必ず見ておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingOf, tocOf, withAnchors } from './article-toc.mjs';

const BODY = [
  '<h2>🏫 はじめに</h2>',
  '<p>本文。</p>',
  '<h2>📱 このアプリでできること</h2>',
  '<h3>ひとつめ</h3>',
  '<h3>ふたつめ</h3>',
  '<h2>📝 まとめ</h2>',
].join('\n');

test('見出しに連番の id を振る', () => {
  const { html, headings } = withAnchors(BODY);
  assert.match(html, /<h2 id="s-1">🏫 はじめに<\/h2>/);
  assert.match(html, /<h2 id="s-2">/);
  assert.match(html, /<h3 id="s-2-1">ひとつめ<\/h3>/);
  assert.match(html, /<h3 id="s-2-2">/);
  assert.match(html, /<h2 id="s-3">/);
  assert.equal(headings.length, 5);   // h2 が 3 本と h3 が 2 本
  assert.deepEqual(headings[0],
    { level: 2, id: 's-1', text: '🏫 はじめに', label: '🏫 はじめに' });
});

test('何度通しても同じ結果になる', () => {
  const once = withAnchors(BODY).html;
  const twice = withAnchors(once).html;
  assert.equal(once, twice);
});

test('見出しの中のリンクは、目次では文字だけにする', () => {
  const { headings } = withAnchors('<h2>詳しくは<a href="https://example.com">こちら</a></h2>');
  assert.equal(headings[0].text, '詳しくはこちら');
});

test('h1 と h4 は目次に入れない', () => {
  const { html, headings } = withAnchors('<h1>題</h1><h4>細目</h4>');
  assert.equal(headings.length, 0);
  assert.equal(html, '<h1>題</h1><h4>細目</h4>');
});

test('目次は h2 を並べ、h3 はその下にぶら下げる', () => {
  const toc = tocOf(withAnchors(BODY).headings);
  assert.match(toc, /<details class="toc" open>/);
  assert.match(toc, /<a href="#s-1">🏫 はじめに<\/a>/);
  assert.match(toc, /<ol class="toc__sub"><li><a href="#s-2-1">ひとつめ<\/a><\/li>/);
  /* h3 は h2 の <li> の中。閉じてから次の h2 が来る */
  assert.ok(toc.indexOf('#s-2-2') < toc.indexOf('#s-3'));
});

test('見出しが 2 本しかない記事には目次を出さない', () => {
  const { headings } = withAnchors('<h2>ひとつ</h2><h2>ふたつ</h2>');
  assert.equal(tocOf(headings), '');
  assert.equal(tocOf([]), '');
});

test('読む時間は、タグと空白を除いた文字数から出す', () => {
  /* 2,500 字ちょうどなら 5 分 */
  const text = 'あ'.repeat(2500);
  const { minutes, chars } = readingOf(`<p>${text}</p>\n<p>   </p>`);
  assert.equal(chars, 2500);
  assert.equal(minutes, 5);
});

test('読む時間は 5 分単位に丸め、下は 5 分で止める', () => {
  assert.equal(readingOf('あ'.repeat(7300)).minutes, 15);
  assert.equal(readingOf('あ'.repeat(100)).minutes, 5);
  assert.equal(readingOf('').minutes, 5);
});

/* ── ふりがな（子ども向けマニュアルの見出し） ───────────────────
 * 2026-08-30、Qalc の使い方マニュアルで目次が
 * 「1ねん学がく年ねんから…」になった。見出しからタグを外すだけだと
 * <rt> の中身が残る。詳しくは plain-text.mjs。
 */

const RUBY_BODY = [
  '<h2>1<ruby>年<rt>ねん</rt></ruby>から6<ruby>年<rt>ねん</rt></ruby>まで</h2>',
  '<p>本文。</p>',
  '<h2>つかいかた</h2>',
  '<p>本文。</p>',
  '<h2>こまったとき</h2>',
  '<p>本文。</p>',
].join('\n');

test('見出しのふりがなは、数える側の文字には入らない', () => {
  const { headings } = withAnchors(RUBY_BODY);
  assert.equal(headings[0].text, '1年から6年まで');
});

test('目次のリンクにはふりがなを残す', () => {
  // 目次は、漢字が読めない子が最初に見るところ。ここで振り仮名が消えると読めない
  const { headings } = withAnchors(RUBY_BODY);
  const toc = tocOf(headings);
  assert.match(toc, /<ruby>年<rt>ねん<\/rt><\/ruby>/);
  assert.ok(!toc.includes('年ねん'), '目次に「年ねん」が出ている');
});

test('見出しの中のリンクは目次で入れ子にしない', () => {
  const { headings } = withAnchors([
    '<h2><a href="/x">はじめに</a></h2>',
    '<h2>つぎ</h2>',
    '<h2>おわり</h2>',
  ].join('\n'));
  const toc = tocOf(headings);
  assert.ok(!/<a[^>]*>[^<]*<a/.test(toc), '目次の <a> の中に <a> が入っている');
});

test('読む時間にふりがなを数えない', () => {
  // 総ルビに近い本文だと、数に入れると読む時間が倍近く出る
  const plain = readingOf('<p>' + '学年'.repeat(500) + '</p>');
  const ruby = readingOf('<p>' + '<ruby>学年<rt>がくねん</rt></ruby>'.repeat(500) + '</p>');
  assert.equal(ruby.chars, plain.chars);
});
