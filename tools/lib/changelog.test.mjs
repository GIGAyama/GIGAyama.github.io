/**
 * 更新の記録のテスト。
 *
 * 書いていないアプリに何かが出たり、書いたのに出なかったりすると、
 * 31 本ぶんを目で確かめることになる。ここで押さえておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelogSection, changesOf } from './changelog.mjs';

const MD = `# 更新の記録

このアプリの、使う人から見た変化を書いています。

## 2026-08-23
- 写真の上限をなくしました
- 音が出ない端末があったのを直しました

## 2026-06-01

## 2026-05-10
* はじめて公開しました
`;

test('日付ごとに、箇条書きを拾う', () => {
  const out = changesOf(MD);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    date: '2026-08-23',
    items: ['写真の上限をなくしました', '音が出ない端末があったのを直しました'],
  });
});

test('最初の日付より前の前書きは読み飛ばす', () => {
  const out = changesOf(MD);
  assert.ok(!JSON.stringify(out).includes('使う人から見た変化'));
});

test('中身の無い日付は出さない', () => {
  /* 見出しだけ書いて中身を忘れることがある */
  assert.ok(!changesOf(MD).some((e) => e.date === '2026-06-01'));
});

test('「-」でも「*」でも箇条書きとして読む', () => {
  assert.deepEqual(changesOf(MD)[1].items, ['はじめて公開しました']);
});

test('新しい順に並べ、数を絞る', () => {
  const md = ['## 2026-01-01\n- ふるい', '## 2026-09-09\n- あたらしい', '## 2026-05-05\n- まんなか'].join('\n');
  assert.deepEqual(changesOf(md).map((e) => e.date), ['2026-09-09', '2026-05-05', '2026-01-01']);
  assert.deepEqual(changesOf(md, 1).map((e) => e.date), ['2026-09-09']);
});

test('書いていなければ、空で返す', () => {
  assert.deepEqual(changesOf(''), []);
  assert.deepEqual(changesOf(undefined), []);
  assert.deepEqual(changesOf('# 見出しだけ\n\nふつうの文章。'), []);
});

test('節の HTML は、書いてあるときだけ出る', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;');
  assert.equal(changelogSection([], esc), '');
  assert.equal(changelogSection(undefined, esc), '');

  const html = changelogSection(changesOf(MD), esc);
  assert.match(html, /<h2 class="changes__title" id="changes-title">最近の更新<\/h2>/);
  assert.match(html, /<time datetime="2026-08-23">2026\/08\/23<\/time>/);
  assert.match(html, /<li>写真の上限をなくしました<\/li>/);
});

test('書いてある文字は、そのまま HTML にしない', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;');
  const html = changelogSection(changesOf('## 2026-01-01\n- <script>あぶない'), esc);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;|&lt;script/);
});
