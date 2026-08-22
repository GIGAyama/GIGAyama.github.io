import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ledgerProblems, missingFromLedger, goneFromGitHub,
  normalized, parseSymref, namesFromRepoPage,
} from './check-distribution.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/distribution.json'), 'utf8'));

test('いま置いてある台帳そのものに不備がない', () => {
  assert.deepEqual(ledgerProblems(ledger), []);
});

test('理由の無い除外は通さない', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'b' }] });
  assert.ok(problems.some((p) => p.includes('b: excluded に理由')), problems.join('\n'));
});

test('空白だけの理由も理由として認めない', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'b', reason: '   ' }] });
  assert.ok(problems.some((p) => p.includes('b: excluded に理由')), problems.join('\n'));
});

test('配る先が空の台帳は通さない（1本も見ずに緑になるため）', () => {
  const problems = ledgerProblems({ owner: 'x', targets: [], excluded: [] });
  assert.ok(problems.some((p) => p.includes('targets が空')), problems.join('\n'));
});

test('同じリポジトリを2回書いたら気づく', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'a', reason: 'なぜか' }] });
  assert.ok(problems.some((p) => p.includes('2回')), problems.join('\n'));
});

test('台帳に無いリポジトリを見つける。ポータル自身は除く', () => {
  const found = missingFromLedger(['typa', 'GIGAyama.github.io', 'newcomer'], ledger);
  assert.deepEqual(found, ['newcomer']);
});

test('除外に書いてあれば「台帳に無い」とは言わない', () => {
  assert.deepEqual(missingFromLedger(['werewolf'], ledger), []);
});

test('台帳にあるのに GitHub に無いものを見つける', () => {
  const gone = goneFromGitHub(['typa'], { targets: ['typa', 'kesareta'], excluded: [{ repo: 'werewolf', reason: 'r' }] });
  assert.deepEqual(gone.sort(), ['kesareta', 'werewolf']);
});

test('normalize は APP_ID の行だけを潰し、他は残す', () => {
  const before = "const APP_ID = 'typa';\nconst NAME = 'typa';\n";
  const after = normalized(before, ['app-id']);
  assert.equal(after, "const APP_ID = '__APP_ID__';\nconst NAME = 'typa';\n");
});

test('知らない normalize は黙って素通りさせない', () => {
  assert.throws(() => normalized('x', ['そんな正規化はない']), /未知の normalize/);
});

test('ls-remote の出力から既定ブランチと SHA を読む', () => {
  const out = 'ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n';
  assert.deepEqual(parseSymref(out), { ref: 'refs/heads/main', sha: '0123456789abcdef0123456789abcdef01234567' });
});

test('ls-remote が空を返したら投げる（空を「異常なし」と読まない）', () => {
  assert.throws(() => parseSymref(''), /読めませんでした/);
});

test('リポジトリ一覧が配列でなければ投げる（API のエラー本文を名前として扱わない）', () => {
  assert.throws(() => namesFromRepoPage({ message: 'Not Found' }), /配列ではありません/);
  assert.deepEqual(namesFromRepoPage([{ name: 'a' }, { name: 'b' }]), ['a', 'b']);
});
