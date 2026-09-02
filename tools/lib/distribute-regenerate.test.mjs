import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { regenerationCommands } from './distribute-regenerate.mjs';

/** 偽のファイル木。{ '相対パス': '中身' } */
function deps(files) {
  const abs = (p) => path.join('/repo', p);
  const map = new Map(Object.entries(files).map(([k, v]) => [abs(k), v]));
  return {
    exists: (p) => map.has(p),
    read: (p) => { if (!map.has(p)) throw new Error('ENOENT'); return map.get(p); },
  };
}
const cmds = (files) => regenerationCommands('/repo', deps(files)).map((c) => c.cmd);

const STATIC_SW = "const VERSION_LINE = /\\/\\* __APP_VERSION__ \\*\\//; // sw-build.config.json";
const VITE_SW = "/* __APP_VERSION__ */ const marker = '__PRECACHE_URLS__';";
const HANDWRITTEN_SW = "const VERSION_LINE = /^const VERSION = '([^']*)'; \\/\\* __APP_VERSION__ \\*\\/$/m;";

test('道具が無ければ何も走らせない', () => {
  assert.deepEqual(cmds({}), []);
});

test('静的型の build-sw.mjs があれば版を刻み直す', () => {
  assert.deepEqual(cmds({ 'tools/build-sw.mjs': STATIC_SW }), ['node tools/build-sw.mjs']);
});

test('Vite 型の build-sw.mjs は走らせない（dist/ はコミットされない）', () => {
  assert.deepEqual(cmds({ 'tools/build-sw.mjs': VITE_SW }), []);
});

test('scripts/ に置いた手書きの版刻みも拾う（XXX_automatic の形）', () => {
  assert.deepEqual(cmds({ 'scripts/build-sw.mjs': HANDWRITTEN_SW }), ['node scripts/build-sw.mjs']);
});

test('目印の無い build-sw.mjs は走らせない（何を書き替えるか分からないものは触らない）', () => {
  assert.deepEqual(cmds({ 'tools/build-sw.mjs': 'console.log("hand made")' }), []);
});

test('GAS の焼きこみは sw.js より先に走る', () => {
  assert.deepEqual(
    cmds({ 'tools/build-app-links.mjs': '// gas', 'tools/build-sw.mjs': STATIC_SW }),
    ['node tools/build-app-links.mjs', 'node tools/build-sw.mjs'],
  );
});

test('理由（why）を必ず添える（配布のログに出すため）', () => {
  for (const c of regenerationCommands('/repo', deps({ 'tools/build-app-links.mjs': '', 'tools/build-sw.mjs': STATIC_SW }))) {
    assert.ok(c.why && c.why.length > 0, c.cmd);
  }
});

test('読めないファイルがあっても落ちない（配布の途中で止めない）', () => {
  const d = deps({ 'tools/build-sw.mjs': STATIC_SW });
  d.read = () => { throw new Error('EACCES'); };
  assert.deepEqual(regenerationCommands('/repo', d), []);
});
