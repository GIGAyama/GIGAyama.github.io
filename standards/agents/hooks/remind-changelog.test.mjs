/**
 * remind-changelog.mjs の試験。
 *
 * ⚠️ 純関数だけでなく、本物の git リポジトリを作って CLI を起動し、
 *    終了コードを見る。hook は終了コードでしか意思を伝えられないので、
 *    そこを見ない試験は「止めたつもりで通していた」を捕まえられない
 *    （guard-canonical.test.mjs と同じ考え方）。
 *
 * ⚠️ とくに「2 回目は通る」を必ず見ること。ここが壊れると、逃げ道の無い
 *    hook になり、使う人から見て何も変わらない直しにも嘘の更新ログが足される。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  CHANGELOG, isCommitCommand, userFacingChanges, generatedPaths,
  hasRecentEntry, signatureOf, refusal,
} from './remind-changelog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'remind-changelog.mjs');

/* ── コミットかどうかの見分け ────────────────────────── */

test('ふつうのコミットを拾う', () => {
  assert.ok(isCommitCommand('git commit -m "写真の上限をなくす"'));
  assert.ok(isCommitCommand('git commit'));
});

test('add と続けて打つ形も拾う（この形が実際にいちばん多い）', () => {
  assert.ok(isCommitCommand('git add . && git commit -m x'));
  assert.ok(isCommitCommand('git add -A; git commit -m x'));
});

test('git -C や -c が前に挟まっても拾う', () => {
  assert.ok(isCommitCommand('git -C /tmp/foo commit -m x'));
  assert.ok(isCommitCommand('git -c user.name=a commit -m x'));
});

test('--amend は見送る（そのときには既に 1 回聞いている）', () => {
  assert.equal(isCommitCommand('git commit --amend --no-edit'), false);
});

test('--dry-run は止めない（本人が下見をしているだけ）', () => {
  assert.equal(isCommitCommand('git commit --dry-run'), false);
});

test('文の途中に出てくる commit を拾わない', () => {
  assert.equal(isCommitCommand('git log --grep=commit'), false);
  assert.equal(isCommitCommand('echo "git commit -m x"'), false);
  assert.equal(isCommitCommand('git show --stat HEAD'), false);
  assert.equal(isCommitCommand('grep -r "git commit" .'), false);
});

test('コマンドが無い・文字列でないときは false（Bash 以外の道具も通る）', () => {
  assert.equal(isCommitCommand(undefined), false);
  assert.equal(isCommitCommand(''), false);
  assert.equal(isCommitCommand({}), false);
});

/* ── 使う人から見て変わるか ────────────────────────────── */

test('アプリの中身は使う人向け', () => {
  assert.deepEqual(
    userFacingChanges(['index.html', 'src/game.js', 'assets/pon.mp3']),
    ['index.html', 'src/game.js', 'assets/pon.mp3'],
  );
});

test('道具・検査・設定・文書は使う人向けではない', () => {
  assert.deepEqual(userFacingChanges([
    '.github/workflows/ci.yml', '.claude/settings.json', '.agents/skills/x/SKILL.md',
    'standards/lib/a.mjs', 'tools/build-sw.mjs', 'scripts/check.mjs',
    'docs/manual/manual.md', 'test/a.mjs', 'dist/sw.js',
    'package.json', 'package-lock.json', 'quality.config.json',
    'standards-map.json', 'README.md', 'sw.js', '.gitignore',
  ]), []);
});

