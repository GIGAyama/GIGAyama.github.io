/**
 * 朝の組み直しのうち、GitHub の見えかたに左右される部分のテスト。
 *
 * ⚠️ ここが崩れると、**GitHub が見えなかっただけの朝に台帳を消してコミットする**。
 *    公開ページからは全アプリの更新ログが消え、翌朝また戻る。人が見て気づける
 *    形ではないので（毎朝コミットが立つのは元々そうだった）、検査で押さえる。
 *    2026-08-29 に紹介ページ 32 本が消えたのと同じ型。
 *
 * ⚠️ tools/sync-updates.mjs は import しても走らない（invokedDirectly）。
 *    もし走るようになったら、このテストが GitHub を叩きはじめるので気づける。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIndexEdits, mergeChangelogs } from './sync-updates.mjs';

const BEFORE = { Qalc: '## 2026-08-01\n- 前の中身\n', Typa: '## 2026-07-01\n- 前の中身\n' };

test('ふつうに取れた朝は、取れたものに入れ替える', () => {
  const got = { changelogs: { Qalc: '## 2026-08-23\n- 新しい中身\n' }, unread: [] };
  assert.deepEqual(mergeChangelogs(BEFORE, got, 2),
    { apps: { Qalc: '## 2026-08-23\n- 新しい中身\n' }, held: 0 });
});

test('消されたものは消える（書き手が消したら、その朝に消える）', () => {
  const got = { changelogs: {}, unread: [] };
  assert.deepEqual(mergeChangelogs(BEFORE, got, 2), { apps: {}, held: 0 });
});

test('1 本だけ読めなかったら、その 1 本は前の値を据え置く', () => {
  const got = { changelogs: { Qalc: '## 2026-08-23\n- 新しい中身\n' }, unread: ['Typa'] };
  const merged = mergeChangelogs(BEFORE, got, 2);
  assert.equal(merged.held, 1);
  assert.equal(merged.apps.Typa, BEFORE.Typa, '読めなかった 1 本が消えている');
  assert.equal(merged.apps.Qalc, '## 2026-08-23\n- 新しい中身\n');
});

test('1 本も読めなかった朝は、1 文字も書き替えない', () => {
  /* GitHub が見えていないだけ。ここで null を返さないと、台帳を空で上書きして
     コミットし、全アプリの更新ログが公開ページから消える。 */
  const got = { changelogs: {}, unread: ['Qalc', 'Typa'] };
  assert.equal(mergeChangelogs(BEFORE, got, 2), null);
});

test('読めなかったものが前の台帳にも無ければ、増やさない', () => {
  const got = { changelogs: {}, unread: ['Hajimete'] };
  assert.deepEqual(mergeChangelogs(BEFORE, got, 3), { apps: {}, held: 0 });
});

test('見に行く相手が 0 本のときは、書き替えない側に倒さない', () => {
  /* hidden ばかりで対象が 0 本、という形。unread も 0 なので「全部失敗」ではない */
  assert.deepEqual(mergeChangelogs({}, { changelogs: {}, unread: [] }, 0), { apps: {}, held: 0 });
});

/* ── ポータル自身の更新ログ ───────────────────────────────
 *
 * ⚠️ ポータルは data/apps.json に載っていない。appOf がここを拾わないと、
 *    docs/CHANGELOG.md を書いても**どこにも出ない**。出しどころの無い所へ
 *    書かせるのは、更新ログの決まり（書いていないアプリには何も出ない）を
 *    裏返すことになるので、出す側を検査で押さえておく。
 */

const RAW = [
  '<main>',
  '<!-- updates:start -->',
  'ここが差し替わる',
  '      <!-- updates:end -->',
  '</main>',
].join('\n');

const DATA = {
  items: [{
    repo: 'Qalc', name: '計算れんしゅう', kind: 'app', slug: 'qalc',
    category: 'sansu', publishedAt: '2026-06-01', updatedAt: '2026-08-01',
  }],
};

const build = (changelogs) => applyIndexEdits(
  RAW, { data: DATA, articles: [], manuals: [], changelogs }, '2026-08-31',
);

test('ポータル自身が書いた更新ログも、トップの「更新したこと」に出る', () => {
  const html = build({ 'GIGAyama.github.io': '## 2026-08-30\n- 字が小さくて読みにくかったのを直しました\n' });
  assert.ok(html.includes('giga-school.com（このサイト）'), 'サイト自身の名前が出ていない');
  assert.ok(html.includes('字が小さくて読みにくかったのを直しました'));
});

test('ポータルの行き先はトップ（data/apps.json に載っていないので slug が無い）', () => {
  const html = build({ 'GIGAyama.github.io': '## 2026-08-30\n- なにかを直しました\n' });
  assert.ok(html.includes('href="/"'), 'リンク先が無いと、書いても押せない行になる');
});

test('配布先のアプリと並べて出せる', () => {
  const html = build({
    'GIGAyama.github.io': '## 2026-08-30\n- サイトの字を大きくしました\n',
    Qalc: '## 2026-08-30\n- ヒントを出せるようにしました\n',
  });
  assert.ok(html.includes('giga-school.com（このサイト）'));
  assert.ok(html.includes('計算れんしゅう'));
});

test('ポータルが書いていなければ、何も増えない', () => {
  const html = build({ Qalc: '## 2026-08-30\n- ヒントを出せるようにしました\n' });
  assert.ok(!html.includes('giga-school.com（このサイト）'));
});

test('data/apps.json に載っていないリポジトリは、これまでどおり落とす', () => {
  /* ポータルだけを名指しで通す。名前の分からないものまで通すと、
     消したリポジトリの更新ログが名無しで出つづける。 */
  const html = build({ 'GIGAyama/なにか': '## 2026-08-30\n- なにかを直しました\n' });
  assert.ok(!html.includes('なにかを直しました'));
});
