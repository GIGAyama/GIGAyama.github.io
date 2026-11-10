#!/usr/bin/env node
/**
 * 書いたテストが、どこかのワークフローから呼ばれているかを見る。
 *
 *   node tools/check-ci-coverage.mjs
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 2026-11-10 に数えたら、CI から 1 度も呼ばれていないテストが 2 本あった。
 *
 *   tools/lib/distribute-regenerate.test.mjs
 *   standards/skills/note-article/scripts/capture.test.mjs
 *
 * 1 本目は、教訓の台帳（docs/architecture/lessons.json）が 2026-09-02 の教訓の
 * **見張り役**として名指ししていたもの。tools/check-lessons.mjs は「その
 * ファイルが在るか」までしか見ないので、呼ばれていなくても緑だった。
 * 手元では通るので、壊しても誰も気づけない形のまま 2 か月あまり残っていた。
 *
 * standards-ci.yml はテストを 1 本ずつ並べている（1 本ごとに「なぜ要るか」を
 * 書くため）。並べる形は、足したものだけが呼ばれないという壊れ方をする。
 * CLAUDE.md の「検査を足したら、それを呼ぶ側まで見ること」を機械にやらせる。
 *
 * ── 見かた ────────────────────────────────────────────
 *
 * git が追っている *.test.mjs を、ワークフローの `node --test <道>` と突き合わせる。
 * `*` は 1 階層ぶんに効く（シェルと同じ。`tools/lib/*.test.mjs` は
 * `tools/lib/x.test.mjs` を覆うが、`tools/lib/a/x.test.mjs` は覆わない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** ワークフローの中の `node --test …` に渡している道（glob のまま） */
export function testPatterns(yamlText) {
  const out = [];
  /* ⚠️ コメント行は読まない。「# node --test x を足すこと」と書いただけで
        呼んだことになってしまう。 */
  for (const line of String(yamlText).split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const code = line.replace(/\s#.*$/, '');      // 行末のコメントも同じ
    for (const m of code.matchAll(/node\s+--test\s+([^\n#|&;]+)/g)) {
      out.push(...m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-')));
    }
  }
  return out;
}

/** シェルの glob を正規表現にする。`*` は `/` をまたがない */
export function globToRe(pattern) {
  const body = String(pattern).replace(/^\.\//, '')
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${body}$`);
}

/** どのワークフローからも呼ばれていないテスト */
export function uncovered(testFiles, workflowTexts) {
  const res = workflowTexts.flatMap(testPatterns).map(globToRe);
  return testFiles.filter((f) => !res.some((re) => re.test(f)));
}

function trackedTests() {
  /* ⚠️ git が追っているものだけを見る。ポータルの .claude/skills などは正本への
        シンボリックリンクで、歩くと同じテストを 3 回数える。 */
  /* --others は、まだ git add していないテストも数えるため。足した直後の手元で
     「呼ばれていない」と言えないと、気づくのが push のあとになる。 */
  return execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard',
    '--', '*.test.mjs'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function main() {
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  const workflows = fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))
    .map((n) => fs.readFileSync(path.join(dir, n), 'utf8'));
  const tests = trackedTests();
  const patterns = workflows.flatMap(testPatterns);

  /* 「0 件でした」を信じない。見るものが無ければ、それは合格ではなく何も見ていない */
  if (tests.length === 0 || patterns.length === 0) {
    console.error(`❌ テスト ${tests.length} 本、ワークフローの node --test ${patterns.length} 個。`
      + '読めていません（走らせる場所か、ワークフローの書き方が変わっています）。');
    return 1;
  }

  const missing = uncovered(tests, workflows);
  if (missing.length) {
    console.error(`❌ どのワークフローからも呼ばれていないテストが ${missing.length} 本あります:`);
    for (const f of missing) console.error(`  - ${f}`);
    console.error('\n直し方: .github/workflows/standards-ci.yml に `node --test <その道>` の手順を足してください。');
    console.error('呼ばれていないテストは、壊しても誰も気づけません（手元でしか走らないため）。');
    return 1;
  }
  console.log(`✅ テスト ${tests.length} 本が、すべてワークフローから呼ばれています。`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
