/**
 * guard-canonical.mjs の試験。
 *
 * ⚠️ 純関数だけでなく、CLI を実際に起動して終了コードを見る。
 *    hook は終了コードでしか意思を伝えられないので、そこを見ない試験は
 *    「止めたつもりで通していた」を捕まえられない。
 *    2026-08-28 に giga-reviewer が、入口判定の誤りで「何も検査せず exit 0」に
 *    なっていたのと同じ穴を、こちらでは最初から塞いでおく。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { canonicalFor, refusal } from './guard-canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'guard-canonical.mjs');

const MAP = {
  files: [
    { canonical: 'sw/build-sw-static.mjs', local: 'tools/build-sw.mjs' },
    { canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' },
  ],
  dirs: [
    { canonical: 'skills/note-article', local: '.claude/skills/note-article' },
    { canonical: 'skills/note-article', local: '.agents/skills/note-article' },
  ],
  unmanaged: [
    { local: 'CLAUDE.md', reason: '独自の手引き' },
    { local: 'scripts/lib/giga-v5-checks.mjs', reason: 'v4 世代のフォーク' },
  ],
};

/* ── 判定そのもの ────────────────────────────────────── */

test('files に載っている写しは止める', () => {
  assert.deepEqual(canonicalFor('tools/build-sw.mjs', MAP),
    { canonical: 'sw/build-sw-static.mjs', local: 'tools/build-sw.mjs' });
});

test('dirs の下のファイルも止める（中身が増減するので 1 本ずつ書かない）', () => {
  const hit = canonicalFor('.claude/skills/note-article/scripts/capture.mjs', MAP);
  assert.equal(hit.canonical, 'skills/note-article/scripts/capture.mjs');
});

test('dirs そのもの（ディレクトリ）も止める', () => {
  assert.equal(canonicalFor('.claude/skills/note-article', MAP).canonical, 'skills/note-article');
});

test('.agents 側も同じように止める（片方だけ守ると、もう片方が抜ける）', () => {
  assert.ok(canonicalFor('.agents/skills/note-article/SKILL.md', MAP));
});

test('正本と関係のないファイルは通す', () => {
  assert.equal(canonicalFor('src/app.js', MAP), null);
  assert.equal(canonicalFor('README.md', MAP), null);
});

test('unmanaged で宣言された場所は止めない（宣言の意味が逆になるため）', () => {
  assert.equal(canonicalFor('CLAUDE.md', MAP), null);
  assert.equal(canonicalFor('scripts/lib/giga-v5-checks.mjs', MAP), null);
});

test('先頭の ./ や区切りの違いで取りこぼさない', () => {
  assert.ok(canonicalFor('./tools/build-sw.mjs', MAP));
  assert.ok(canonicalFor('.claude\\skills\\note-article\\SKILL.md', MAP));
});

test('似た名前のディレクトリを巻きこまない', () => {
  // .claude/skills/note-article-old は別物
  assert.equal(canonicalFor('.claude/skills/note-article-old/SKILL.md', MAP), null);
});

test('止める文面に、正本の場所と直し方が書いてある', () => {
  const text = refusal({ canonical: 'sw/build-sw-static.mjs', local: 'tools/build-sw.mjs' });
  assert.ok(text.includes('standards/sw/build-sw-static.mjs'));
  assert.ok(text.includes('distribute.mjs'));
  assert.ok(text.includes('unmanaged'));
});

/* ── CLI として起動したときの終了コード ────────────────── */

function repoWith({ portal = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  fs.writeFileSync(path.join(dir, 'standards-map.json'), JSON.stringify(MAP, null, 2));
  if (portal) {
    fs.mkdirSync(path.join(dir, 'standards'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'standards', 'check-drift.mjs'), '// 正本を持つ側\n');
  }
  return dir;
}

function runHook(cwd, payload) {
  try {
    execFileSync('node', [CLI], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) { return e.status ?? -1; }
}

const edit = (file, cwd) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: file } });

test('CLI: 正本のコピーを編集しようとしたら exit 2 で止まる', () => {
  const dir = repoWith();
  try {
    assert.equal(runHook(dir, edit('.claude/skills/note-article/SKILL.md', dir)), 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 関係のないファイルは exit 0 で通す', () => {
  const dir = repoWith();
  try {
    assert.equal(runHook(dir, edit('src/app.js', dir)), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: ポータル（standards/ を持つ側）では常に通す', () => {
  const dir = repoWith({ portal: true });
  try {
    assert.equal(runHook(dir, edit('.claude/skills/note-article/SKILL.md', dir)), 0,
      '正本を持つ側で止めると、正本そのものが直せなくなる');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: standards-map.json が壊れていても通す（fail-open）', () => {
  const dir = repoWith();
  try {
    fs.writeFileSync(path.join(dir, 'standards-map.json'), 'これは JSON ではない');
    assert.equal(runHook(dir, edit('.claude/skills/note-article/SKILL.md', dir)), 0,
      'hook が壊れて 42 本で編集できなくなるほうが、防ぐ事故より重い');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: standards-map.json が無くても通す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  try {
    assert.equal(runHook(dir, edit('.claude/skills/note-article/SKILL.md', dir)), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 入力が JSON でなくても通す', () => {
  const dir = repoWith();
  try {
    let code = 0;
    try {
      execFileSync('node', [CLI], { cwd: dir, input: 'こわれた入力', encoding: 'utf8', stdio: 'pipe' });
    } catch (e) { code = e.status ?? -1; }
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: file_path の無い道具は通す（Bash など）', () => {
  const dir = repoWith();
  try {
    assert.equal(runHook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: dir, tool_input: { command: 'ls' } }), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: リポジトリの外を触るときは関係しない', () => {
  const dir = repoWith();
  try {
    assert.equal(runHook(dir, edit('/etc/hosts', dir)), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 絶対パスで写しを指しても止まる', () => {
  const dir = repoWith();
  try {
    assert.equal(runHook(dir, edit(path.join(dir, 'tools/build-sw.mjs'), dir)), 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
