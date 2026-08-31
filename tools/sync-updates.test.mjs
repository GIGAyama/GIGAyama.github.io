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
import { mergeChangelogs } from './sync-updates.mjs';

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
