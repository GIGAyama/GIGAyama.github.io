#!/usr/bin/env node
/**
 * 艦隊ぜんぶの main で、いま赤いワークフローを 1 回で読む。
 *
 *   node tools/fleet-ci.mjs            人が読む一覧（赤か、測れないものがあれば exit 1）
 *   node tools/fleet-ci.mjs --json     機械が読む形
 *   node tools/fleet-ci.mjs --repo Typa
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 正本の配布（tools/distribute.mjs）は、配布先の CI を**待たずに** main へ入れる
 * （`gh pr merge --admin` を最初に試す）。43 本を止めずに配るための形で、
 * それ自体はよい。ただ、入れたあとに配布先の main が赤くなっても、
 * **それを集めて見る道具が 1 つも無かった**（2026-11-10 に確かめた）。
 *
 *   check-distribution … 写しが正本と同じかだけを見る。CI は見ない
 *   fleet-status       … 手元のクローンの持ちものを見る。CI は見ない
 *
 * つまり「配ったせいで 1 本の検査が落ちた」は、そのリポジトリを開いた人しか
 * 知らない。静的な PWA は main がそのまま公開されるので、赤いまま子どもの
 * 端末へ届く。
 *
 * ── 見かた ────────────────────────────────────────────
 *
 * 既定の枝について、ワークフローごとに**最後に終わった回**を見る。
 * 走っている途中の回と、取り消された回は飛ばして、その前を見る
 * （配った直後は 43 本が走っている途中なので、それを赤とも緑とも数えない）。
 *
 * ⚠️ 測れなかったものを「赤くない」に数えない。GitHub が見えなかった 1 本は、
 *    見ていないのであって緑ではない。1 本でもあれば exit 1。
 *
 * ⚠️ ポータル自身は見ない。ポータルのワークフローは、それぞれが自分で
 *    Issue に知らせる（tools/report-issue.mjs）。ここで重ねて見ると、
 *    この検査が赤い → 次の回がそれを見てまた赤い、と自分で自分を赤くし続ける。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ghApi } from './lib/gh.mjs';
import { jstDate } from './lib/dates.mjs';
import { fleetRepos } from './fleet-status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT = 'giga-fleet-ci';

/** 結果として数える終わりかた。cancelled / skipped / neutral は「分からない」なので前の回を見る */
const RED = new Set(['failure', 'timed_out', 'startup_failure']);
const DECISIVE = new Set(['success', ...RED]);

/**
 * ワークフローごとに、最後に結果が出た回を 1 つずつ選ぶ。
 *
 * @param {object[]} runs GitHub の actions/runs（新しい順）
 * @returns {object[]} ワークフロー 1 つにつき 1 件
 */
export function latestPerWorkflow(runs) {
  const seen = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.status !== 'completed' || !DECISIVE.has(run.conclusion)) continue;
    /* PR の回は既定の枝の状態ではない（fork の枝が同じ名前を名のることがある） */
    if (run.event === 'pull_request' || run.event === 'pull_request_target') continue;
    const id = run.workflow_id ?? run.path ?? run.name;
    if (!seen.has(id)) seen.set(id, run);
  }
  return [...seen.values()];
}

/** その中で赤いもの */
export function redOf(latest) {
  return latest.filter((r) => RED.has(r.conclusion)).map((r) => ({
    name: r.name || r.path || '(名前なし)',
    path: r.path || '',
    conclusion: r.conclusion,
    date: jstDate(r.updated_at || r.created_at),
    url: r.html_url || '',
  }));
}

/**
 * 1 本ずつの結果を、出す行と終了コードにまとめる。
 *
 * @param {Array<{repo: string, red?: object[], workflows?: number, skipped?: string, error?: string}>} results
 */
