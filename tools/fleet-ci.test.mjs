/**
 * 艦隊の main の CI を集めるところの計算。
 *
 * この道具は「赤くない」と言うことに意味がある。だから、見ていないのに
 * 緑を出す形（測れなかった・1 件も読めなかった・走っている途中）を固定する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { latestPerWorkflow, redOf, summarize, repoIndex } from './fleet-ci.mjs';

const run = (o) => ({
  workflow_id: 1, name: 'CI', path: '.github/workflows/ci.yml', status: 'completed',
  conclusion: 'success', event: 'push', created_at: '2026-11-09T12:00:00Z',
  html_url: 'https://github.com/GIGAyama/Typa/actions/runs/1', ...o,
});

test('ワークフローごとに、いちばん新しい回だけを見る', () => {
  const latest = latestPerWorkflow([
    run({ workflow_id: 1, conclusion: 'failure' }),
    run({ workflow_id: 1, conclusion: 'success' }),     // 古い緑は、いまの赤を消さない
    run({ workflow_id: 2, name: 'Deploy', conclusion: 'success' }),
  ]);
  assert.equal(latest.length, 2);
  assert.deepEqual(redOf(latest).map((r) => r.name), ['CI']);
});

test('直ったあとは赤と言わない（新しい緑が、古い赤に勝つ）', () => {
  const latest = latestPerWorkflow([run({ conclusion: 'success' }), run({ conclusion: 'failure' })]);
  assert.deepEqual(redOf(latest), []);
});

test('走っている途中の回は飛ばして、その前の回を見る（配った直後の 43 本）', () => {
  const latest = latestPerWorkflow([
    run({ status: 'in_progress', conclusion: null }),
    run({ status: 'queued', conclusion: null }),
    run({ conclusion: 'failure' }),
  ]);
  assert.equal(redOf(latest).length, 1);
});

test('取り消された回・飛ばされた回は、赤とも緑とも数えない', () => {
  assert.equal(redOf(latestPerWorkflow([run({ conclusion: 'cancelled' }), run({ conclusion: 'failure' })])).length, 1);
  assert.equal(redOf(latestPerWorkflow([run({ conclusion: 'skipped' }), run({ conclusion: 'success' })])).length, 0);
  assert.deepEqual(latestPerWorkflow([run({ conclusion: 'cancelled' })]), []);
});

test('時間切れと、起動できなかった回は赤', () => {
  assert.equal(redOf(latestPerWorkflow([run({ conclusion: 'timed_out' })])).length, 1);
  assert.equal(redOf(latestPerWorkflow([run({ conclusion: 'startup_failure' })])).length, 1);
});

test('PR の回は、既定の枝の状態として数えない', () => {
  assert.deepEqual(latestPerWorkflow([run({ event: 'pull_request', conclusion: 'failure' })]), []);
});

test('一覧が配列でなくても落ちない（API のエラー本文を回として扱わない）', () => {
  assert.deepEqual(latestPerWorkflow(undefined), []);
  assert.deepEqual(latestPerWorkflow({ message: 'Not Found' }), []);
});

test('赤が 1 本でもあれば exit 1。どのリポジトリのどのワークフローかを言う', () => {
  const out = summarize([
    { repo: 'Typa', workflows: 2, red: redOf(latestPerWorkflow([run({ conclusion: 'failure' })])) },
    { repo: 'Qalc', workflows: 3, red: [] },
  ]);
  assert.equal(out.code, 1);
  const text = out.lines.join('\n');
  assert.match(text, /❌ Typa/);
  assert.match(text, /CI（\.github\/workflows\/ci\.yml）: failure/);
  assert.match(text, /actions\/runs\/1/);
  assert.doesNotMatch(text, /Qalc/);
});

test('ぜんぶ緑なら exit 0 で、見た本数を言う', () => {
  const out = summarize([{ repo: 'Typa', workflows: 2, red: [] }, { repo: 'Qalc', workflows: 3, red: [] }]);
  assert.equal(out.code, 0);
  assert.match(out.lines.join('\n'), /2 本・5 ワークフロー/);
});

test('測れなかった 1 本を、緑に数えない', () => {
  const out = summarize([{ repo: 'Typa', workflows: 2, red: [] }, { repo: 'Qalc', error: 'HTTP 502' }]);
  assert.equal(out.code, 1);
  assert.match(out.lines.join('\n'), /測れなかった: Qalc（HTTP 502）/);
  assert.doesNotMatch(out.lines.join('\n'), /✅/);
});

test('1 件も読めなかったら、赤が無いのではなく何も見ていない', () => {
  const out = summarize([{ repo: 'Typa', workflows: 0, red: [] }]);
  assert.equal(out.code, 1);
  assert.match(out.lines.join('\n'), /何も見ていません/);
});

test('アーカイブ済みは見ていないと言うが、それだけでは赤くしない', () => {
  const out = summarize([{ repo: 'Typa', workflows: 2, red: [] }, { repo: 'Old', skipped: 'アーカイブ済み' }]);
  assert.equal(out.code, 0);
  assert.match(out.lines.join('\n'), /見ていない: Old/);
});

test('既定の枝は一覧から読む。main とはかぎらない', () => {
  const index = repoIndex([
    { name: 'Typa', default_branch: 'main', archived: false },
    { name: 'Old_App', default_branch: 'master', archived: true },
    { name: 'NoBranch' },
    null, { message: 'x' },
  ]);
  // 台帳と GitHub で大文字小文字が違っても同じリポジトリ
  assert.deepEqual(index.get('typa'), { branch: 'main', archived: false });
  assert.deepEqual(index.get('old_app'), { branch: 'master', archived: true });
  assert.deepEqual(index.get('nobranch'), { branch: 'main', archived: false });
  assert.equal(index.size, 3);
  assert.equal(repoIndex({ message: 'Bad credentials' }).size, 0);
});
