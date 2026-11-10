/**
 * 配布 PR の題と本文が、書いたとおりに届くか。
 *
 * 2026-11-10: 本文をシェルの二重引用符に入れていたので、バッククォートの中身が
 * コマンドとして実行され、43 本の PR から「どこの正本と同期したか」が消えていた。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCH_NAME, PR_TITLE, PR_BODY, prCreateArgs } from './distribute-pr.mjs';
import { isDistributionCommit } from './gh.mjs';
import { stripComments } from '../../standards/lib/giga-v5-checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('本文に、どこの正本と同期したかが書いてある', () => {
  assert.match(PR_BODY, /`GIGAyama\.github\.io\/standards\/`/);
  assert.match(PR_BODY, /`auto-distribute`/);
});

test('引数のまま渡せば、バッククォートは字のまま届く（実際に子プロセスへ渡して確かめる）', () => {
  const args = prCreateArgs('GIGAyama', 'Typa', 'main');
  // gh の代わりに、受けとった引数をそのまま書き出すだけの node を起動する
  const echoed = JSON.parse(execFileSync(process.execPath,
    ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...args], { encoding: 'utf8' }));
  assert.deepEqual(echoed, args);
  assert.equal(echoed[echoed.indexOf('--body') + 1], PR_BODY);
  assert.equal(echoed[echoed.indexOf('--repo') + 1], 'GIGAyama/Typa');
  assert.equal(echoed[echoed.indexOf('--base') + 1], 'main');
});

test('配る側が、本文をシェルの文字列につないでいない', () => {
  const src = stripComments(fs.readFileSync(path.join(HERE, '..', 'distribute.mjs'), 'utf8'));
  assert.doesNotMatch(src, /--body\s+["']?\$\{/, 'PR の本文をテンプレート文字列でコマンドにつないでいます');
  assert.match(src, /prCreateArgs\(/, 'prCreateArgs を使っていません');
});

test('題と枝の名前が、「配布のコミットか」の見分けと食い違っていない', () => {
  // squash でも題は残る。merge commit のほうは枝の名前が入る
  assert.equal(isDistributionCommit(PR_TITLE), true);
  assert.equal(isDistributionCommit(`${PR_TITLE} (#12)`), true);
  assert.equal(isDistributionCommit(`Merge pull request #12 from GIGAyama/${BRANCH_NAME}`), true);
});
