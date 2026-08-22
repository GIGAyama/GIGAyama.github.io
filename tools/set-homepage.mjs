#!/usr/bin/env node
/* =====================================================================
 * tools/set-homepage.mjs — GitHub の homepage 欄を新アドレスへ揃える
 * =====================================================================
 * 使い方:
 *   node tools/set-homepage.mjs                  何に直すか見るだけ（既定）
 *   node tools/set-homepage.mjs --repo Reversi   1 つだけ見る／直す
 *   GITHUB_TOKEN=xxx node tools/set-homepage.mjs --apply   実際に直す
 *
 * なぜ要るか
 * ----------
 * 各リポジトリの homepage 欄が、旧アドレス
 * （gigayama.github.io/<リポジトリ名>/）のまま残っている（2026-08 時点で 34 本）。
 * homepage は GitHub のリポジトリ画面と、検索結果・トピックページのカードに出る。
 * トピックを付けて人が来るようになったところで、その行き先が旧アドレスなのは惜しい。
 *
 * 旧アドレスは 404.html が転送するので大半は生きているが、ひとつ例外がある。
 * Reversi は「gigayama.github.io/リバーシ/」を指していて、そんなパスは無いうえ、
 * 404.html の SAFE_SLUG（^[a-z0-9][a-z0-9-]*$）にも通らないため転送もされない。
 * これはただのリンク切れだった。
 *
 * 行き先の決め方
 * --------------
 * data/apps.json の slug から機械的に決まる。トピックと違って手書きの表は要らない。
 * アプリが増えても、apps.json に 1 行足せばここも自動でついてくる。
 *
 * トークンについて
 * ----------------
 * Administration: write（classic なら repo）の権限が要る。トピックのときと同じもの。
 * このスクリプトは環境変数からしか読まない。引数に書かないこと
 * （シェルの履歴と ps に残る）。
 *
 * PATCH は冪等なので、途中で止まっても、もう一度まるごと流して構わない。
 * ===================================================================== */

import { readFileSync } from 'node:fs';

const OWNER = 'GIGAyama';
const SITE = 'https://giga-school.com/';

/* サブドメインを持たないもの。触らない。
   どちらも Chrome 拡張機能で、index.html の #tools でも GitHub リポジトリ自身へ
   リンクしている。リポジトリの homepage をそのリポジトリに向けても意味がない。 */
const NO_SUBDOMAIN = new Set(['app_launcher', 'Blackboard_Timer']);

const data = JSON.parse(readFileSync(new URL('../data/apps.json', import.meta.url), 'utf8'));

/** そのリポジトリの homepage はどこを指すべきか。触らないものは null。 */
function homepageOf(repo, slug) {
  if (repo === 'GIGAyama.github.io') return SITE;
  if (NO_SUBDOMAIN.has(repo) || !slug) return null;
  return `https://${slug}.giga-school.com/`;
}

/* hidden のものも対象に入れる。README のとおり hidden は「サイトから外す」だけで、
   サブドメイン自体は生きているため。 */
const targets = [
  ...data.items.map((i) => ({ repo: i.repo, want: homepageOf(i.repo, i.slug) })),
  { repo: 'GIGAyama.github.io', want: SITE },
];

async function patch(repo, homepage) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ homepage }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).homepage;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;

if (apply && !process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN が要ります（Administration: write）。引数ではなく環境変数で渡してください。');
  process.exit(1);
}

const picked = targets.filter((t) => !only || t.repo === only);
if (only && !picked.length) {
  console.error(`一覧に無いリポジトリです: ${only}`);
  process.exit(1);
}

const skip = picked.filter((t) => !t.want);
const work = picked.filter((t) => t.want);

if (skip.length) {
  console.log(`■ 触らない（サブドメインを持たない）: ${skip.length} 本`);
  for (const t of skip) console.log(`  −  ${t.repo}`);
  console.log('');
}

if (!work.length) {
  console.log('直すものはありません。');
  process.exit(0);
}

console.log(apply ? `■ ${work.length} リポジトリを直します` : `■ ${work.length} リポジトリ（見るだけ。直すには --apply）`);

let failed = 0;
for (const { repo, want } of work) {
  if (!apply) { console.log(`  ${repo}\n    → ${want}`); continue; }
  try {
    const got = await patch(repo, want);
    console.log(`  ${got === want ? '✅' : '⚠️'} ${repo} → ${got}`);
  } catch (e) {
    console.error(`  ❌ ${repo}: ${e.message}`);
    failed++;
  }
}

if (failed) { console.error(`\n${failed} 件 直せませんでした`); process.exit(1); }
console.log(apply ? '\n✅ 直し終わりました' : '\n直すには GITHUB_TOKEN=… node tools/set-homepage.mjs --apply');
