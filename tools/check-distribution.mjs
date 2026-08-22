#!/usr/bin/env node
/**
 * 配布のとりのこしを見つける（ポータル側から見る drift 検知）。
 *
 *   node tools/check-distribution.mjs [--skip-repo-list]
 *
 * ── なぜ要るのか ────────────────────────────────────────────────
 * 各リポジトリの ci.yml には正本とのずれ検知（standards/check-drift.mjs）が
 * 入っている。ただしそれが走るのは「そのリポジトリに何かを push したとき」だけ。
 * 正本だけを直した日は、配布先では何も起きない。緑のまま、古いコピーが残る。
 *
 * 実際に起きた: 2026-08-22、standards/lib/giga-v5-checks.mjs を3回直して
 * 配るのを忘れ、10本のリポジトリの main が同時に赤くなった。気づいたのは
 * その日の最後の掃きで、直すまでの間ずっと「正本を直したのに届いていない」
 * 状態だった。人が配るのを覚えている前提の手順は、こうして落ちる。
 *
 * そこで、正本を持つこのリポジトリの側から配布先を覗きにいく。
 * 各配布先の standards-map.json をそのまま読み、載っているコピーを
 * 正本と突き合わせる。ずれていたら「配っていない」として赤くする。
 *
 * ── いつ赤くなるのか ──────────────────────────────────────────
 * 正本を直した PR そのものは赤くしない（この検査は pull_request では走らない）。
 * 配布先の drift 検知はポータルの main を見るので、正本が main に入るまで
 * 配布 PR は作れない。順番は「正本を merge → 配る」で固定されている。
 *
 * だから main は、正本を直した直後から配り終わるまでの間は赤い。
 * これは不具合ではなく、やり残しの一覧そのもの。最後の1本を配ると緑に戻る。
 *
 * ── 台帳（tools/distribution.json）────────────────────────────
 * GIGAyama にあるリポジトリは、targets（配る先）か excluded（配らない・理由つき）
 * のどちらかに必ず載せる。どちらにも無いリポジトリがあれば赤くする。
 * 「見ていないもの」を黙って作らないための決まりで、standards-map.json の
 * unmanaged と同じ考え方。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NORMALIZERS } from '../standards/check-drift.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/* ── 台帳を読むところ（ここは純粋な関数にしてテストから直に呼ぶ）── */

/** 台帳そのものの不備を返す。空配列なら問題なし。 */
export function ledgerProblems(ledger) {
  const problems = [];
  if (typeof ledger.owner !== 'string' || ledger.owner === '') problems.push('owner がありません');
  const targets = Array.isArray(ledger.targets) ? ledger.targets : null;
  const excluded = Array.isArray(ledger.excluded) ? ledger.excluded : null;
  if (!targets) problems.push('targets の一覧がありません');
  if (!excluded) problems.push('excluded の一覧がありません');
  if (!targets || !excluded) return problems;

  // 空の台帳を通すと「1本も見ていない」のに緑になる
  if (targets.length === 0) problems.push('targets が空です（配る先が1つも無いはずはありません）');

  for (const entry of excluded) {
    if (typeof entry?.repo !== 'string' || entry.repo === '') { problems.push('excluded に repo の無い項目があります'); continue; }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`${entry.repo}: excluded に理由が書かれていません（なぜ配らないのかを書いてください）`);
    }
  }

  const seen = new Set();
  for (const name of [...targets, ...excluded.map((e) => e?.repo)]) {
    if (typeof name !== 'string') continue;
    // 大文字小文字だけ違う2つは、GitHub では同じリポジトリ
    if (seen.has(key(name))) problems.push(`${name}: 台帳に2回出てきます`);
    seen.add(key(name));
  }
  return problems;
}

/**
 * リポジトリ名の照合用の鍵。
 * GitHub のリポジトリ名は大文字小文字を区別しない（Typa でも typa でも同じ所に届く）。
 * 台帳に typa と書き、API が Typa と返したのを「別のリポジトリ」と読んで、
 * 43本ぜんぶを取りちがえたことがある（2026-08-22、この検査の初回）。
 */
