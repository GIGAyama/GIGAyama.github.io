/**
 * 【正本】CLI の入口判定が、文字列比較で書かれていないことを見張る。
 *
 * ── 何を防ぐのか ──────────────────────────────────────
 *
 *   if (import.meta.url === `file://${process.argv[1]}`) main();
 *
 * この形は Windows で一致しない（`file:///C:/…` とスラッシュの数が違う）。
 * それだけではない。**パスに空白や日本語があると Linux でも一致しない**
 * （import.meta.url は `a%20b`、文字列連結は `a b`）。一致しなければ main() は
 * 呼ばれず、何も検査せずに **exit 0** で終わる。「SW の版は合っている」
 * 「秘密の直書きは無い」と読まれる緑が、実は何も見ていない。
 *
 * 2026-08-28 に giga-reviewer で見つけて直したが、同じ型が正本 3 本
 * （build-sw-static / check-secrets / check-distribution）と、そこから配った
 * 約 30 本に残っていた（2026-09-02）。1 か所直しても同じ型は残る。
 * だから字面で艦隊の正本ぜんぶを見る。
 *
 * 正しい形:
 *   import { pathToFileURL } from 'node:url';
 *   if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './giga-v5-checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const ROOTS = ['standards', 'tools', 'scripts'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'vendor']);

/** 字面で見る。コメントは stripComments で落としてから当てる（説明文の中の例は拾わない） */
const BAD_PATTERNS = [
  { re: /`file:\/\/\$\{process\.argv\[1\]\}`/, why: 'テンプレート文字列で file:// を組み立てている' },
  { re: /["']file:\/\/["']\s*\+\s*process\.argv\[1\]/, why: '文字列連結で file:// を組み立てている' },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) continue;          // ポータルの .claude/skills 等は正本へのリンク
    if (st.isDirectory()) { walk(abs, out); continue; }
    if (/\.(mjs|cjs|js)$/.test(name)) out.push(abs);
  }
  return out;
}

test('正本と道具の CLI に、文字列比較の入口判定が残っていない', () => {
  const files = ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r)));
  // 「0 件でした」を信じない。見るものが無ければ、それは合格ではなく何も見ていない
  assert.ok(files.length >= 30, `見たファイルが ${files.length} 本しかありません（走査の場所が違う）`);

  const offenders = [];
  for (const abs of files) {
    const code = stripComments(fs.readFileSync(abs, 'utf8'));
    for (const { re, why } of BAD_PATTERNS) {
      const m = re.exec(code);
      if (!m) continue;
      const line = code.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(REPO_ROOT, abs)}:${line} … ${why}`);
    }
  }
  assert.deepEqual(offenders, [],
    '入口判定は pathToFileURL(process.argv[1]).href === import.meta.url の形にしてください:\n  '
    + offenders.join('\n  '));
});

test('検査そのものが壊れていない（わざと書いたら拾う）', () => {
  // 自分自身が拾われないよう、字面は 2 つに割って組み立てる
  const sample = ["if (import.meta.url === `file://${", "process.argv[1]}`) main();"].join('');
  assert.ok(BAD_PATTERNS.some(({ re }) => re.test(stripComments(sample))));
  const commented = ["// if (import.meta.url === `file://${", "process.argv[1]}`) main();\nmain();"].join('');
  assert.ok(!BAD_PATTERNS.some(({ re }) => re.test(stripComments(commented))));
  const good = "if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();";
  assert.ok(!BAD_PATTERNS.some(({ re }) => re.test(stripComments(good))));
});