test('エージェント向けの手引きは使う人向けではない', () => {
  /* ⚠️ ここを落とすと、正本を配るたびに 42 本で鳴る。CLAUDE.md はリポジトリ直下に
        在るので置き場では外れない。2026-08-31 に実際に走らせて見つけた。 */
  assert.deepEqual(userFacingChanges(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.mcp.json']), []);
});

test('テストと設定は名前の形でも見分ける（置き場が揃っていないリポジトリがある）', () => {
  assert.deepEqual(userFacingChanges(['src/game.test.js', 'src/a.spec.ts', 'vite.config.ts']), []);
});

test('道具の直しにアプリの直しが 1 本でも混ざれば、使う人向けとして拾う', () => {
  assert.deepEqual(
    userFacingChanges(['.github/workflows/ci.yml', 'src/game.js', 'package.json']),
    ['src/game.js'],
  );
});

test('区切りや先頭の ./ で取りこぼさない', () => {
  assert.deepEqual(userFacingChanges(['./tools/build-sw.mjs']), []);
  assert.deepEqual(userFacingChanges(['.\\tools\\build-sw.mjs']), []);
});

test('似た名前の置き場を巻きこまない（tools-old は別物）', () => {
  assert.deepEqual(userFacingChanges(['tools-old/a.mjs']), ['tools-old/a.mjs']);
});

test('朝に組み直されるものは、人が直した跡ではない', () => {
  const generated = ['index.html', 'sitemap.xml', 'apps/', 'data/apps.json'];
  assert.deepEqual(
    userFacingChanges(['index.html', 'apps/typa/index.html', 'data/apps.json', 'assets/a.css'], generated),
    ['assets/a.css'],
  );
});

test('生成物の台帳（tools/outputs.json）から道を読む', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remind-'));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.writeFileSync(path.join(dir, 'tools', 'outputs.json'), JSON.stringify({
      tools: { 'tools/sync-updates.mjs': ['index.html', 'apps/'], 'tools/build-sw.mjs': ['sw.js'] },
      checks: ['tools/check-outputs.mjs'],
    }));
    assert.deepEqual(generatedPaths(dir).sort(), ['apps/', 'index.html', 'sw.js']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('台帳が無い／壊れていても、判断そのものは続ける', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remind-'));
  try {
    assert.deepEqual(generatedPaths(dir), []);
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.writeFileSync(path.join(dir, 'tools', 'outputs.json'), 'これは JSON ではない');
    assert.deepEqual(generatedPaths(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ── 更新ログに書いてあるか ────────────────────────────── */

test('今日の日付があれば書いてあるとみなす', () => {
  assert.ok(hasRecentEntry('## 2026-08-31\n- なおしました\n', '2026-08-31'));
});

test('前日まで見る（組み直しは UTC、書く人は JST に居る）', () => {
  assert.ok(hasRecentEntry('## 2026-08-30\n- なおしました\n', '2026-08-31'));
});

test('古い日付しか無ければ、書いていないとみなす', () => {
  assert.equal(hasRecentEntry('## 2026-06-01\n- はじめて公開しました\n', '2026-08-31'), false);
});

test('書式を外した見出しは拾わない（機械が拾えないものを通すと、黙って消える）', () => {
  assert.equal(hasRecentEntry('## 2026/08/31\n- なおしました\n', '2026-08-31'), false);
  assert.equal(hasRecentEntry('## v1.2.0\n- なおしました\n', '2026-08-31'), false);
});

test('中身が文字列でなくても落ちない', () => {
  assert.equal(hasRecentEntry(undefined, '2026-08-31'), false);
  assert.equal(hasRecentEntry('## 2026-08-31\n', 'きょう'), false);
});

/* ── 控えの鍵と文面 ──────────────────────────────────── */

test('同じ顔ぶれなら並び順が違っても同じ鍵になる', () => {
  assert.equal(signatureOf(['b.js', 'a.js']), signatureOf(['a.js', 'b.js']));
});

test('顔ぶれが変われば鍵も変わる', () => {
  assert.notEqual(signatureOf(['a.js']), signatureOf(['a.js', 'b.js']));
});

test('止める文面に、書き方・検査・逃げ道が書いてある', () => {
  const text = refusal({ files: ['src/game.js'] });
  assert.ok(text.includes(CHANGELOG));
  assert.ok(text.includes('## YYYY-MM-DD'), '書式を外すと黙って消えるので、形を見せる');
  assert.ok(text.includes('lint-changelog.mjs'));
  assert.ok(text.includes('giga-changelog'));
  assert.ok(text.includes('もう一度'), '逃げ道が無いと、嘘の更新ログが足される');
  assert.ok(text.includes('src/game.js'));
});

test('文面が長くなりすぎないよう、道は途中で切る', () => {
  const many = Array.from({ length: 20 }, (_, i) => `src/${i}.js`);
  const text = refusal({ files: many });
  assert.ok(text.includes('ほか 14 件'));
});

/* ── CLI として起動したときの終了コード ────────────────── */

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remind-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'a@example.com');
  git('config', 'user.name', 'a');
  fs.writeFileSync(path.join(dir, '.keep'), '');
  git('add', '.');
  git('commit', '-qm', 'はじめ');
  return dir;
}

function write(dir, rel, body) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
}

function runHook(cwd, command = 'git commit -m x') {
  const payload = {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command },
  };
  try {
    execFileSync('node', [CLI], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) { return e.status ?? -1; }
}

const today = () => new Date().toISOString().slice(0, 10);

test('CLI: アプリを直して更新ログを書いていなければ止まる', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir), 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 同じものをもう一度なら通る（1 回しか止めない）', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir), 2, '1 回目は止める');
    assert.equal(runHook(dir), 0, '2 回目は通す。逃げ道が無いと嘘の更新ログが足される');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 通したあとに別の直しをすれば、また 1 回止まる', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir), 2);
    assert.equal(runHook(dir), 0);
    write(dir, 'src/title.js', 'console.log(2)\n');
    assert.equal(runHook(dir), 2, '別の変更は別に聞く');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 控えが作業ツリーに漏れていない（git add . で 42 本へ撒かれる）', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    runHook(dir);
    const dirty = String(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }));
    assert.ok(!dirty.includes('giga-changelog-asked'), '控えは .git/ の中に置くこと');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 更新ログを一緒に直していれば通る', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    write(dir, CHANGELOG, `## ${today()}\n- 音が出ない端末があったのを直しました\n`);
    assert.equal(runHook(dir), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 今日の分をすでに書いてあれば、続きのコミットでは聞かない', () => {
  const dir = gitRepo();
  try {
    write(dir, CHANGELOG, `## ${today()}\n- 音が出ない端末があったのを直しました\n`);
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', '更新ログ'], { cwd: dir, stdio: 'ignore' });
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 道具・検査だけの直しでは止めない', () => {
  const dir = gitRepo();
  try {
    write(dir, '.github/workflows/ci.yml', 'name: ci\n');
    write(dir, 'tools/build-sw.mjs', '// x\n');
    write(dir, 'package.json', '{}\n');
    assert.equal(runHook(dir), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 索引に入れる前でも見る（git add . && git commit を 1 本で打つ形）', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');   // add していない
    assert.equal(runHook(dir, 'git add . && git commit -m x'), 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: コミットでないコマンドは見ない', () => {
  const dir = gitRepo();
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir, 'npm test'), 0);
    assert.equal(runHook(dir, 'git status'), 0);
    assert.equal(runHook(dir, 'git log --grep=commit'), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 何も変わっていなければ止めない', () => {
  const dir = gitRepo();
  try {
    assert.equal(runHook(dir), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ── fail-open ───────────────────────────────────────── */

test('CLI: 入力が JSON でなくても通す', () => {
  const dir = gitRepo();
  try {
    let code = 0;
    try {
      execFileSync('node', [CLI], { cwd: dir, input: 'こわれた入力', encoding: 'utf8', stdio: 'pipe' });
    } catch (e) { code = e.status ?? -1; }
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: 入力が空でも通す', () => {
  const dir = gitRepo();
  try {
    let code = 0;
    try {
      execFileSync('node', [CLI], { cwd: dir, input: '', encoding: 'utf8', stdio: 'pipe' });
    } catch (e) { code = e.status ?? -1; }
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: git リポジトリでない場所では通す（控えを置けないので逃げ道が無くなる）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remind-'));
  try {
    write(dir, 'src/game.js', 'console.log(1)\n');
    assert.equal(runHook(dir), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
