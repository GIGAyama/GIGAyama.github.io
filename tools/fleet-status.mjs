#!/usr/bin/env node
/**
 * 艦隊 43 本の状態を 1 回で読む。
 *
 *   node tools/fleet-status.mjs            人が読む表
 *   node tools/fleet-status.mjs --json     エージェントが読む
 *   node tools/fleet-status.mjs --todo     作業待ち行列（違反 → 直し方 → 使う正本の道具）
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 「v5 ゲートがまだ入っていないのはどれか」に答えるには、42 本を歩くしかなかった。
 * 人にも重いが、エージェントにはもっと重い（歩いたぶんだけ文脈が埋まる）。
 * 既に在る道具を束ねるだけで 1 コマンドになる。**新しい正本は作らない。**
 *
 * ── --todo がいちばん効く ─────────────────────────────
 *
 * 2026-08-29 に測ったとき、Zero-CDN 違反が data/apps.json に載っていた。
 * 毎朝 sync-updates.yml が更新し、/filtering/ に「許可してください」と
 * 掲載までしているのに、**作業待ち行列にはなっていなかった。**
 * 測っているのに直らないのは、測った結果が「次に何をするか」の形に
 * なっていないため。だから違反 → 直し方 → 使う正本の道具まで出す。
 *
 * ⚠️ 測れなかったものを「問題なし」に数えないこと。
 *    配布先が手元に無ければ（CI では自分しか checkout していない）、
 *    それは「調べていない」であって「きれい」ではない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* 止めたい CDN の一覧は giga-reviewer の正本から借りる。
   2 か所に持つと、片方だけ直したときに食い違う。 */
import { FORBIDDEN_CDN_HOSTS } from '../standards/skills/giga-reviewer/scripts/lint-giga.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BASE_DIR = path.resolve(REPO_ROOT, '..');

/** 1 本ぶんの持ちもの。ここに無いものは「調べていない」 */
export function inspectRepo(repoDir, deps = {}) {
  const { exists = fs.existsSync, read = fs.readFileSync } = deps;
  if (!exists(repoDir)) return null;          // 手元に無い ＝ 調べていない
  const has = (p) => exists(path.join(repoDir, p));

  let scripts = {};
  if (has('package.json')) {
    try { scripts = JSON.parse(read(path.join(repoDir, 'package.json'), 'utf8')).scripts || {}; }
    catch { scripts = {}; }
  }
  return {
    v5Gate: has('scripts/lib/giga-v5-checks.mjs'),
    qualityConfig: has('quality.config.json'),
    buildSw: has('tools/build-sw.mjs'),
    standardsMap: has('standards-map.json'),
    claudeMd: has('CLAUDE.md'),
    hooks: has('.claude/settings.json'),
    check: Boolean(scripts.check),
    test: Boolean(scripts.test),
  };
}

/** data/apps.json の hosts から Zero-CDN 違反を拾う */
export function cdnViolations(apps, forbidden = FORBIDDEN_CDN_HOSTS) {
  const bad = new Set(forbidden.map((h) => h.toLowerCase()));
  return (apps.items ?? [])
    .map((it) => ({
      repo: it.repo,
      slug: it.slug,
      hosts: (it.hosts ?? []).filter((h) => bad.has(String(h).toLowerCase())),
    }))
    .filter((r) => r.hosts.length > 0);
}

/** 違反 → 直し方 → 使う正本の道具 */
export function fixFor(host) {
  const h = host.toLowerCase();
  if (h.includes('fonts.google') || h.includes('gstatic')) {
    return 'standards/fonts/build-fonts.mjs で自己ホスト化（束は 780 字まで。超えると 200 のまま効かなくなる）';
  }
  return 'standards/vendor/build-vendor.mjs で取りこむ（アイコンは webfont ごとではなく、使用分の SVG を mask-image に）';
}

/** 台帳にある全リポジトリ（targets ＋ skills.extra） */
export function fleetRepos(ledger) {
  const extra = ledger.skills?.extra ?? [];
  return [...new Set([...(ledger.targets ?? []), ...extra])].sort();
}

