#!/usr/bin/env node
/* =====================================================================
 * tools/check-outputs.mjs — 書き出し先が PATHS に並んでいるか
 * =====================================================================
 * 使い方: リポジトリのルートで `node tools/check-outputs.mjs`
 *
 * ── 何を防ぐのか ──────────────────────────────────
 *
 * 朝の組み直し（.github/workflows/sync-updates.yml）は、組み直したものの
 * うち PATHS に並べたものだけをコミットする。並べ忘れた道は、
 * **毎朝つくり直されては毎朝捨てられる。**
 *
 * そのうえ、そのあとに走る検査は「組み直したあとの新しいページ」を見るので
 * 緑のまま通る。リポジトリには古いものが残り続ける。
 * ワークフローのコメントには、この形が「目でも検査でも気づけない」と
 * 書いてあった。書いてあるのに、見張る仕掛けが無かった。
 *
 * ── 見るのは 3 つ ─────────────────────────────────
 *
 *   1. 台帳に書いた道が、すべて PATHS に覆われている
 *   2. ワークフローが走らせている道具が、すべて台帳に載っている
 *      （手順を足して台帳に書き忘れたら、ここで落ちる）
 *   3. 台帳に書いた道具が実在する
 *
 * 3 番が要るのは tools/check-lessons.mjs と同じ理由。台帳が嘘をつくと、
 * 台帳があるぶんだけ事故が見えにくくなる。
 * ===================================================================== */
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const ledger = JSON.parse(readFileSync(new URL('outputs.json', import.meta.url), 'utf8'));
const yamlPath = new URL(ledger.workflow, ROOT);

let failed = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${label}${!cond && extra !== undefined ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

ok(existsSync(yamlPath), `${ledger.workflow} がある`);
if (!existsSync(yamlPath)) { console.log('\n❌ 1 件 通りませんでした'); process.exit(1); }
const yaml = readFileSync(yamlPath, 'utf8');

/* PATHS="..." を取り出す。行の続き（\）でつながっているので、まとめて読む。
   YAML を解析しないのは、ここで見たいのが「シェルに渡る文字列そのもの」だから。 */
const raw = yaml.match(/PATHS="([\s\S]*?)"/)?.[1];
ok(!!raw, 'sync-updates.yml に PATHS= がある');
const paths = (raw ?? '').replace(/\\\s*\n/g, ' ').split(/\s+/).filter(Boolean);

console.log(`\n■ 書き出し先が PATHS に並んでいる（PATHS は ${paths.length} 個）`);

/** その道が PATHS のどれかに覆われているか。apps/ は apps/x/manual/ を覆う。 */
const covered = (target) => paths.some((p) => target === p
  || (p.endsWith('/') && target.startsWith(p)));

for (const [tool, outs] of Object.entries(ledger.tools)) {
  const missing = outs.filter((o) => !covered(o));
  ok(missing.length === 0, `${tool} の書き出し先`, `PATHS に無い → ${missing.join(', ')}`);
}

console.log('\n■ 台帳とワークフローが食い違っていない');

/* ワークフローが走らせている道具。
   ⚠️ --check や --dry-run を付けた呼び方は書き出さないので外す
      （同じ道具が、組み立てにも検査にも使われる）。 */
const run = [...yaml.matchAll(/node (tools\/[\w-]+\.mjs)([^\n]*)/g)]
  .filter(([, , rest]) => !/--check|--dry-run/.test(rest))
  .map(([, tool]) => tool);
const used = [...new Set(run)];
const checks = new Set(ledger.checks ?? []);

/* ⚠️ 名前で見分けない。check- で始まる組み立ての道具を足したときに素通りする。
   どちらの表にも無ければ落ちるので、道具を足すときに必ずどちらかを選ぶことになる。 */
const unlisted = used.filter((t) => !ledger.tools[t] && !checks.has(t));
ok(unlisted.length === 0,
   `走らせている道具 ${used.length} 本が、すべて台帳に載っている`,
   `どちらの表にも無い → ${unlisted.join(', ')}`
   + '（書き出すなら tools/outputs.json の tools に、何も書かないなら checks に足すこと）');

const gone = [...Object.keys(ledger.tools), ...(ledger.checks ?? [])]
  .filter((t) => !existsSync(new URL(t, ROOT)));
ok(gone.length === 0, '台帳に書いた道具がすべて実在する', gone.join(', '));

const idle = Object.keys(ledger.tools).filter((t) => !used.includes(t));
const idleChecks = [...checks].filter((t) => !used.includes(t) && !yaml.includes(t));
if (idleChecks.length) {
  console.log(`  info 検査だと宣言してあるが、朝の流れでは走らせていない: ${idleChecks.join(', ')}`);
}
if (idle.length) {
  console.log(`  info 台帳にあるが、朝の流れでは走らせていない: ${idle.join(', ')}`);
}

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
