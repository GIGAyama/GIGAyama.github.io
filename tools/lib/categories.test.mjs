/**
 * 分類の表のテスト。
 *
 * 学年の書きかたを間違えると、31 本の紹介ページに一斉に出る。
 * しかも「3〜6年生」と「3・6年生」は見た目が近いので、
 * 目で読んでも気づきにくい。ここで押さえておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_LABEL, CATEGORY_LABEL, STORAGE_LABEL, USE_LABEL, gradeLabel } from './categories.mjs';

test('続きの学年は「〜」でまとめる', () => {
  assert.equal(gradeLabel([1, 2, 3, 4, 5, 6]), '1〜6年生');
  assert.equal(gradeLabel([3, 4, 5, 6]), '3〜6年生');
  assert.equal(gradeLabel([1, 2]), '1〜2年生');
});

test('1 つだけならその学年', () => {
  assert.equal(gradeLabel([1]), '1年生');
  assert.equal(gradeLabel([2]), '2年生');
});

test('飛んでいる学年は「・」でつなぐ', () => {
  assert.equal(gradeLabel([1, 3]), '1・3年生');
  assert.equal(gradeLabel([1, 2, 4, 5, 6]), '1〜2・4〜6年生');
});

test('並びが逆でも重複していても、同じ書きかたになる', () => {
  assert.equal(gradeLabel([6, 5, 4, 3, 2, 1]), '1〜6年生');
  assert.equal(gradeLabel([2, 2, 1]), '1〜2年生');
});

test('空・未設定・ありえない値は、何も出さない', () => {
  /* [] は「児童が使うものではない」、undefined は「まだ決めていない」。
     どちらもチップを出さないので、同じ空文字でよい。 */
  assert.equal(gradeLabel([]), '');
  assert.equal(gradeLabel(undefined), '');
  assert.equal(gradeLabel(null), '');
  assert.equal(gradeLabel([0, 7, 9]), '');
  assert.equal(gradeLabel('1年'), '');
  assert.equal(gradeLabel([9, 1]), '1年生');   // 使える値だけ拾う
});

test('分類の表に抜けがない', () => {
  assert.equal(Object.keys(CATEGORY_LABEL).length, 8);
  assert.equal(Object.keys(USE_LABEL).length, 8);
  for (const label of [...Object.values(CATEGORY_LABEL), ...Object.values(USE_LABEL)]) {
    assert.ok(label.length > 0, '表示名が空でない');
  }
});

test('導入を決めるための表に、想定した値がそろっている', () => {
  assert.deepEqual(Object.keys(ACCOUNT_LABEL), ['none', 'google', 'teacher']);
  assert.deepEqual(Object.keys(STORAGE_LABEL), ['device', 'none', 'google']);
  /* 「不要」と「必要」を取り違えると、学校が誤った前提で判断する */
  assert.match(ACCOUNT_LABEL.none, /不要/);
  assert.match(ACCOUNT_LABEL.google, /必要/);
  assert.match(STORAGE_LABEL.none, /残さない/);
  assert.match(STORAGE_LABEL.device, /端末の中/);
});

test('data/apps.json の値が、表にあるものだけでできている', async () => {
  const { readFile } = await import('node:fs/promises');
  const url = new URL('../../data/apps.json', import.meta.url);
  const items = JSON.parse(await readFile(url, 'utf8')).items;
  for (const a of items) {
    if (a.account !== undefined) {
      assert.ok(ACCOUNT_LABEL[a.account], `${a.slug} の account「${a.account}」は表にある`);
    }
    if (a.storage !== undefined) {
      assert.ok(STORAGE_LABEL[a.storage], `${a.slug} の storage「${a.storage}」は表にある`);
    }
    if (a.grades !== undefined) {
      assert.ok(Array.isArray(a.grades), `${a.slug} の grades は配列`);
    }
  }
});
