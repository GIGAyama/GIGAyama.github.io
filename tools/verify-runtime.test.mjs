/**
 * verify-runtime.mjs の試験。
 *
 * ⚠️ ここで見ているのは「突き合わせの計算」だけ。実際の巡回は
 *    .github/workflows/verify-runtime.yml が週次で行う。
 *    **「試験が通った」を「本番を巡回した」と読まないこと。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHosts, liveUrl } from './verify-runtime.mjs';

test('公開先の組み立ては sync-updates.mjs と同じ形', () => {
  assert.equal(liveUrl('typa'), 'https://typa.giga-school.com/');
  assert.equal(liveUrl('xxx-automatic'), 'https://xxx-automatic.giga-school.com/');
});

test('推定と実測が同じなら、食い違いは出ない', () => {
  const r = compareHosts('typa', ['api.openbd.jp'], ['api.openbd.jp']);
  assert.deepEqual(r.onlyMeasured, []);
  assert.deepEqual(r.onlyDeclared, []);
});

test('実測にあって宣言に無いものを出す（申請書に載っていないのに読んでいる）', () => {
  const r = compareHosts('kanji-town', ['cdn.jsdelivr.net', 'fonts.gstatic.com'], ['cdn.jsdelivr.net']);
  assert.deepEqual(r.onlyMeasured, ['fonts.gstatic.com']);
});

test('宣言にあって実測に無いものを出す（もう読んでいないのに申請させている）', () => {
  const r = compareHosts('qalc', [], ['unpkg.com']);
  assert.deepEqual(r.onlyDeclared, ['unpkg.com']);
});

test('大文字小文字は同じものとして扱う', () => {
  const r = compareHosts('x', ['CDN.JSDelivr.NET'], ['cdn.jsdelivr.net']);
  assert.deepEqual(r.onlyMeasured, []);
  assert.deepEqual(r.onlyDeclared, []);
});

test('同じホストが何度出ても 1 件にまとめる', () => {
  const r = compareHosts('x', ['a.example', 'a.example'], []);
  assert.deepEqual(r.measured, ['a.example']);
});

test('宣言が無いアプリでも落ちない', () => {
  const r = compareHosts('x', ['a.example'], []);
  assert.deepEqual(r.onlyMeasured, ['a.example']);
  assert.deepEqual(r.onlyDeclared, []);
});

test('結果は並び順が決まっている（実行ごとに変わらない）', () => {
  const a = compareHosts('x', ['b.example', 'a.example'], []);
  const b = compareHosts('x', ['a.example', 'b.example'], []);
  assert.deepEqual(a.measured, b.measured);
});
