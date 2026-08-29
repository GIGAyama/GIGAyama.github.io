/**
 * fleet-status.mjs の試験。
 *
 * ⚠️ いちばん大事なのは「調べていない」を「きれい」と読ませないこと。
 *    手元に無いリポジトリを合格として数えた瞬間、この道具は
 *    「見ていないのに緑を出す」側に回る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectRepo, cdnViolations, fixFor, fleetRepos, buildStatus, todoLines,
} from './fleet-status.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

/* ── 持ちものを数える ─────────────────────────────── */

test('手元に無いリポジトリは null（調べていない、を分けて持つ）', () => {
  assert.equal(inspectRepo('/nowhere/at/all'), null);
});

test('在るものだけを ✅ にする', () => {
  const dir = repo({
    'scripts/lib/giga-v5-checks.mjs': '// x',
    'quality.config.json': '{}',
    'package.json': JSON.stringify({ scripts: { check: 'node x.mjs' } }),
  });
  try {
    const r = inspectRepo(dir);
    assert.equal(r.v5Gate, true);
    assert.equal(r.qualityConfig, true);
    assert.equal(r.check, true);
    assert.equal(r.buildSw, false);
    assert.equal(r.test, false);
    assert.equal(r.hooks, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('package.json が壊れていても落ちない', () => {
  const dir = repo({ 'package.json': 'これは JSON ではない' });
  try { assert.equal(inspectRepo(dir).check, false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ── Zero-CDN 違反 ───────────────────────────────── */

test('止めたい CDN を読んでいるアプリだけを出す', () => {
  const apps = { items: [
    { repo: 'A', slug: 'a', hosts: ['cdn.jsdelivr.net', 'script.google.com'] },
    { repo: 'B', slug: 'b', hosts: ['script.google.com'] },
    { repo: 'C', slug: 'c' },
  ] };
  const v = cdnViolations(apps);
  assert.deepEqual(v.map((x) => x.repo), ['A']);
  assert.deepEqual(v[0].hosts, ['cdn.jsdelivr.net']);
});

test('止めたい CDN の一覧は giga-reviewer の正本から借りている', () => {
  // 2 か所に持つと、片方だけ直したときに食い違う
  const apps = { items: [{ repo: 'A', slug: 'a', hosts: ['unpkg.com'] }] };
  assert.equal(cdnViolations(apps).length, 1);
});

test('直し方は、書体とライブラリで書き分ける', () => {
  assert.ok(fixFor('fonts.googleapis.com').includes('build-fonts'));
  assert.ok(fixFor('fonts.gstatic.com').includes('build-fonts'));
  assert.ok(fixFor('cdn.jsdelivr.net').includes('build-vendor'));
  assert.ok(fixFor('unpkg.com').includes('build-vendor'));
});

test('書体の直し方には、780 字の落とし穴を添える', () => {
  // 800 字を超えると HTTP 200 のまま効かなくなる（2026-08-28）
  assert.ok(fixFor('fonts.googleapis.com').includes('780'));
});

/* ── 台帳と行列 ──────────────────────────────────── */

test('台帳の targets と skills.extra を合わせて艦隊とする', () => {
  const ledger = { targets: ['B', 'A'], skills: { extra: ['C', 'A'] } };
  assert.deepEqual(fleetRepos(ledger), ['A', 'B', 'C']);
});

test('実際の台帳では 42 本になる', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/distribution.json'), 'utf8'));
  assert.equal(fleetRepos(ledger).length, 42);
});

test('測れなかったものは measured に入れない（合格として数えない）', () => {
  const status = buildStatus(['A', 'B'], { items: [] },
    (r) => (r === 'A' ? { v5Gate: true, check: true } : null));
  assert.deepEqual(status.measured.map((m) => m.repo), ['A']);
  assert.deepEqual(status.unmeasured, ['B']);
});

test('作業待ち行列に、違反と直し方と正本の道具が入る', () => {
  const status = {
    measured: [{ repo: 'A', v5Gate: false, check: true }],
    unmeasured: [],
    cdn: [{ repo: 'A', slug: 'a', hosts: ['fonts.gstatic.com'] }],
  };
  const lines = todoLines(status).join('\n');
  assert.ok(lines.includes('[Zero-CDN] A: fonts.gstatic.com'));
  assert.ok(lines.includes('standards/fonts/build-fonts.mjs'));
  assert.ok(lines.includes('[ゲート未配備]'));
  assert.ok(lines.includes('standards/lib/run-giga-checks.mjs'));
});

test('作業待ちが無ければ、行は 1 つも出さない', () => {
  const status = {
    measured: [{ repo: 'A', v5Gate: true, check: true }],
    unmeasured: [], cdn: [],
  };
  assert.deepEqual(todoLines(status), []);
});

test('検査そのものが無いリポジトリを、別立てで出す', () => {
  const status = {
    measured: [{ repo: 'A', v5Gate: true, check: false }],
    unmeasured: [], cdn: [],
  };
  assert.ok(todoLines(status).join('\n').includes('検査そのものが無い'));
});
