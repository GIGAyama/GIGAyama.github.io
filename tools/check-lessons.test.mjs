/**
 * check-lessons.mjs の試験。
 *
 * ⚠️ 本体は「書いた検査が実在するか」のほう。台帳が嘘をつくと、
 *    台帳があるぶんだけ事故が見えにくくなる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledgerProblems, missingGuards, unguardedLessons } from './check-lessons.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── いま置いてある台帳そのもの ───────────────────── */

test('いま置いてある lessons.json に不備がない', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/lessons.json'), 'utf8'));
  assert.deepEqual(ledgerProblems(ledger), []);
});

test('いま書いてある検査は、すべて実在する', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/lessons.json'), 'utf8'));
  assert.deepEqual(missingGuards(ledger), []);
});

test('SYSTEM_MASTER.md の教訓の件数を下回らない', () => {
  // 表から教訓が消えたのに台帳だけ残る、の逆（台帳が痩せていく）を止める
  const master = fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/SYSTEM_MASTER.md'), 'utf8');
  const rows = (master.match(/^\| \*\*2026-/gm) ?? []).length;
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/lessons.json'), 'utf8'));
  assert.ok(ledger.lessons.length >= rows,
    `台帳 ${ledger.lessons.length} 件が SYSTEM_MASTER の ${rows} 件を下回っています`);
});

/* ── 台帳の形 ────────────────────────────────────── */

test('guardedBy も unguarded も無ければ落とす', () => {
  const problems = ledgerProblems({ lessons: [{ date: '2026-01-01', symptom: 'x' }] });
  assert.ok(problems.some((p) => p.includes('guardedBy も unguarded も')), problems.join('\n'));
});

test('unguarded だけなら通す（免除ではなく宣言）', () => {
  assert.deepEqual(
    ledgerProblems({ lessons: [{ date: '2026-01-01', symptom: 'x', unguarded: '機械で見張れない理由' }] }),
    [],
  );
});

test('空白だけの unguarded は理由として認めない', () => {
  const problems = ledgerProblems({ lessons: [{ date: '2026-01-01', symptom: 'x', unguarded: '   ' }] });
  assert.ok(problems.some((p) => p.includes('guardedBy も unguarded も')));
});

test('guardedBy と unguarded の両方があれば落とす', () => {
  const problems = ledgerProblems({
    lessons: [{ date: '2026-01-01', symptom: 'x', unguarded: 'r', guardedBy: [{ file: 'a', contains: 'b' }] }],
  });
  assert.ok(problems.some((p) => p.includes('両方があります')));
});

test('symptom が無ければ落とす', () => {
  const problems = ledgerProblems({ lessons: [{ date: '2026-01-01', unguarded: 'r' }] });
  assert.ok(problems.some((p) => p.includes('symptom')));
});

test('lessons が無い・空なら落とす', () => {
  assert.ok(ledgerProblems({}).length > 0);
  assert.ok(ledgerProblems({ lessons: [] }).length > 0);
});

/* ── 本体: 書いた検査が実在するか ───────────────── */

function tmpRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

test('見張っていることになっているファイルが無ければ落とす', () => {
  const dir = tmpRoot({ 'a.mjs': 'x' });
  try {
    const p = missingGuards(
      { lessons: [{ date: '2026-01-01', guardedBy: [{ file: 'nope.mjs', contains: 'x' }] }] }, dir);
    assert.ok(p[0].includes('ファイルが無い'), p.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ファイルは在っても、書いた検査の名前が無ければ落とす', () => {
  // 検査の名前を変えたのに台帳が古いまま、という形
  const dir = tmpRoot({ 'a.mjs': 'export function newName() {}' });
  try {
    const p = missingGuards(
      { lessons: [{ date: '2026-01-01', guardedBy: [{ file: 'a.mjs', contains: 'oldName' }] }] }, dir);
    assert.ok(p[0].includes('台帳のほうが古く'), p.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('実在すれば通す', () => {
  const dir = tmpRoot({ 'a.mjs': 'export function realCheck() {}' });
  try {
    assert.deepEqual(
      missingGuards({ lessons: [{ date: '2026-01-01', guardedBy: [{ file: 'a.mjs', contains: 'realCheck' }] }] }, dir),
      [],
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('見張れていない教訓は、落とさないが必ず見せる', () => {
  const un = unguardedLessons({
    lessons: [
      { date: '2026-01-01', symptom: 'a', unguarded: '理由' },
      { date: '2026-01-02', symptom: 'b', guardedBy: [{ file: 'x', contains: 'y' }] },
    ],
  });
  assert.equal(un.length, 1);
  assert.equal(un[0].date, '2026-01-01');
});
