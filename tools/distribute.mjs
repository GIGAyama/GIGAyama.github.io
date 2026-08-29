#!/usr/bin/env node
/**
 * =====================================================================
 * distribute.mjs — 正本（standards/）の更新を全リポジトリへ一括自動配布
 * =====================================================================
 *
 *   node tools/distribute.mjs              全ターゲットへ配布＆PRマージ
 *   node tools/distribute.mjs --dry-run    差分の確認のみ（push/PRしない）
 *   node tools/distribute.mjs --repo Typa  特定のリポジトリのみ対象
 *
 * ── なぜ要るのか ────────────────────────────────────────────────
 * standards/（正本）を直したあと、42本のリポジトリへ手作業でコピーして
 * PR を出す作業を完全に自動化し、「配布のとりのこし」をゼロにする。
 * GitHub Actions（auto-distribute.yml）からも直接呼び出される。
 * =====================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* 置き場の一覧は check-drift.mjs から借りる。配る側と照合する側で別々に
   持つと、片方だけ直したときに「配ってはいるが誰も見ていない」置き場が生まれる。 */
import { NORMALIZERS, SKILL_ROOTS } from '../standards/check-drift.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BASE_DIR = path.resolve(REPO_ROOT, '..');

const STANDARDS_DIR = path.join(REPO_ROOT, 'standards');
const STANDARDS_SKILLS_DIR = path.join(STANDARDS_DIR, 'skills');
/* ⚠️ 正本は standards/ の下に置く（最重要ルール 3）。以前は配布元が
      .agents/rules/ を指していた。ポータル自身のローカルコピーが同時に正本
      でもある形で、どちらが正なのか決められなくなっていた。 */
const STANDARDS_RULE_FILE = path.join(STANDARDS_DIR, 'agents', 'rules', 'gigaschool-standards.md');
/* Claude Code の常時ルール。中身はルール正本を 1 行で取りこむだけの殻で、
   ルール本文は持たない（同じ文を 2 か所に置かないため）。
   Antigravity は .agents/rules/ を直接読むが、Claude Code は
   リポジトリ直下の CLAUDE.md しか読まないので、入口だけを別に配る。 */
const STANDARDS_CLAUDE_MD = path.join(STANDARDS_DIR, 'agents', 'CLAUDE.md');

/* Claude Code に実際の動きをさせるもの（hook とその設定）。
 *
 * ⚠️ ディレクトリまるごと（dirs）では配らない。standards/agents/hooks/ には
 *    *.test.mjs が同居していて、テストは配布物ではないため。
 *    1 本ずつここに並べるので、正本へ hook を足したらこの表にも 1 行足すこと。
 *
 * ⚠️ .claude/settings.json は配布物である。配布先で直しても他へは届かず、
 *    check-drift が赤くなる。各自の設定は .claude/settings.local.json に置く
 *    （あちらは配らないし、照合もしない）。 */
const AGENT_RUNTIME_FILES = [
  ['agents/settings.json', '.claude/settings.json'],
  ['agents/hooks/guard-canonical.mjs', '.claude/hooks/guard-canonical.mjs'],
  ['agents/hooks/announce-checks.mjs', '.claude/hooks/announce-checks.mjs'],
];
const DISTRIBUTION_JSON = path.join(HERE, 'distribution.json');

/**
 * 正本から消えたものを配布先からも消す。
 *
 * cpSync は重ねるだけで、消えたファイルには触れない。正本でスキルの名前を
 * 変えたり 1 本やめたりすると、古いほうが配布先に残りつづける。
 * check-drift は「余分なファイル」として赤くするので、配布のたびに
 * 全リポジトリが赤くなり、しかも直し方が配布では届かない。
 *
 * ⚠️ ただし、配布先が `unmanaged` に理由つきで宣言しているものは消さない。
 *    unmanaged は「ここは意図して別物を持っている」という宣言で、
 *    check-drift はそれを見て見逃す。配る側が問答無用で消すと、
 *    宣言したものほど黙って失われる。宣言の意味が逆になってしまう。
 *
 * @param {string[]} keep 消してはいけない相対名（unmanaged で宣言された分）
 */
