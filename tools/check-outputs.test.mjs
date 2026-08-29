/**
 * check-outputs の判定そのものを試す。
 *
 * ⚠️ この検査は「並べ忘れ」を見張るためのものなので、
 *    わざと並べ忘れた形を作って、ちゃんと落ちることまで確かめる。
 *    落ちない検査を置くと、検査があるぶんだけ事故が見えにくくなる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** 本物の作りを写した、小さなリポジトリを作る。 */
function sandbox({ paths, tools, checks, runs }) {
  const dir = mkdtempSync(join(tmpdir(), 'check-outputs-'));
  mkdirSync(join(dir, 'tools'), { recursive: true });
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  cpSync(join(ROOT, 'tools/check-outputs.mjs'), join(dir, 'tools/check-outputs.mjs'));
  for (const t of [...Object.keys(tools), ...(checks ?? [])]) {
    mkdirSync(join(dir, dirname(t)), { recursive: true });
    writeFileSync(join(dir, t), '// からっぽ\n');
  }
  writeFileSync(join(dir, 'tools/outputs.json'), JSON.stringify({
    workflow: '.github/workflows/sync-updates.yml', tools, checks: checks ?? [],
  }));
  writeFileSync(join(dir, '.github/workflows/sync-updates.yml'),
    `jobs:\n  sync:\n    steps:\n${runs.map((r) => `      - run: node ${r}\n`).join('')}`
    + `      - run: |\n          PATHS="${paths.join(' ')}"\n          git add -- $PATHS\n`);
  return dir;
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync('node', ['tools/check-outputs.mjs'], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const BASE = {
  paths: ['data/apps.json', 'apps/', 'sw.js'],
  tools: { 'tools/build-articles.mjs': ['data/apps.json', 'apps/'], 'tools/build-sw.mjs': ['sw.js'] },
  checks: ['tools/check-cards.mjs'],
  runs: ['tools/build-articles.mjs', 'tools/build-sw.mjs', 'tools/check-cards.mjs'],
};

test('そろっていれば通る', () => {
  const dir = sandbox(BASE);
  try {
    const r = run(dir);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PATHS に並べ忘れた道があると落ちる（これが本題）', () => {
  const dir = sandbox({ ...BASE, paths: ['data/apps.json', 'apps/'] });   // sw.js を落とした
  try {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /PATHS に無い → sw\.js/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('上のディレクトリで覆われていれば通る（apps/ が apps/x/manual/ を覆う）', () => {
  const dir = sandbox({
    ...BASE,
    tools: { ...BASE.tools, 'tools/build-manuals.mjs': ['apps/x/manual/'] },
    runs: [...BASE.runs, 'tools/build-manuals.mjs'],
  });
  try {
    assert.equal(run(dir).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ワークフローに手順を足して台帳に書き忘れると落ちる', () => {
  const dir = sandbox({ ...BASE, runs: [...BASE.runs, 'tools/build-devlog.mjs'] });
  try {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /どちらの表にも無い → tools\/build-devlog\.mjs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('検査だと宣言してあれば、書き出し先が無くてよい', () => {
  const dir = sandbox({ ...BASE, checks: ['tools/check-cards.mjs', 'tools/check-404-redirect.mjs'],
    runs: [...BASE.runs, 'tools/check-404-redirect.mjs'] });
  try {
    assert.equal(run(dir).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--check や --dry-run の呼び方は、書き出す側として数えない', () => {
  const dir = sandbox({ ...BASE, runs: [...BASE.runs, 'tools/build-fonts.mjs --check'] });
  try {
    assert.equal(run(dir).code, 0, '検査としての呼び出しは台帳に要らない');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('台帳に書いた道具が実在しないと落ちる（台帳が嘘をつかないように）', () => {
  const dir = sandbox(BASE);
  try {
    writeFileSync(join(dir, 'tools/outputs.json'), JSON.stringify({
      workflow: '.github/workflows/sync-updates.yml',
      tools: { ...BASE.tools, 'tools/build-nothing.mjs': ['sw.js'] },
      checks: BASE.checks,
    }));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /実在する/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
