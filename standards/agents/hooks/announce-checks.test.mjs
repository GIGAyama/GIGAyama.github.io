/**
 * announce-checks.mjs の試験。
 *
 * ⚠️ いちばん大事なのは「在りもしないコマンドを出さない」こと。
 *    出したら、この hook 自身が「無いものを走らせる」原因になる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { availableChecks, announcement } from './announce-checks.mjs';

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'announce-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
const pkg = (scripts) => JSON.stringify({ name: 'x', scripts });

test('package.json に在る script だけを出す', () => {
  const dir = repo({ 'package.json': pkg({ test: 'vitest run', check: 'node scripts/check.mjs' }) });
  try {
    const checks = availableChecks(dir);
    assert.ok(checks.includes('npm test'));
    assert.ok(checks.some((c) => c.startsWith('npm run check')));
    assert.ok(!checks.includes('npm run typecheck'), '無い script を出している');
    assert.ok(!checks.includes('npm run build'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-sw.mjs が無いリポジトリでは、その行を出さない', () => {
  const dir = repo({ 'package.json': pkg({ test: 'node --test' }) });
  try {
    assert.ok(!availableChecks(dir).some((c) => c.includes('build-sw')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-sw.mjs が --check を受けつけるなら出す', () => {
  const dir = repo({ 'package.json': pkg({}), 'tools/build-sw.mjs': "if (process.argv.includes('--check')) {}" });
  try {
    assert.ok(availableChecks(dir).includes('node tools/build-sw.mjs --check'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-sw.mjs が --check を受けつけないなら出さない', () => {
  /* 受けつけない版に --check を渡すと、黙って無視して dist/sw.js を書き換える。
     検査のつもりで走らせた人の作業ツリーが変わり、しかもレビューでは
     「検査は通った」と読まれる。2026-08-30 まで、正本の Vite 版が
     この形だったのに、ここは中身を見ずに出していた。 */
  const dir = repo({ 'package.json': pkg({}), 'tools/build-sw.mjs': '// 手書き。引数は見ていない' });
  try {
    assert.ok(!availableChecks(dir).some((c) => c.includes('build-sw')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('配布先では、ポータルを隣に置いて指す形の check-drift を出す', () => {
  const dir = repo({ 'standards-map.json': '{}' });
  try {
    const line = availableChecks(dir).find((c) => c.includes('check-drift'));
    assert.ok(line.includes('../GIGAyama.github.io/standards'),
      '配布先に standards/ は無いので、そのまま打つと必ず ENOENT になる');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ポータル自身では、自分の standards/ を指す形を出す', () => {
  const dir = repo({ 'standards-map.json': '{}', 'standards/check-drift.mjs': '// x' });
  try {
    const line = availableChecks(dir).find((c) => c.includes('check-drift'));
    assert.equal(line, 'node standards/check-drift.mjs --standards standards');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check は build のあとに走らせる、と添える（dist/ を読む検査があるため）', () => {
  const dir = repo({ 'package.json': pkg({ build: 'vite build', check: 'node x.mjs' }) });
  try {
    const line = availableChecks(dir).find((c) => c.startsWith('npm run check'));
    assert.ok(line.includes('build'), 'ビルドし直さずに走らせると古い結果で嘘の合格が出る');
    const checks = availableChecks(dir);
    assert.ok(checks.indexOf('npm run build') < checks.indexOf(line), '並びが逆になっている');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('package.json が壊れていても落ちない', () => {
  const dir = repo({
    'package.json': 'これは JSON ではない',
    'tools/build-sw.mjs': "process.argv.includes('--check')",
  });
  try {
    assert.deepEqual(availableChecks(dir), ['node tools/build-sw.mjs --check']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-sw.mjs を読めなくても落ちない（読めないなら出さない）', () => {
  const dir = repo({ 'package.json': pkg({ test: 'node --test' }) });
  try {
    const checks = availableChecks(dir, {
      exists: () => true,
      read: (p) => { if (String(p).includes('build-sw')) throw new Error('読めない'); return pkg({ test: 'node --test' }); },
    });
    assert.ok(!checks.some((c) => c.includes('build-sw')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('何も無いリポジトリでは、何も言わない（空の見出しを出さない）', () => {
  const dir = repo({ 'README.md': '# x' });
  try {
    assert.deepEqual(availableChecks(dir), []);
    assert.equal(announcement(dir), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('文面には、出したコマンドがそのまま入る', () => {
  const dir = repo({ 'package.json': pkg({ test: 'node --test' }) });
  try {
    const text = announcement(dir);
    assert.ok(text.includes('npm test'));
    assert.ok(text.includes('```bash'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build が無いリポジトリでは「build のあとに」と言わない（事実と違うため）', () => {
  const dir = repo({ 'package.json': pkg({ check: 'node x.mjs' }) });
  try {
    assert.deepEqual(availableChecks(dir), ['npm run check']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