const key = (name) => String(name).toLowerCase();

/** GitHub にあるのに台帳に無いリポジトリ（＝誰も見ていないリポジトリ）。 */
export function missingFromLedger(remoteNames, ledger) {
  const known = new Set([
    ...(ledger.targets ?? []),
    ...(ledger.excluded ?? []).map((e) => e?.repo),
    ledger.self,
  ].filter((name) => typeof name === 'string').map(key));
  return remoteNames.filter((name) => !known.has(key(name)));
}

/** 台帳にあるのに GitHub に無いリポジトリ（消したか、名前を変えたか）。 */
export function goneFromGitHub(remoteNames, ledger) {
  const remote = new Set(remoteNames.map(key));
  return [...(ledger.targets ?? []), ...(ledger.excluded ?? []).map((e) => e?.repo)]
    .filter((name) => typeof name === 'string' && !remote.has(key(name)));
}

/** normalize を順に当てる。未知の名前は黙って素通りさせない。 */
export function normalized(text, names) {
  let out = text;
  for (const name of names) {
    const fn = NORMALIZERS[name];
    if (!fn) throw new Error(`未知の normalize "${name}"`);
    out = fn(out);
  }
  return out;
}

/** `git ls-remote --symref <url> HEAD` の出力から、既定ブランチと先端の SHA を取る。 */
export function parseSymref(output) {
  const ref = /^ref:\s+(\S+)\s+HEAD$/m.exec(output);
  const sha = /^([0-9a-f]{40})\s+HEAD$/m.exec(output);
  if (!ref || !sha) throw new Error(`git ls-remote の出力を読めませんでした:\n${output}`);
  return { ref: ref[1], sha: sha[1] };
}

/** GitHub API のリポジトリ一覧（1ページ分）から名前を取り出す。 */
export function namesFromRepoPage(page) {
  if (!Array.isArray(page)) throw new Error(`リポジトリ一覧が配列ではありません: ${JSON.stringify(page).slice(0, 200)}`);
  return page.map((repo) => repo.name);
}

/* ── ここから先は外に出ていく ── */

function ghHeaders() {
  const headers = { 'user-agent': 'giga-check-distribution', accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/** 見つからなければ null。それ以外の失敗は投げる（黙って素通りさせない）。 */
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'giga-check-distribution' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.text();
}

async function listRepos(owner) {
  const names = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/users/${owner}/repos?per_page=100&type=owner&page=${page}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) {
      throw new Error(
        `リポジトリ一覧を取れませんでした（HTTP ${res.status}）: ${url}\n` +
        `${(await res.text()).slice(0, 300)}\n` +
        '手元で試すときは --skip-repo-list を付けてください（そのとき台帳の抜けは見ていません）。'
      );
    }
    const body = namesFromRepoPage(await res.json());
    names.push(...body);
    if (body.length < 100) return names;
  }
  throw new Error('リポジトリ一覧が10ページを超えました。取り方を見直してください。');
}

/**
 * 配布先を1本見る。
 * 既定ブランチの先端 SHA を先に取り、その SHA で中身を取る。
 * ブランチ名で取ると CDN の控えが数分残り、配った直後に「まだ古い」と誤って言う。
 */
