/**
 * 画面写真の読む先を決めるところのテスト。
 *
 * ここが静かに壊れると、紹介ページの画像が出なくなる。しかも本文は出るので、
 * ページ全体が落ちるわけではなく、絵の入るはずの場所が空くだけになる。
 * 朝の組み直しで毎日そのまま作り直されるため、誰かが目で見つけるまで残る。
 * 実際 2026-08-25 に qalc で 2 枚が消え、5 枚が古いまま出ていた。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickImageUrl } from './article-images.mjs';

const onMirror = (t) => `/assets/article/qalc/${t.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '.webp')}`;
const onRaw = (t) => `https://raw.githubusercontent.com/GIGAyama/Qalc/HEAD/docs/note/${t}`;
const pick = (names) => pickImageUrl({ inMirror: new Set(names), onMirror, onRaw });

test('控えにあるものは控えを指す', () => {
  const url = pick(['01-home.webp'])('images/01-home.png');
  assert.equal(url, '/assets/article/qalc/01-home.webp');
});

test('控えに無いものは raw に落ちる', () => {
  const url = pick(['01-home.webp'])('images/03b-memo-pad.png');
  assert.equal(url, 'https://raw.githubusercontent.com/GIGAyama/Qalc/HEAD/docs/note/images/03b-memo-pad.png');
});

test('あとから足した 1 枚だけが raw になり、残りは控えのまま', () => {
  // 前の作りだと、1 枚目に控えがある時点で記事ぜんぶが控えを指し、
  // 足した 1 枚は 404 のまま出ていた
  const choose = pick(['01-home.webp', '02-drill-select.webp']);
  const got = ['images/01-home.png', 'images/02-drill-select.png', 'images/03b-memo-pad.png'].map(choose);
  assert.equal(got.filter((u) => u.startsWith('/assets/')).length, 2);
  assert.equal(got.filter((u) => u.startsWith('https://raw.')).length, 1);
});

test('控えが 1 枚も無ければ、全部 raw になる', () => {
  const choose = pick([]);
  const got = ['images/01-home.png', 'images/09-result.png'].map(choose);
  assert.ok(got.every((u) => u.startsWith('https://raw.')));
});

test('拡張子が違っても控えの名前は .webp で引く', () => {
  assert.equal(pick(['05-tool.webp'])('images/05-tool.jpg'), '/assets/article/qalc/05-tool.webp');
});
