/**
 * 赤を Issue にして届けるところの計算。
 *
 * ここが崩れると 2 通りに壊れる。
 *   ・立たない    … 52 日つづいた赤（2026-09-19 〜 11-09）に戻る
 *   ・立ちすぎる  … 毎朝の通知は 3 日で読まれなくなり、やはり同じ場所に戻る
 * どちらも「検査は動いているのに誰も知らない」になるので、両方を固定する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marker, parseMarker, digestOf, clip, issueBody, planReport, findExisting,
} from './issue-report.mjs';

const KEY = 'check-distribution';
const base = { key: KEY, title: '配布のとりのこしが赤いままです', today: '2026-11-10' };
const DETAIL = '❌ GIGAyama に、台帳へ載っていないリポジトリが 1 件あります: Hiding-animal';

test('目印は書いたとおりに読みもどせる', () => {
  const m = marker(KEY, { first: '2026-09-19', count: 52, digest: 'abc123' });
  assert.deepEqual(parseMarker(`${m}\n本文`, KEY), { first: '2026-09-19', count: 52, digest: 'abc123' });
});

test('別の検査の目印は、自分のものとして読まない', () => {
  const m = marker('fleet-ci', { first: '2026-11-01', count: 1, digest: 'x' });
  assert.equal(parseMarker(m, KEY), null);
  // 名前が前のほうだけ同じでも取りちがえない
  assert.equal(parseMarker(marker('check-distribution-2', { first: 'a', count: 1, digest: 'x' }), KEY), null);
});

test('赤くなって、まだ Issue が無ければ立てる', () => {
  const plan = planReport({ ...base, status: 'failure', existing: null, detail: DETAIL, runUrl: 'https://example.test/run/1' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].op, 'create');
  assert.equal(plan[0].title, base.title);
  assert.match(plan[0].body, /Hiding-animal/);
  assert.match(plan[0].body, /https:\/\/example\.test\/run\/1/);
  assert.deepEqual(parseMarker(plan[0].body, KEY), { first: '2026-11-10', count: 1, digest: digestOf(DETAIL) });
});

test('同じ赤がつづく朝は、本文を書き替えるだけ（通知を足さない）', () => {
  const first = planReport({ ...base, status: 'failure', existing: null, detail: DETAIL, today: '2026-09-19' })[0];
  const plan = planReport({ ...base, status: 'failure', existing: { number: 7, body: first.body }, detail: DETAIL });
  assert.deepEqual(plan.map((a) => a.op), ['update']);
  // いつから赤いかは最初の日のまま。回数だけ進む
  assert.deepEqual(parseMarker(plan[0].body, KEY), { first: '2026-09-19', count: 2, digest: digestOf(DETAIL) });
});

test('実行の記録の URL と日付が変わっただけなら「同じ赤」と数える', () => {
  assert.equal(
    digestOf('❌ Typa を配っていません 2026-11-09 https://github.com/x/y/actions/runs/1'),
    digestOf('❌ Typa を配っていません 2026-11-10 https://github.com/x/y/actions/runs/2'),
  );
  assert.notEqual(digestOf('❌ Typa を配っていません'), digestOf('❌ Qalc を配っていません'));
});

test('赤いまま中身が変わったら、ひとこと足す（別の原因に替わったのを見のがさない）', () => {
  const first = planReport({ ...base, status: 'failure', existing: null, detail: DETAIL })[0];
  const plan = planReport({
    ...base, status: 'failure', existing: { number: 7, body: first.body },
    detail: '❌ Typa\n     - tools/build-sw.mjs: 正本 standards/sw/build-sw-static.mjs を配っていません',
  });
  assert.deepEqual(plan.map((a) => a.op), ['update', 'comment']);
  assert.match(plan[1].body, /中身が変わりました/);
  assert.match(plan[1].body, /build-sw/);
});

test('7 回つづいたら、もう一度だけ声をかける。6 回目と 8 回目は黙っている', () => {
  const bodyAt = (count) => issueBody({ key: KEY, detail: DETAIL, first: '2026-09-19', count, today: '2026-09-25' });
  const ops = (count) => planReport({ ...base, status: 'failure', existing: { number: 7, body: bodyAt(count) }, detail: DETAIL })
    .map((a) => a.op);
  assert.deepEqual(ops(5), ['update']);              // 6 回目
  assert.deepEqual(ops(6), ['update', 'comment']);   // 7 回目
  assert.deepEqual(ops(7), ['update']);              // 8 回目
  assert.deepEqual(ops(13), ['update', 'comment']);  // 14 回目
});

test('緑に戻ったら、ひとこと残して閉じる', () => {
  const body = issueBody({ key: KEY, detail: DETAIL, first: '2026-09-19', count: 52, today: '2026-11-09' });
  const plan = planReport({ ...base, status: 'success', existing: { number: 7, body } });
  assert.deepEqual(plan.map((a) => a.op), ['comment', 'close']);
  assert.match(plan[0].body, /2026-09-19 から 52 回/);
  assert.equal(plan[1].number, 7);
});

test('緑で、Issue も無ければ何もしない', () => {
  assert.deepEqual(planReport({ ...base, status: 'success', existing: null }), []);
});

test('取り消された回は、赤でも緑でもない。閉じも立てもしない', () => {
  const body = issueBody({ key: KEY, detail: DETAIL, first: '2026-09-19', count: 3, today: '2026-09-21' });
  assert.deepEqual(planReport({ ...base, status: 'cancelled', existing: { number: 7, body } }), []);
  assert.deepEqual(planReport({ ...base, status: 'cancelled', existing: null }), []);
  assert.deepEqual(planReport({ ...base, status: '', existing: null }), []);
});

test('検査の出力が無くても立てる（検査まで届かずに落ちた朝）', () => {
  const plan = planReport({ ...base, status: 'failure', existing: null, detail: '' });
  assert.equal(plan[0].op, 'create');
  assert.match(plan[0].body, /検査の出力はありません/);
});

test('直し方を渡したら、本文に出る', () => {
  const plan = planReport({ ...base, status: 'failure', existing: null, detail: DETAIL, hint: 'docs/operations/pat-token.md を見る' });
  assert.match(plan[0].body, /直し方: docs\/operations\/pat-token\.md を見る/);
});

test('長い出力は後ろを残して切る（結論は最後に出る）', () => {
  const long = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
  const out = clip(long);
  assert.match(out, /^（長いので後ろだけ）/);
  assert.match(out, /line 299$/);
  assert.doesNotMatch(out, /line 0\n/);
  assert.ok(out.length < 7000);
});

test('出力に ``` があっても、本文の囲みが割れない', () => {
  const body = issueBody({ key: KEY, detail: 'a\n```\nb', first: 'x', count: 1, today: 'x' });
  assert.equal(body.match(/```/g).length, 2);
});

test('開いている Issue から、この検査のものだけを拾う。PR は混ぜない', () => {
  const mine = issueBody({ key: KEY, detail: DETAIL, first: '2026-09-19', count: 1, today: '2026-09-19' });
  const other = issueBody({ key: 'fleet-ci', detail: 'x', first: '2026-09-19', count: 1, today: '2026-09-19' });
  const issues = [
    { number: 3, body: 'ふつうの Issue' },
    { number: 9, body: mine, pull_request: {} },     // PR の本文に同じ目印があっても使わない
    { number: 12, body: other },
    { number: 15, body: mine },
    { number: 14, body: mine },
    { number: 20, body: null },
  ];
  assert.equal(findExisting(issues, KEY).number, 14);   // 2 本あれば古いほう
  assert.equal(findExisting(issues, 'fleet-ci').number, 12);
  assert.equal(findExisting(issues, 'nothing'), null);
  assert.equal(findExisting(null, KEY), null);
});