function pruneRemoved(srcDir, dstDir, keep = []) {
  if (!fs.existsSync(dstDir)) return;
  const keepSet = new Set(keep);
  for (const name of fs.readdirSync(dstDir)) {
    if (fs.existsSync(path.join(srcDir, name))) continue;
    if (keepSet.has(name)) continue;
    fs.rmSync(path.join(dstDir, name), { recursive: true, force: true });
  }
}

/** standards-map.json の unmanaged から、その置き場の直下の名前を拾う */
function unmanagedUnder(repoDir, root) {
  const mapPath = path.join(repoDir, 'standards-map.json');
  if (!fs.existsSync(mapPath)) return [];
  let map;
  try { map = JSON.parse(fs.readFileSync(mapPath, 'utf8')); } catch { return []; }
  const rows = Array.isArray(map.unmanaged) ? map.unmanaged : [];
  const prefix = `${root}/`;
  return rows
    .map((u) => (u && typeof u.local === 'string' ? u.local.replace(/\/+$/, '') : ''))
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
    .filter((n) => n && !n.includes('/'));
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const repoFilterIdx = args.indexOf('--repo');
const targetFilter = repoFilterIdx !== -1 ? args[repoFilterIdx + 1] : null;

const BRANCH_NAME = 'chore/sync-standards';
const PR_TITLE = 'chore(standards): Sync with latest standards';
const PR_BODY = `### Summary
- \`GIGAyama.github.io/standards/\` の最新正本（SW・品質ゲート・スキル・ルール）と完全同期
- \`auto-distribute\` による自動配備`;

// 台帳の読み込み
if (!fs.existsSync(DISTRIBUTION_JSON)) {
  console.error(`Error: ${DISTRIBUTION_JSON} not found.`);
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(DISTRIBUTION_JSON, 'utf-8'));
let targetRepos = ledger.targets || [];
if (ledger.skills && Array.isArray(ledger.skills.extra)) {
  targetRepos = Array.from(new Set([...targetRepos, ...ledger.skills.extra]));
}

if (targetFilter) {
  targetRepos = targetRepos.filter(r => r.toLowerCase() === targetFilter.toLowerCase());
}

console.log(`[Auto-Distribution] Processing ${targetRepos.length} target repositories (DryRun: ${isDryRun})...\n`);

const results = {
  updated: [],
  noChange: [],
  failed: []
};

for (const repoName of targetRepos) {
  const repoDir = path.join(BASE_DIR, repoName);
  if (!fs.existsSync(repoDir)) {
    console.log(`[SKIP] Directory not found locally: ${repoDir}`);
    results.failed.push({ repo: repoName, error: 'Directory not found locally' });
    continue;
  }

  console.log(`========================================`);
  console.log(`Processing: ${repoName}`);

  const run = (cmd, ignoreError = false) => {
    try {
      return execSync(cmd, { cwd: repoDir, encoding: 'utf-8' }).trim();
    } catch (e) {
      if (!ignoreError) throw e;
      return '';
    }
  };

  try {
    // 1. Copy standards files based on standards-map.json
    const mapPath = path.join(repoDir, 'standards-map.json');
    if (fs.existsSync(mapPath)) {
      const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      if (!Array.isArray(map.dirs)) map.dirs = [];

      /* Ensure all required skills are present in standards-map.json dirs.
       *
       * ⚠️ 置き場ごとに 1 行ずつ要る。canonical だけで「もう書いてある」と
       *    判定していたころは .claude/ の行があるだけで .agents/ の行が
       *    足されず、.agents/skills/ は一度も照合されないまま配られていた。
       *    照合されない配布物は、書き替えても緑のまま通る（2026-08-28 に実測）。 */
      const requiredSkills = ledger.skills?.required || [];
      let mapChanged = false;
      for (const skillName of requiredSkills) {
        const canonical = `skills/${skillName}`;
        for (const root of SKILL_ROOTS) {
          const local = `${root}/${skillName}`;
          if (!map.dirs.some(d => d.local === local)) {
            map.dirs.push({ canonical, local });
            mapChanged = true;
          }
        }
      }

      /* エージェントの常時ルールも対応表へ載せる。
       *
       * ⚠️ 配っているのに照合されていなかった。2026-08-29 に実測した:
       *    Typa の .agents/rules/gigaschool-standards.md に 1 行足しても
       *    check-drift は「✅ 正本と一致しています」で exit 0 を返した。
       *    理由が 3 つ重なっている。
       *      ・canonicalIndex の DISTRIBUTED_EXT に .md が無い
       *      ・findLookalikes は "." で始まる名前を歩かない（.agents/ を見ない）
       *      ・unregisteredSkills は skills/ の下しか見ない
       *    そして 42 本のどの standards-map.json にも、この行が無かった。
       *    2026-08-28 の「.agents/skills が無検査だった」とまったく同じ型で、
       *    あのときスキルは塞いだが、ルールファイル自身が取り残されていた。
       *
       *    files に明示登録すれば照合される（check-drift の files ループは
       *    拡張子を見ない。.md を外しているのは未登録さがしのほうだけ）。
       *
       * ⚠️ CLAUDE.md は「既に在るなら上書きしない」。独自の手引きを持つ
       *    リポジトリがあるので、その中身を配布で消さない。そのぶん
       *    対応表にも載せず、unmanaged への宣言を促す（下の step 3b）。 */
      if (!Array.isArray(map.files)) map.files = [];
      const ensureFile = (canonical, local) => {
        if (map.files.some((f) => f && f.local === local)) return;
        if ((map.unmanaged || []).some((u) => u && u.local === local)) return;
        map.files.push({ canonical, local });
        mapChanged = true;
      };
      ensureFile('agents/rules/gigaschool-standards.md', '.agents/rules/gigaschool-standards.md');
      if (!fs.existsSync(path.join(repoDir, 'CLAUDE.md'))) {
        ensureFile('agents/CLAUDE.md', 'CLAUDE.md');
      }
      for (const [canonical, local] of AGENT_RUNTIME_FILES) ensureFile(canonical, local);

      if (mapChanged) {
        fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n', 'utf-8');
      }

      if (Array.isArray(map.files)) {
        for (const item of map.files) {
          const srcFile = path.join(STANDARDS_DIR, item.canonical);
          const dstFile = path.join(repoDir, item.local);
          if (!fs.existsSync(srcFile)) continue;

          /* ⚠️ normalize を見ずに上書きしない。
           *
           * 対応表の normalize は「配布先ごとに変えてよい場所」の宣言で、
           * check-drift は両側をプレースホルダーへそろえてから比べる。
           * ところが配布は正本をそのまま被せていたので、配布先が入れた値
           * （APP_ID、アプリの表示名、受け渡し口の置き場）は次の配布で消える。
           * 消えても drift は緑のままなので、誰も気づけない。
           *
           * 2026-08-28 に実測した被害:
           *   ・records-export.test.mjs の import 先を配布先で直しても、
           *     次の配布で '../js/…' に戻った。
           *   ・9 本すべての records-export.js が APP_ID='__APP_ID__'
           *     （正本のプレースホルダーそのもの）のまま公開されていた。
           *     appId が合わないと、配備されていても学習記録は 1 件も届かない。
           *
           * そこで「normalize したうえで一致しているなら、そのまま置く」。
           * 正本が本当に変わったときだけ上書きする。 */
          if (Array.isArray(item.normalize) && item.normalize.length > 0
              && fs.existsSync(dstFile)) {
            let c = fs.readFileSync(srcFile, 'utf8');
            let l = fs.readFileSync(dstFile, 'utf8');
            let known = true;
            for (const n of item.normalize) {
              const fn = NORMALIZERS[n];
              if (!fn) { known = false; break; }
              c = fn(c); l = fn(l);
            }
            // 差がプレースホルダーの中だけなら、配布先の値を残す
            if (known && c === l) continue;
          }

          fs.mkdirSync(path.dirname(dstFile), { recursive: true });
          fs.copyFileSync(srcFile, dstFile);
        }
      }
      if (Array.isArray(map.dirs)) {
        for (const item of map.dirs) {
          const srcDir = path.join(STANDARDS_DIR, item.canonical);
          const dstDir = path.join(repoDir, item.local);
          if (fs.existsSync(srcDir)) {
            fs.mkdirSync(dstDir, { recursive: true });
            fs.cpSync(srcDir, dstDir, { recursive: true });
          }
        }
      }
    }

    /* 2. スキルを置き場ごとに配る。
     *
     * Claude Code は .claude/skills/、Antigravity は .agents/skills/ を読む。
     * どちらも同じ正本の写しなので、同じ手で同じものを置く。
     * 置き場が増えたら SKILL_ROOTS に足すだけで、配布と照合の両方が付いてくる。
     *
     * ⚠️ 以前は .claude/ を「すでにある repo だけ」に配り、.agents/ は無条件に
     *    作っていた。片方が欠けた repo が黙って生まれるので、扱いをそろえる。
     * ⚠️ README.md を消して回っていたのもやめた。あれは check-drift が
     *    ディレクトリでないものまでスキルと数えていたための後始末で、
     *    原因のほうを直してある（standards/check-drift.mjs の unregisteredSkills）。 */
    for (const root of SKILL_ROOTS) {
      const dest = path.join(repoDir, ...root.split('/'));
      fs.mkdirSync(dest, { recursive: true });
      // その置き場について unmanaged で宣言されているものは残す
      const declared = unmanagedUnder(repoDir, root);
      pruneRemoved(STANDARDS_SKILLS_DIR, dest, declared);
      fs.cpSync(STANDARDS_SKILLS_DIR, dest, { recursive: true });
    }

    // 3. Antigravity の Workspace Rules
    const agentsRulesDir = path.join(repoDir, '.agents', 'rules');
    fs.mkdirSync(agentsRulesDir, { recursive: true });
    if (fs.existsSync(STANDARDS_RULE_FILE)) {
      fs.copyFileSync(STANDARDS_RULE_FILE, path.join(agentsRulesDir, 'gigaschool-standards.md'));
    }

    /* 3b. Claude Code の常時ルール（CLAUDE.md）。
     *
     * ⚠️ 2026-08-29 まで、ここに Claude Code 向けの同等物が無かった。
     *    .agents/rules/ は 43 本にあるのに CLAUDE.md は 3 本しかなく、
     *    40 本で Claude Code は Zero-CDN も Zero-PII も正本同期ルールも
     *    知らないままセッションを始めていた。スキルは配ってあるが、
     *    スキルは「呼ばれたときだけ」読まれるので代わりにならない。
     *
     * ⚠️ 既に在るものは上書きしない。独自の手引きを持つリポジトリ
     *    （Werewolf・Reflection_Journal・XXX_automatic）の中身を配布で消さない。
     *    そのぶん、冒頭の取りこみ 1 行が在ることを
     *    tools/check-distribution.mjs が見ている。 */
    const claudeMdPath = path.join(repoDir, 'CLAUDE.md');
    if (fs.existsSync(STANDARDS_CLAUDE_MD) && !fs.existsSync(claudeMdPath)) {
      fs.copyFileSync(STANDARDS_CLAUDE_MD, claudeMdPath);
    }

    /* 3c. hook とその設定。
     *
     * 最重要ルール 3「個別リポジトリを直接修正しない」は、これまで文書にしか
     * 無かった。この艦隊でいちばん多い事故の型（配布先の写しを直す → 次の配布で
     * 消える → 他の 41 本には最初から届いていない）は、どの段階でもエラーが
     * 出ない。だから PreToolUse で機械的に止める。 */
    for (const [canonical, local] of AGENT_RUNTIME_FILES) {
      const src = path.join(STANDARDS_DIR, canonical);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(repoDir, local);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }

    // 4. Ensure eslint.config.js ignores .agents/** and .claude/**
    const eslintConfigPath = path.join(repoDir, 'eslint.config.js');
    if (fs.existsSync(eslintConfigPath)) {
      let eslintConfig = fs.readFileSync(eslintConfigPath, 'utf-8');
      if (eslintConfig.includes('.claude/**') && !eslintConfig.includes('.agents/**')) {
        eslintConfig = eslintConfig.replace("'.claude/**'", "'.claude/**', '.agents/**'");
        fs.writeFileSync(eslintConfigPath, eslintConfig, 'utf-8');
      }
    }

    // 5. Ensure vitest doesn't run skills test runner
    const pkgJsonPath = path.join(repoDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const isVitest = (pkg.devDependencies && pkg.devDependencies.vitest) || (pkg.dependencies && pkg.dependencies.vitest) || (pkg.scripts && pkg.scripts.test && pkg.scripts.test.includes('vitest'));
      if (isVitest) {
        const vitestConfigPath = path.join(repoDir, 'vitest.config.ts');
        const vitestConfigJsPath = path.join(repoDir, 'vitest.config.js');
        if (!fs.existsSync(vitestConfigPath) && !fs.existsSync(vitestConfigJsPath)) {
          const content = `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.agents/**', '**/cypress/**'],\n  },\n});\n`;
          fs.writeFileSync(vitestConfigPath, content, 'utf-8');
        }
      }
    }

    // 6. Check for git diff
    const status = run('git status --porcelain');
    if (!status) {
      console.log(`  [OK] Up to date (No diff in ${repoName})`);
      results.noChange.push(repoName);
      continue;
    }

    console.log(`  [DIFF DETECTED] Changes found in ${repoName}`);

    if (isDryRun) {
      console.log(`  [DRY-RUN] Would commit and push to ${repoName}`);
      results.updated.push(repoName);
      continue;
    }

    // Determine default branch
    let defaultBranch = 'main';
    try {
      defaultBranch = run('git symbolic-ref --short refs/remotes/origin/HEAD').replace('origin/', '') || 'main';
    } catch {
      try {
        defaultBranch = run('git branch --show-current') || 'main';
      } catch {
        defaultBranch = 'main';
      }
    }

    // Checkout branch, commit, push
    run(`git checkout -B ${BRANCH_NAME}`);
    run('git add .');
    run(`git commit -m "chore(standards): Sync with latest standards"`, true);
    run(`git push -u origin ${BRANCH_NAME} --force`);

    // Create PR
    try {
      run(`gh pr create --repo GIGAyama/${repoName} --title "${PR_TITLE}" --body "${PR_BODY}" --base "${defaultBranch}"`);
    } catch (e) {
      console.log(`  PR creation note: ${e.message}`);
    }

    // Merge PR
    let merged = false;
    const mergeCmds = [
      `gh pr merge ${BRANCH_NAME} --repo GIGAyama/${repoName} --admin --merge --delete-branch`,
      `gh pr merge ${BRANCH_NAME} --repo GIGAyama/${repoName} --merge --delete-branch`,
      `gh pr merge ${BRANCH_NAME} --repo GIGAyama/${repoName} --squash --delete-branch`,
      `gh pr merge ${BRANCH_NAME} --repo GIGAyama/${repoName} --auto --merge`
    ];

    for (const mCmd of mergeCmds) {
      try {
        run(mCmd);
        console.log(`  [MERGED] PR successfully merged for ${repoName}`);
        merged = true;
        break;
      } catch {}
    }

    run(`git checkout ${defaultBranch}`, true);
    if (!merged) {
      // Direct merge fallback for forked repos
      try {
        run(`git merge ${BRANCH_NAME} --no-edit`);
        run(`git push origin ${defaultBranch}`);
        console.log(`  [DIRECT MERGE] Merged directly to origin/${defaultBranch} for ${repoName}`);
      } catch {}
    } else {
      run('git pull', true);
    }

    results.updated.push(repoName);
  } catch (err) {
    console.error(`  [ERROR] Failed for ${repoName}: ${err.message}`);
    results.failed.push({ repo: repoName, error: err.message });
  }
}

console.log('\n========================================');
console.log('AUTO-DISTRIBUTION SUMMARY:');
console.log(`Total Targets : ${targetRepos.length}`);
console.log(`Updated/Merged: ${results.updated.length}`);
console.log(`Already Synced: ${results.noChange.length}`);
console.log(`Failed        : ${results.failed.length}`);
console.log('========================================');

if (results.failed.length > 0) {
  process.exit(1);
}
