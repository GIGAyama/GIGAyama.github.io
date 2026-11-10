#!/usr/bin/env node
/**
 * GIGAyama に増えたリポジトリを、配布の台帳（tools/distribution.json）へ足す。
 *
 *   node tools/register-repos.mjs            何を足すかを言うだけ（書かない）
 *   node tools/register-repos.mjs --apply    台帳に書く
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 新しいアプリのリポジトリを作ると、「配布のとりのこし」は翌朝から赤くなる
 * （台帳に無いリポジトリを黙って作らせないための決まり）。そこまでは正しい。
 * ところが足すのは人の手で、2026-09-19 に Hiding-animal が増えたときは
 * **52 日のあいだ誰も足さなかった**（2026-11-08 に足すまで毎朝赤いまま）。
 * 足すときも本数の assert が 2 か所にあり、片方を直し忘れて CI が落ちた。
 *
 * 足してよいかどうかは、ほとんどの場合リポジトリ自身が言っている。
 * `standards-map.json` を持つものは「正本の写しを持つ」と自分で宣言している
 * ので、targets に入れるのが決まり（giga-scaffold が最初から置く）。
 * 人が 2026-11-08 にやったのも、これを見て 1 行足すことだった。
 *
 * ── 機械で決めるもの・決めないもの ────────────────────
 *
 *   足す      standards-map.json を持ち、JSON として読め、files か dirs がある
 *   足さない  それ以外ぜんぶ（対応表が無い／fork／アーカイブ済み）
 *
 * ⚠️ 足さないものを excluded に「自動で」入れない。excluded の理由は
 *    「なぜ配らないか」を人が書く欄で、機械が埋めると、検査も入っていない
 *    アプリが理由つきで黙って通るようになる。足さなかったものは
 *    check-distribution が赤くし、Issue が人に届ける。
 *
 * ⚠️ 消えたリポジトリを台帳から外すこともしない。一覧を取りそこねた朝に
 *    台帳がまるごと消える、という壊し方ができてしまうため。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  listRepos, fetchText, ghHeaders, missingFromLedger, ledgerProblems,
} from './check-distribution.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, 'distribution.json');
const key = (name) => String(name).toLowerCase();

/**
 * 1 本ぶんを見て、足すか、人に聞くかを決める。
 *
 * @param {{fork?: boolean, archived?: boolean, mapText: string|null}} repo
 *   mapText は standards-map.json の中身。置いていなければ null
 * @returns {{action: 'target'}|{action: 'ask', why: string}}
 */
export function classify({ fork = false, archived = false, mapText }) {
  if (archived) return { action: 'ask', why: 'アーカイブ済みです（push できないので配れません）' };
  if (fork) return { action: 'ask', why: 'fork です（よその正本を持つので、配る先かどうかを機械では決められません）' };
  if (mapText === null || mapText === undefined) {
    return { action: 'ask', why: 'standards-map.json がありません（正本の写しを持たないので、配る先かどうかを機械では決められません）' };
  }
  let map;
  try { map = JSON.parse(mapText); }
  catch { return { action: 'ask', why: 'standards-map.json を JSON として読めません' }; }
  const rows = [...(Array.isArray(map?.files) ? map.files : []), ...(Array.isArray(map?.dirs) ? map.dirs : [])];
  if (rows.length === 0) return { action: 'ask', why: 'standards-map.json に files も dirs もありません（配るものが決まっていません）' };
  return { action: 'target' };
}

/**
 * targets に足した台帳を返す（もとは書き替えない）。
 * 並びは大文字小文字を分けない名前の順。いまの台帳がその順なので、そろえる。
 */
export function addTargets(ledger, names) {
  const next = structuredClone(ledger);
  const known = new Set([
    ...(next.targets ?? []), ...(next.excluded ?? []).map((e) => e?.repo), next.self,
  ].filter((n) => typeof n === 'string').map(key));
  for (const name of names) {
    if (known.has(key(name))) continue;        // もう載っている（2 回書かない）
    known.add(key(name));
    const at = next.targets.findIndex((t) => key(t) > key(name));
    next.targets.splice(at === -1 ? next.targets.length : at, 0, name);
  }
  return next;
}

/** 台帳の書きかた。いまのファイルと 1 バイトも違わない形で書く（差分を汚さない） */
export const serializeLedger = (ledger) => `${JSON.stringify(ledger, null, 1)}\n`;

async function repoInfo(owner, name) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`${owner}/${name}: HTTP ${res.status}`);
  const json = await res.json();
  return { fork: Boolean(json.fork), archived: Boolean(json.archived) };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const missing = missingFromLedger(await listRepos(ledger.owner), ledger);

  if (missing.length === 0) {
    console.log('台帳に載っていないリポジトリはありません。');
    return 0;
  }

  const add = [];
  const ask = [];
  for (const name of missing) {
    const info = await repoInfo(ledger.owner, name);
    const mapText = await fetchText(`https://raw.githubusercontent.com/${ledger.owner}/${name}/HEAD/standards-map.json`);
    const verdict = classify({ ...info, mapText });
    if (verdict.action === 'target') add.push(name);
    else ask.push({ name, why: verdict.why });
  }

  for (const name of add) {
    console.log(`＋ ${name}: standards-map.json を持つので targets に足します`);
  }
  for (const { name, why } of ask) {
    console.log(`？ ${name}: ${why}`);
    console.log('     → 足しません。tools/distribution.json に人が書いてください'
      + '（配らないなら excluded に理由つきで）');
  }

  if (add.length === 0) return 0;

  const next = addTargets(ledger, add);
  /* 書く前に、台帳の決まりを自分で確かめる。壊れた台帳をコミットすると
     「配る先が 0 本」でも緑になりうる（check-distribution.test.mjs が見ている形） */
  const bad = ledgerProblems(next);
  if (bad.length) {
    console.error('❌ 足したあとの台帳に不備が出るので、書きません:');
    for (const line of bad) console.error(`  - ${line}`);
    return 1;
  }
  if (!apply) {
    console.log(`\n（--apply を付けると、${add.length} 本を tools/distribution.json に書きます）`);
    return 0;
  }
  fs.writeFileSync(LEDGER, serializeLedger(next));
  console.log(`\ntools/distribution.json に ${add.length} 本を足しました: ${add.join(', ')}`);
  return 0;
}

/* ⚠️ `file://${process.argv[1]}` を文字列で組み立てて比べないこと
   （standards/lib/cli-entry.test.mjs が字面で見張っている）。 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code))
    .catch((error) => { console.error(`❌ ${error.stack ?? error.message}`); process.exit(1); });
}
