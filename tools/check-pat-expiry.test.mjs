/**
 * 配布のトークンの期限を読むところ。
 *
 * 切れると 43 本ぜんぶが 403 で落ちる。切れる前に言えなければ、この検査は
 * 在る意味が無い。「読めなかった」を「大丈夫」と言わないことも固定する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpiry, expiryVerdict } from './check-pat-expiry.mjs';

const now = new Date('2026-11-10T00:00:00Z');

test('GitHub が返す 2 つの形を読む（UTC と、時差つき）', () => {
  assert.equal(parseExpiry('2026-11-27 08:15:27 UTC').toISOString(), '2026-11-27T08:15:27.000Z');
  assert.equal(parseExpiry('2026-11-27 08:15:27 +0900').toISOString(), '2026-11-26T23:15:27.000Z');
  assert.equal(parseExpiry('2026-11-27 08:15:27 -0800').toISOString(), '2026-11-27T16:15:27.000Z');
});

test('読めない形は null（今日の日付などで埋めない）', () => {
  assert.equal(parseExpiry('soon'), null);
  assert.equal(parseExpiry(''), null);
  assert.equal(parseExpiry(null), null);
  assert.equal(parseExpiry('2026-13-45 99:99:99 UTC'), null);
});

test('期限まで長ければ通す', () => {
  const v = expiryVerdict({ status: 200, header: '2027-02-01 00:00:00 UTC', now });
  assert.equal(v.ok, true);
  assert.equal(v.daysLeft, 83);
});

test('あと 14 日を切ったら落とす。15 日なら通す', () => {
  assert.equal(expiryVerdict({ status: 200, header: '2026-11-24 00:00:00 UTC', now }).ok, false);   // 14 日
  assert.equal(expiryVerdict({ status: 200, header: '2026-11-25 00:00:00 UTC', now }).ok, true);    // 15 日
  const v = expiryVerdict({ status: 200, header: '2026-11-13 12:00:00 UTC', now });
  assert.equal(v.ok, false);
  assert.match(v.message, /あと 3 日で切れます（2026-11-13）/);
});

test('何日前から言うかは変えられる', () => {
  assert.equal(expiryVerdict({ status: 200, header: '2026-12-05 00:00:00 UTC', now, warnDays: 30 }).ok, false);
  assert.equal(expiryVerdict({ status: 200, header: '2026-12-05 00:00:00 UTC', now, warnDays: 14 }).ok, true);
});

test('もう切れているものは、切れていると言う', () => {
  const v = expiryVerdict({ status: 200, header: '2026-11-01 00:00:00 UTC', now });
  assert.equal(v.ok, false);
  assert.match(v.message, /2026-11-01 に切れています/);
});

test('401 は「切れているか無効」。期限の見出しが在っても通さない', () => {
  const v = expiryVerdict({ status: 401, header: '2027-02-01 00:00:00 UTC', now });
  assert.equal(v.ok, false);
  assert.match(v.message, /HTTP 401/);
});

test('GitHub が見えなかった朝を「大丈夫」と言わない', () => {
  assert.equal(expiryVerdict({ status: 502, header: null, now }).ok, false);
  assert.equal(expiryVerdict({ status: 403, header: null, now }).ok, false);
});

test('見出しが無いのは期限なしのトークン。通す', () => {
  const v = expiryVerdict({ status: 200, header: null, now });
  assert.equal(v.ok, true);
  assert.match(v.message, /期限なし/);
});

test('見出しは在るのに読めなければ落とす（形が変わったのを黙って通さない）', () => {
  const v = expiryVerdict({ status: 200, header: 'Fri, 27 Nov 2026', now });
  assert.equal(v.ok, false);
  assert.match(v.message, /読めませんでした/);
});