export function summarize(results) {
  const lines = [];
  const red = results.filter((r) => r.red?.length);
  const unmeasured = results.filter((r) => r.error);
  const skipped = results.filter((r) => r.skipped);
  const measured = results.filter((r) => !r.error && !r.skipped);
  const workflows = measured.reduce((n, r) => n + (r.workflows ?? 0), 0);

  for (const r of red) {
    lines.push(`❌ ${r.repo}`);
    for (const w of r.red) {
      lines.push(`     - ${w.name}${w.path ? `（${w.path}）` : ''}: ${w.conclusion}  ${w.date}  ${w.url}`);
    }
  }
  for (const r of unmeasured) lines.push(`⚠️ 測れなかった: ${r.repo}（${r.error}）`);
  for (const r of skipped) lines.push(`－ 見ていない: ${r.repo}（${r.skipped}）`);

  /* 「0 件でした」を信じない。1 つも見ていないなら、赤が無いのではなく何も見ていない */
  const nothing = workflows === 0;
  if (nothing) lines.push('❌ ワークフローの実行を 1 件も読めませんでした。何も見ていません。');

  if (red.length) {
    lines.push('', `赤いワークフローが ${red.length} 本のリポジトリにあります。`,
      '直し方: 上の URL から失敗した回を開く。正本の配布のすぐあとなら、配った正本が原因のことが多いので、',
      '  そのリポジトリではなく standards/ の正本を直して配りなおす（配布先の写しを直しても次の配布で消える）。');
  }
  if (unmeasured.length) {
    lines.push('', '測れなかったものは「赤くない」ではありません。合格として数えていません。');
  }
  if (!red.length && !unmeasured.length && !nothing) {
    lines.push(`✅ 赤いワークフローはありません（${measured.length} 本・${workflows} ワークフローを見ました）。`);
  }
  return { lines, code: red.length || unmeasured.length || nothing ? 1 : 0, red, unmeasured, skipped, workflows };
}

async function json(pathname) {
  const res = await ghApi(pathname, AGENT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 艦隊ぜんぶの「既定の枝」と「アーカイブ済みか」を、一覧 1 回で読む。
 *
 * ⚠️ 1 本ずつ聞かない。43 本 × 2 回になり、トークンが他のリポジトリを読めずに
 *    匿名へ落ちた朝は、匿名の上限（1 時間 60 回）を超えて半分が「測れなかった」になる。
 *
 * @param {object[]} page GitHub の users/<owner>/repos の 1 ページ
 * @returns {Map<string, {branch: string, archived: boolean}>} 鍵は小文字の名前
 */
export function repoIndex(pages) {
  const index = new Map();
  for (const repo of Array.isArray(pages) ? pages : []) {
    if (!repo || typeof repo.name !== 'string') continue;
    index.set(repo.name.toLowerCase(), { branch: repo.default_branch || 'main', archived: Boolean(repo.archived) });
  }
  return index;
}

async function listRepoObjects(owner) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/users/${owner}/repos?per_page=100&type=owner&page=${page}`;
    const headers = { accept: 'application/vnd.github+json', 'user-agent': AGENT };
    const token = process.env.GITHUB_TOKEN;
    let res = await fetch(url, { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers });
    /* 手元のトークンが他を読めないことがある。艦隊はどれも公開なので、断られたら匿名で 1 回 */
    if ((res.status === 401 || res.status === 403) && token) res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`リポジトリの一覧を取れませんでした（HTTP ${res.status}）`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error('リポジトリの一覧が配列ではありません');
    all.push(...body);
    if (body.length < 100) break;
  }
  return all;
}

async function inspect(repo, index) {
  const info = index.get(repo.toLowerCase());
  if (!info) throw new Error('GitHub の一覧にありません');
  if (info.archived) return { repo, skipped: 'アーカイブ済み' };
  const body = await json(`${repo}/actions/runs?branch=${encodeURIComponent(info.branch)}&per_page=50`);
  const latest = latestPerWorkflow(body.workflow_runs);
  return { repo, workflows: latest.length, red: redOf(latest) };
}

async function pool(items, width, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function main() {
  const ledger = JSON.parse(fs.readFileSync(path.join(HERE, 'distribution.json'), 'utf8'));
  const i = process.argv.indexOf('--repo');
  const only = i >= 0 ? process.argv[i + 1] : null;
  const repos = fleetRepos(ledger).filter((r) => !only || r.toLowerCase() === String(only).toLowerCase());
  if (repos.length === 0) { console.error(`❌ 見るリポジトリがありません${only ? `（--repo ${only} は台帳にありません）` : ''}`); return 1; }

  const index = repoIndex(await listRepoObjects(ledger.owner));
  const results = await pool(repos, 6, async (repo) => {
    /* GitHub は朝に 1 回だけこけることがある。1 回だけやり直す（2 回はやらない） */
    try { return await inspect(repo, index); }
    catch { try { return await inspect(repo, index); } catch (error) { return { repo, error: error.message }; } }
  });

  const out = summarize(results);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ red: out.red, unmeasured: out.unmeasured, skipped: out.skipped, workflows: out.workflows }, null, 2));
  } else {
    console.log(`艦隊 ${repos.length} 本の、既定の枝の CI（ワークフローごとに、最後に終わった回）\n`);
    for (const line of out.lines) console.log(line);
  }
  return out.code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code))
    .catch((error) => { console.error(`❌ ${error.stack ?? error.message}`); process.exit(1); });
}
