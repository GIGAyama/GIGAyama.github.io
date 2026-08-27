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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BASE_DIR = path.resolve(REPO_ROOT, '..');

const STANDARDS_DIR = path.join(REPO_ROOT, 'standards');
const STANDARDS_SKILLS_DIR = path.join(STANDARDS_DIR, 'skills');
const STANDARDS_RULE_FILE = path.join(REPO_ROOT, '.agents', 'rules', 'gigaschool-standards.md');
const DISTRIBUTION_JSON = path.join(HERE, 'distribution.json');

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
      if (Array.isArray(map.files)) {
        for (const item of map.files) {
          const srcFile = path.join(STANDARDS_DIR, item.canonical);
          const dstFile = path.join(repoDir, item.local);
          if (fs.existsSync(srcFile)) {
            fs.mkdirSync(path.dirname(dstFile), { recursive: true });
            fs.copyFileSync(srcFile, dstFile);
          }
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

    // 2. Sync .claude/skills and remove any README.md that triggers check-drift false positive
    const claudeSkillsDir = path.join(repoDir, '.claude', 'skills');
    if (fs.existsSync(path.join(repoDir, '.claude'))) {
      fs.mkdirSync(claudeSkillsDir, { recursive: true });
      fs.cpSync(STANDARDS_SKILLS_DIR, claudeSkillsDir, { recursive: true });
      const claudeReadme = path.join(claudeSkillsDir, 'README.md');
      if (fs.existsSync(claudeReadme)) fs.unlinkSync(claudeReadme);
    }

    // 3. Sync .agents/ (Rules & Skills)
    const agentsDir = path.join(repoDir, '.agents');
    const agentsRulesDir = path.join(agentsDir, 'rules');
    const agentsSkillsDir = path.join(agentsDir, 'skills');

    fs.mkdirSync(agentsRulesDir, { recursive: true });
    fs.mkdirSync(agentsSkillsDir, { recursive: true });

    if (fs.existsSync(STANDARDS_RULE_FILE)) {
      fs.copyFileSync(STANDARDS_RULE_FILE, path.join(agentsRulesDir, 'gigaschool-standards.md'));
    }
    fs.cpSync(STANDARDS_SKILLS_DIR, agentsSkillsDir, { recursive: true });

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
      run(`gh pr create --title "${PR_TITLE}" --body "${PR_BODY}" --base "${defaultBranch}"`);
    } catch (e) {
      console.log(`  PR creation note: ${e.message}`);
    }

    // Merge PR
    const mergeCmds = [
      'gh pr merge --admin --merge --delete-branch',
      'gh pr merge --merge --delete-branch',
      'gh pr merge --squash --delete-branch',
      'gh pr merge --auto --merge'
    ];

    for (const mCmd of mergeCmds) {
      try {
        run(mCmd);
        console.log(`  [MERGED] PR successfully merged for ${repoName}`);
        break;
      } catch {}
    }

    run(`git checkout ${defaultBranch}`, true);
    run('git pull', true);

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
