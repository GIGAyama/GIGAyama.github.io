/**
 * 増えたリポジトリを台帳へ足すところ。
 *
 * ここは朝の流れが**人の確認なしに main へ書く**ので、足しすぎないことを固定する。
 * 足しすぎると、配布（auto-distribute）が関係のないリポジトリへ push しにいく。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, addTargets, serializeLedger } from './register-repos.mjs';
import { ledgerProblems, missingFromLedger } from './check-distribution.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(HERE, 'distribution.json');
const MAP = JSON.stringify({ files: [{ canonical: 'sw/build-sw-static.mjs', local: 'tools/build-sw.mjs' }] });

test('standards-map.json を持つリポジトリは targets に足す', () => {
  assert.deepEqual(classify({ mapText: MAP }), { action: 'target' });
  assert.deepEqual(classify({ mapText: JSON.stringify({ dirs: [{ canonical: 'skills/x', local: '.claude/skills/x' }] }) }), { action: 'target' });
});

test('対応表が無いものは足さない（配る先かどうかを機械では決めない）', () => {
  const v = classify({ mapText: null });
  assert.equal(v.action, 'ask');
  assert.match(v.why, /standards-map\.json がありません/);
});

test('読めない対応表・空の対応表は足さない', () => {
  assert.equal(classify({ mapText: '{ こわれた' }).action, 'ask');
  assert.equal(classify({ mapText: '{}' }).action, 'ask');
  assert.equal(classify({ mapText: '{"files":[],"dirs":[]}' }).action, 'ask');
  assert.equal(classify({ mapText: 'null' }).action, 'ask');
});

test('fork とアーカイブ済みは、対応表を持っていても足さない', () => {
  assert.equal(classify({ fork: true, mapText: MAP }).action, 'ask');
  assert.equal(classify({ archived: true, mapText: MAP }).action, 'ask');
});

test('足す場所は名前の順（大文字小文字を分けない）。もとの台帳は書き替えない', () => {
  const ledger = { owner: 'GIGAyama', self: 'GIGAyama.github.io', targets: ['app_launcher', 'Gobblet', 'Typa'], excluded: [] };
  const next = addTargets(ledger, ['Hiding-animal', 'zzz', 'Aaa']);
  assert.deepEqual(next.targets, ['Aaa', 'app_launcher', 'Gobblet', 'Hiding-animal', 'Typa', 'zzz']);
  assert.deepEqual(ledger.targets, ['app_launcher', 'Gobblet', 'Typa']);
});

test('もう載っているものは 2 回書かない（excluded にあるものも、自分自身も）', () => {
  const ledger = {
    owner: 'GIGAyama', self: 'GIGAyama.github.io', targets: ['Typa'],
    excluded: [{ repo: 'Werewolf', reason: '正本のコピーを持たない' }],
  };
  const next = addTargets(ledger, ['typa', 'WEREWOLF', 'gigayama.github.io', 'New', 'new']);
  assert.deepEqual(next.targets, ['New', 'Typa']);
  assert.deepEqual(ledgerProblems(next), []);
});

test('足したあとは「台帳に無い」と言われなくなる', () => {
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  const remote = [...ledger.targets, ...ledger.excluded.map((e) => e.repo), ledger.self, 'Brand-New-App'];
  assert.deepEqual(missingFromLedger(remote, ledger), ['Brand-New-App']);
  const next = addTargets(ledger, ['Brand-New-App']);
  assert.deepEqual(missingFromLedger(remote, next), []);
  assert.deepEqual(ledgerProblems(next), []);
  assert.equal(next.targets.length, ledger.targets.length + 1);
});

test('書きかたが、いまの台帳と 1 バイトも違わない（足した 1 行だけが差分になる）', () => {
  const text = fs.readFileSync(LEDGER_PATH, 'utf8');
  assert.equal(serializeLedger(JSON.parse(text)), text);
});
