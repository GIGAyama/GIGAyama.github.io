/**
 * 「赤を Issue にして届ける」が、ワークフローに正しくつながっているか。
 *
 * 計算のほう（tools/lib/issue-report.test.mjs）が緑でも、ワークフローが呼んで
 * いなければ何も届かない。2026-09-19 から 52 日つづいた赤は、検査も出力も正しく、
 * **届ける道だけが無かった**。その道が外れたら、ここで落とす。
 *
 * YAML は解析しない（ポータルに package.json を持たない方針）。字面で見る。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.resolve(HERE, '..', '.github', 'workflows');
const files = fs.readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n)).sort();
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
/** コメント行を落とす。「# report-issue.mjs を足すこと」を、呼んだことにしない */
const code = (name) => read(name).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** そのワークフローの中の「Issue に知らせる」手順を、1 つずつ切り出す */
function reportSteps(name) {
  const text = code(name);
  const steps = text.split(/\n(?=\s+- (?:name|uses|run|id):)/);
  return steps.filter((s) => s.includes('tools/report-issue.mjs'));
}

test('ワークフローを読めている（0 本を「ぜんぶ通った」と言わない）', () => {
  assert.ok(files.length >= 6, `ワークフローが ${files.length} 本しか見つかりません`);
});

test('予約で走るワークフローは、ぜんぶ Issue に知らせる', () => {
  /* 予約で走るものは、誰も見ていない時刻に落ちる。届ける道が無ければ、
     落ちたことは Actions の一覧を開いた人にしか分からない。 */
  const scheduled = files.filter((n) => /^\s+schedule:/m.test(code(n)));
  assert.ok(scheduled.length >= 4, `予約で走るワークフローが ${scheduled.length} 本しか見つかりません`);
  for (const name of scheduled) {
    assert.ok(reportSteps(name).length >= 1, `${name}: 予約で走るのに、Issue に知らせる手順がありません`);
  }
});

test('知らせるワークフローには issues: write がある（無いと 403 で、警告だけ出て届かない）', () => {
  for (const name of files) {
    if (reportSteps(name).length === 0) continue;
    assert.match(code(name), /^\s+issues:\s*write\b/m, `${name}: permissions に issues: write がありません`);
  }
});

test('知らせる手順は、上が赤い回にこそ走る（!cancelled() と job.status）', () => {
  let seen = 0;
  for (const name of files) {
    for (const step of reportSteps(name)) {
      seen++;
      /* if: を書かないと、直前の手順が落ちた回は飛ばされる。always() は取り消された
         回にも走り、途中までの結果で閉じたり立てたりするので使わない */
      assert.match(step, /if:\s*\$\{\{\s*!cancelled\(\)/, `${name}: 知らせる手順に if: !cancelled() がありません`);
      assert.match(step, /STATUS:\s*\$\{\{\s*job\.status\s*\}\}/, `${name}: STATUS に job.status を渡していません`);
      assert.match(step, /--status "\$STATUS"/, `${name}: --status "$STATUS" がありません`);
      /* ほかの枝から手で走らせた回が、main の Issue を閉じたり立てたりしない */
      assert.match(step, /github\.ref == 'refs\/heads\/main'/, `${name}: main のときだけ、の条件がありません`);
    }
  }
  assert.ok(seen >= 6, `知らせる手順が ${seen} 個しか見つかりません`);
});

test('--key は検査ごとに別（同じだと、片方の緑がもう片方の赤を閉じる）', () => {
  const keys = files.flatMap((n) => reportSteps(n).map((s) => /--key (\S+)/.exec(s)?.[1]));
  assert.ok(keys.every(Boolean), '--key の無い手順があります');
  assert.equal(new Set(keys).size, keys.length, `--key が重なっています: ${keys.join(', ')}`);
});

test('gh workflow run が指すワークフローが実在する', () => {
  /* 名前で相手を指すものは、相手の名前を変えたときに黙って外れる
     （workflow_run の表示名と同じ型。check-distribution.test.mjs が見ている）。 */
  const targets = files.flatMap((n) => [...code(n).matchAll(/gh workflow run (\S+)/g)].map((m) => m[1]));
  assert.ok(targets.length >= 1, 'gh workflow run が 1 つも見つかりません（台帳に足したあと配布を起こす手順が消えています）');
  for (const t of targets) assert.ok(files.includes(t), `${t} というワークフローはありません`);
});

test('ワークフローを起こす手順のあるところには actions: write がある', () => {
  for (const name of files) {
    if (!/gh workflow run /.test(code(name))) continue;
    assert.match(code(name), /^\s+actions:\s*write\b/m, `${name}: permissions に actions: write がありません`);
  }
});

test('引数が足りなければ exit 2。それ以外は、何が起きても exit 0（検査の結果を変えない）', () => {
  const cli = path.join(HERE, 'report-issue.mjs');
  const run = (args, env = {}) => {
    try {
      execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH, ...env } });
      return 0;
    } catch (e) { return e.status; }
  };
  assert.equal(run([]), 2);
  // トークンが無い場所（手元）では、知らせずに 0 で終わる
  assert.equal(run(['--key', 'x', '--title', 't', '--status', 'failure']), 0);
  // 取り消された回は、GitHub へ聞きにいかずに 0 で終わる（赤でも緑でもない）
  assert.equal(run(['--key', 'x', '--title', 't', '--status', 'cancelled'],
    { GITHUB_REPOSITORY: 'x/y', GITHUB_TOKEN: 'dummy' }), 0);
});
