/**
 * 日付を日本時間で切るところのテスト。
 *
 * 朝の組み直しは UTC 21:17 に走る（日本時間では翌朝 6:17）。UTC で切ると
 * 必ず前日の日付になり、公開ページの「最終更新」が 1 日古いまま出る。
 * ここが崩れると、ずれ方が日によって違うので目では追えない。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayJst, jstDate } from './dates.mjs';

test('朝の組み直しの時刻（UTC 21:17）は、日本時間では翌日になる', () => {
  assert.equal(todayJst(new Date('2026-08-29T21:17:00Z')), '2026-08-30');
});

test('UTC の 15:00 が日本時間の日付の変わり目', () => {
  assert.equal(todayJst(new Date('2026-08-29T14:59:59Z')), '2026-08-29');
  assert.equal(todayJst(new Date('2026-08-29T15:00:00Z')), '2026-08-30');
});

test('「いま」は引数で受ける（同じ入力なら同じ答え）', () => {
  const now = new Date('2026-08-29T21:17:00Z');
  assert.equal(todayJst(now), todayJst(now));
});

test('GitHub API の ISO 時刻を、日本時間の日付にする', () => {
  /* 実際に bot がコミットした時刻。UTC のまま切ると 08-29 になる */
  assert.equal(jstDate('2026-08-29T23:21:48Z'), '2026-08-30');
  assert.equal(jstDate('2026-08-29T00:10:42Z'), '2026-08-29');
});

test('オフセット付きの ISO でも、日本時間の日付になる', () => {
  assert.equal(jstDate('2026-08-30T07:25:17+00:00'), '2026-08-30');
  assert.equal(jstDate('2026-08-29T20:00:00-05:00'), '2026-08-30');
});

test('読めない値では空文字を返す（朝の流れを止めない）', () => {
  assert.equal(jstDate(''), '');
  assert.equal(jstDate(null), '');
  assert.equal(jstDate(undefined), '');
  assert.equal(jstDate('きのう'), '');
});