async function checkRepo(owner, repo, standardsDir) {
  const { sha } = parseSymref(
    (await execFileAsync('git', ['ls-remote', '--symref', `https://github.com/${owner}/${repo}.git`, 'HEAD'])).stdout
  );
  const raw = (p) => `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${p}`;

  const mapSource = await fetchText(raw('standards-map.json'));
  if (mapSource === null) {
    return { repo, sha, compared: 0, problems: ['配る先なのに standards-map.json がありません（対応表が無いので、正本を直しても届きません）'] };
  }
  let map;
  try { map = JSON.parse(mapSource); }
  catch (error) { return { repo, sha, compared: 0, problems: [`standards-map.json を読めません: ${error.message}`] }; }

  const entries = Array.isArray(map.files) ? map.files : [];
  const problems = [];
  let compared = 0;

  for (const { canonical, local, normalize = [] } of entries) {
    const canonicalPath = path.join(standardsDir, canonical);
    if (!fs.existsSync(canonicalPath)) {
      problems.push(`${local}: 正本 standards/${canonical} がありません（正本で消したのなら、配布先の対応表からも外してください）`);
      continue;
    }
    const copy = await fetchText(raw(local));
    if (copy === null) { problems.push(`${local}: 配布先にコピーがありません`); continue; }
    let here, there;
    try {
      here = normalized(fs.readFileSync(canonicalPath, 'utf8'), normalize);
      there = normalized(copy, normalize);
    } catch (error) { problems.push(`${local}: ${error.message}`); continue; }
    compared++;
    if (here !== there) problems.push(`${local}: 正本 standards/${canonical} を配っていません`);
  }

  if (entries.length === 0 && !Array.isArray(map.unmanaged)) {
    problems.push('standards-map.json に files も unmanaged もありません');
  }
  return { repo, sha, compared, problems };
}

/** 同時に走らせる本数を絞る。43本を一斉に叩かない。 */
async function pool(items, width, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function main() {
  const skipRepoList = process.argv.includes('--skip-repo-list');
  const ledgerPath = path.join(HERE, 'distribution.json');
  const standardsDir = path.join(REPO_ROOT, 'standards');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  const fatal = [];

  const bad = ledgerProblems(ledger);
  if (bad.length) {
    console.error('❌ 台帳（tools/distribution.json）に不備があります:');
    for (const line of bad) console.error(`  - ${line}`);
    process.exit(1);
  }

  if (skipRepoList) {
    console.log('⚠️  --skip-repo-list が付いています。台帳に載っていないリポジトリは見ていません。');
  } else {
    const remote = await listRepos(ledger.owner);
    const missing = missingFromLedger(remote, ledger);
    const gone = goneFromGitHub(remote, ledger);
    if (missing.length) {
      fatal.push(
        `${ledger.owner} に、台帳へ載っていないリポジトリが ${missing.length} 件あります: ${missing.join(', ')}\n` +
        '  配る先なら targets に、配らないなら excluded に理由つきで足してください。'
      );
    }
    if (gone.length) {
      fatal.push(`台帳にあるのに GitHub で見つかりません: ${gone.join(', ')}（消したか、名前が変わっています）`);
    }
    console.log(`GitHub の ${ledger.owner} には ${remote.length} 本。台帳は targets ${ledger.targets.length} 本＋除外 ${ledger.excluded.length} 本。`);
  }

  const results = await pool(ledger.targets, 6, (repo) =>
    checkRepo(ledger.owner, repo, standardsDir).catch((error) => ({ repo, compared: 0, problems: [`見にいけませんでした: ${error.message}`] }))
  );

  const stale = results.filter((r) => r.problems.length > 0);
  const compared = results.reduce((sum, r) => sum + r.compared, 0);

  for (const result of stale) {
    console.error(`❌ ${result.repo}`);
    for (const line of result.problems) console.error(`     - ${line}`);
  }

  // 1本も突き合わせていないのに緑になると、「配布は行き届いている」と読めてしまう。
  // 取り方を間違えて全部空振りしていても同じ出力になるので、ここは落とす。
  if (compared === 0) fatal.push('突き合わせたファイルが0件でした。配布先の対応表を読めていません。');

  for (const line of fatal) console.error(`❌ ${line}`);

  if (stale.length || fatal.length) {
    console.error('');
    console.error('直し方: 正本を配布先へコピーし直して、各リポジトリで PR を出してください。');
    console.error('  cp standards/<正本> ../<リポジトリ>/<コピー先>');
    console.error('この検査は正本を直した時点から、最後の1本を配り終えるまで赤いままです。');
    process.exit(1);
  }

  console.log(`✅ 配布先 ${results.length} 本、${compared} ファイルが正本と一致しています。`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error('❌ ' + (error.stack ?? error.message)); process.exit(1); });
}
