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
import { SKILL_ROOTS } from '../standards/check-drift.mjs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NORMALIZERS, listFiles } from '../standards/check-drift.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/* ── 台帳を読むところ（ここは純粋な関数にしてテストから直に呼ぶ）── */

/** 台帳そのものの不備を返す。空配列なら問題なし。 */
export function ledgerProblems(ledger, knownSkills = null) {
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

  /* スキルの軸。required に書いたスキルが正本に無ければ、配布先ぜんぶが
     「まだ配っていません」になる。台帳の綴り違いを、そこで気づくのは遅い */
  const { required, extra } = skillsOf(ledger);
  const targetKeys = new Set(targets.filter((t) => typeof t === 'string').map(key));
  const excludedKeys = new Set(excluded.map((e) => e?.repo).filter((r) => typeof r === 'string').map(key));
  for (const name of extra) {
    if (typeof name !== 'string' || name === '') { problems.push('skills.extra に名前の無い項目があります'); continue; }
    /* targets には最初から配るので、書くと二重になる */
    if (targetKeys.has(key(name))) problems.push(`${name}: targets にあるので skills.extra に書く必要はありません`);
    /* ⚠️ excluded に載っていないと、GitHub との突き合わせ（missingFromLedger）から
       こぼれる。スキルだけ配る先も、台帳のどこかには必ず名前を出しておく */
    else if (!excludedKeys.has(key(name))) problems.push(`${name}: skills.extra にありますが、targets にも excluded にもありません`);
  }
  for (const name of required) {
    if (typeof name !== 'string' || name === '') { problems.push('skills.required に名前の無い項目があります'); continue; }
    if (knownSkills && !knownSkills.includes(name)) {
      problems.push(`skills.required の ${name} が正本（standards/skills/）にありません`);
    }
  }

  /* ⚠️ ここに extra を混ぜない。スキルだけ配る先は excluded にも載るのが
     正しい形（コードは配らない／スキルは配る）で、二重登録ではない */
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
 * スキルの配る先と、配るスキルの名前。
 *
 * 台帳は軸を 2 つ持つ。
 *
 *   targets        コードの正本（ゲート・SW・受け渡し口）を配る先
 *   skills.extra   コードは配らないが、スキルは配る先
 *
 * excluded の理由はどれも「正本のコピーを1つも持たない」で、これはコードの話。
 * スキルには当てはまらない（開発はどのリポジトリでも起きる）ので、
 * 理由を書き替えずに、別の軸を足してある。
 */
export function skillsOf(ledger) {
  const skills = ledger.skills ?? {};
  return {
    required: Array.isArray(skills.required) ? skills.required : [],
    extra: Array.isArray(skills.extra) ? skills.extra : [],
  };
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
/* Claude Code の常時ルールは、この 1 行でルール正本を取りこむ。
   同じ文を CLAUDE.md と .agents/rules/ の 2 か所に置かないための形。 */
export const RULES_IMPORT_LINE = '@.agents/rules/gigaschool-standards.md';

const RULES_LOCAL = '.agents/rules/gigaschool-standards.md';
const localsOf = (rows) => new Set(
  (Array.isArray(rows) ? rows : [])
    .map((r) => (r && typeof r.local === 'string' ? r.local.replace(/\/+$/, '') : ''))
    .filter(Boolean)
);

/** CLAUDE.md が独自の中身を持つ宣言なら、本文を取って取りこみ行を見る必要がある */
export function agentContextNeedsBody(map) {
  return localsOf(map?.unmanaged).has('CLAUDE.md');
}

/**
 * エージェントの常時ルールが、配られていて、かつ照合の対象になっているか。
 *
 * ⚠️ 2026-08-29 に実測した穴。.agents/rules/gigaschool-standards.md は 42 本へ
 *    配られていたのに、どの standards-map.json にも載っていなかった。
 *    載っていないものは check-drift も check-distribution も見ないので、
 *    書き替えても両方が緑を返す（Typa で 1 行足して exit 0 を確認した）。
 *    エージェントの行動を決める文書が、書き替え放題で緑になっていた。
 *    2026-08-28 の「.agents/skills が無検査だった」とまったく同じ型。
 *
 * @param {object} map 配布先の standards-map.json
 * @param {string|null|undefined} claudeMd CLAUDE.md の中身。
 *   undefined = 取っていない（対応表で照合されるので取る必要が無い）
 */
export function agentContextProblems(map, claudeMd) {
  const problems = [];
  const files = localsOf(map?.files);
  const unmanaged = localsOf(map?.unmanaged);

  if (!files.has(RULES_LOCAL) && !unmanaged.has(RULES_LOCAL)) {
    problems.push(
      `${RULES_LOCAL}: standards-map.json にありません`
      + '（配ってはいますが照合されていないので、書き替えても緑のまま通ります）'
    );
  }

  if (files.has('CLAUDE.md')) return problems;   // files ループが 1 バイトずつ見ている

  if (!unmanaged.has('CLAUDE.md')) {
    problems.push(
      'CLAUDE.md: standards-map.json にありません'
      + '（正本 standards/agents/CLAUDE.md を配るか、独自の中身を持つなら unmanaged に理由つきで宣言してください）'
    );
    return problems;
  }

  // 独自の中身を持つ宣言。取りこみ 1 行だけは残っていること
  if (claudeMd === null) {
    problems.push('CLAUDE.md: unmanaged に宣言がありますが、ファイルがありません');
  } else if (typeof claudeMd === 'string' && !claudeMd.includes(RULES_IMPORT_LINE)) {
    problems.push(
      `CLAUDE.md: 取りこみの行（${RULES_IMPORT_LINE}）がありません`
      + '（この 1 行が無いと、Claude Code だけが艦隊共通のルールを読まないまま動きます）'
    );
  }
  return problems;
}

async function checkRepo(owner, repo, standardsDir, requiredSkills = []) {
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
  const dirEntries = Array.isArray(map.dirs) ? map.dirs : [];
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

  /* ディレクトリまるごと（スキル）。
     正本の側は手元にあるので列挙できる。配布先は 1 本ずつ raw から取る。
     ⚠️ 配布先の「余分なファイル」はここからは見えない。ディレクトリを
        列挙する手だてが無いため（API は使わない約束）。そちらは配布先の
        check-drift が見る。役割を分けてあることを、両方に書いてある。 */
  for (const { canonical, local } of dirEntries) {
    const canonicalDir = path.join(standardsDir, canonical);
    if (!fs.existsSync(canonicalDir)) {
      problems.push(`${local}: 正本 standards/${canonical} がありません（正本で消したのなら、配布先の対応表からも外してください）`);
      continue;
    }
    for (const rel of listFiles(canonicalDir)) {
      const copy = await fetchText(raw(`${local}/${rel}`));
      if (copy === null) { problems.push(`${local}/${rel}: 配布先にコピーがありません`); continue; }
      compared++;
      if (fs.readFileSync(path.join(canonicalDir, rel), 'utf8') !== copy) {
        problems.push(`${local}/${rel}: 正本 standards/${canonical}/${rel} を配っていません`);
      }
    }
  }

  /* 台帳が「このリポジトリにも配る」と言っているスキルが、対応表に無い。
     これが「まだ 1 本も配っていない」を赤くする唯一の signal。
     対応表に書かれていないものは照合されないので、これが無いと
     配り忘れたリポジトリが緑のまま残る。 */
  for (const name of requiredSkills) {
    /* ⚠️ 置き場ごとに見る。canonical だけで「もう書いてある」と判定していたころは、
          .claude/ の行が 1 本あるだけで .agents/ を配り忘れていても緑だった。
          Claude Code と Antigravity のどちらか片方だけ動く状態が、
          ポータル側からは見えないまま残る。 */
    for (const root of SKILL_ROOTS) {
      if (!dirEntries.some((e) => e.local === `${root}/${name}`)) {
        problems.push(`スキル ${name} が standards-map.json の dirs にありません（${root}/ にまだ配っていません）`);
      }
    }
  }

  if (entries.length === 0 && dirEntries.length === 0 && !Array.isArray(map.unmanaged)) {
    problems.push('standards-map.json に files も dirs も unmanaged もありません');
  }

  /* エージェントの常時ルール。配っただけで照合の外にあるものを作らせない。
     CLAUDE.md は独自の中身を持ってよいので、そのときだけ本文を取って
     取りこみ 1 行が残っているかを見る（宣言しただけで無検査にしない）。 */
  const claudeMd = agentContextNeedsBody(map)
    ? await fetchText(raw('CLAUDE.md'))
    : undefined;
  problems.push(...agentContextProblems(map, claudeMd));

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

  /* 正本に実在するスキルの名前。台帳の綴り違いをここで止める。
     渡さないと「required に書いたのに正本に無い」が配布先ぜんぶの
     「まだ配っていません」として出て、原因が分からなくなる */
  const knownSkills = fs.existsSync(path.join(standardsDir, 'skills'))
    ? fs.readdirSync(path.join(standardsDir, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const bad = ledgerProblems(ledger, knownSkills);
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

  /* スキルの配る先は targets ＋ skills.extra。
     ⚠️ コードの正本（ゲートや SW）と配る先が違う。excluded の 10 本が外れて
        いる理由は「そのコピーを持たない」で、スキルには当てはまらない。
        開発はどのリポジトリでも起きるので、スキルはそちらにも配る。 */
  const requiredSkills = skillsOf(ledger).required;
  const skillOnly = skillsOf(ledger).extra;
  const everyone = [...ledger.targets, ...skillOnly];

  const results = await pool(everyone, 6, (repo) =>
    checkRepo(ledger.owner, repo, standardsDir, requiredSkills)
      .catch((error) => ({ repo, compared: 0, problems: [`見にいけませんでした: ${error.message}`] }))
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

  console.log(`✅ 配布先 ${results.length} 本（うちスキルだけ ${skillOnly.length} 本）、`
    + `${compared} ファイルが正本と一致しています。`);
}

/* ⚠️ `file://${process.argv[1]}` を文字列で組み立てて比べないこと。Windows は
   file:///C:/… とスラッシュの数が違い、空白や日本語を含むパスは Linux でも
   %20 の有無で一致しない。一致しなければ main() は呼ばれず、何も見ないまま
   exit 0 になる（2026-08-28 に giga-reviewer で起きた型。2026-09-02 に正本 3 本で再発）。
   standards/lib/cli-entry.test.mjs が字面で見張っている。 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error('❌ ' + (error.stack ?? error.message)); process.exit(1); });
}