/** 行列を組む。measured / unmeasured を分けて返す（推測で埋めない） */
export function buildStatus(repos, apps, inspect) {
  const measured = [];
  const unmeasured = [];
  for (const repo of repos) {
    const info = inspect(repo);
    if (info === null) { unmeasured.push(repo); continue; }
    measured.push({ repo, ...info });
  }
  return { measured, unmeasured, cdn: cdnViolations(apps) };
}

/** 作業待ち行列。何をすればよいかまで書く */
export function todoLines(status) {
  const out = [];
  for (const v of status.cdn) {
    for (const host of v.hosts) {
      out.push(`[Zero-CDN] ${v.repo}: ${host}\n    → ${fixFor(host)}`);
    }
  }
  const noGate = status.measured.filter((r) => !r.v5Gate).map((r) => r.repo);
  if (noGate.length) {
    out.push(
      `[ゲート未配備] ${noGate.length} 本: scripts/lib/giga-v5-checks.mjs が無い\n`
      + `    → standards/lib/run-giga-checks.mjs を scripts/check-standard.mjs として配る\n`
      + `    ${noGate.join(', ')}`,
    );
  }
  const noCheck = status.measured.filter((r) => !r.check).map((r) => r.repo);
  if (noCheck.length) {
    out.push(`[検査そのものが無い] ${noCheck.length} 本: npm run check が無い\n    ${noCheck.join(', ')}`);
  }
  return out;
}

function main() {
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/distribution.json'), 'utf8'));
  const apps = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/apps.json'), 'utf8'));
  const repos = fleetRepos(ledger);
  const status = buildStatus(repos, apps, (r) => inspectRepo(path.join(BASE_DIR, r)));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  if (process.argv.includes('--todo')) {
    const lines = todoLines(status);
    if (lines.length === 0) console.log('作業待ちはありません。');
    else { console.log(`作業待ち ${lines.length} 件:\n`); for (const l of lines) console.log(l + '\n'); }
    /* ⚠️ Zero-CDN の行は data/apps.json の hosts から出している。あれは
          毎朝 sync-updates.yml が**配布ファイルの静的解析から推定**したもの。
          直したばかりのものが残って見えることがある。日付を必ず添える。
          実測が要るなら node tools/verify-runtime.mjs を走らせること。 */
    if (status.cdn.length) {
      console.log(`（Zero-CDN の行は data/apps.json の推定。生成日 ${apps.generatedAt ?? '不明'}。`);
      console.log('　実測は node tools/verify-runtime.mjs）\n');
    }
    if (status.unmeasured.length) {
      console.log(`⚠️ 手元に無くて調べられなかった: ${status.unmeasured.length} 本`);
      console.log('   （「きれい」ではなく「調べていない」。隣に clone してから、もう一度）');
    }
    return 0;
  }

  const col = (b) => (b ? '✅' : '－');
  console.log('REPO'.padEnd(30) + 'v5  cfg  sw   map  CLAUDE hook check test');
  for (const r of status.measured) {
    console.log(
      r.repo.padEnd(30)
      + [r.v5Gate, r.qualityConfig, r.buildSw, r.standardsMap, r.claudeMd, r.hooks, r.check, r.test]
        .map(col).join('   '),
    );
  }
  const n = status.measured.length;
  const count = (k) => status.measured.filter((r) => r[k]).length;
  console.log(`\n測れた ${n} 本 / 台帳 ${repos.length} 本`);
  console.log(`  v5 ゲート ${count('v5Gate')}  ・ SW版数 ${count('buildSw')}  ・ CLAUDE.md ${count('claudeMd')}`
    + `  ・ hook ${count('hooks')}  ・ npm run check ${count('check')}`);
  if (status.cdn.length) console.log(`  ⚠️ Zero-CDN 違反 ${status.cdn.length} 本（--todo で直し方を出します）`);
  if (status.unmeasured.length) {
    console.log(`  ⚠️ 手元に無くて調べられなかった ${status.unmeasured.length} 本（調べていない、であって、きれい、ではありません）`);
  }
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());
