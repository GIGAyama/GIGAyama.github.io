#!/usr/bin/env node
/**
 * 公開中の画面を実ブラウザで巡回し、**実際に出ていった通信**を記録する。
 *
 *   node tools/verify-runtime.mjs                 全アプリを巡回して表で出す
 *   node tools/verify-runtime.mjs --slug typa     1 本だけ
 *   node tools/verify-runtime.mjs --json          機械が読む形
 *   node tools/verify-runtime.mjs --strict        宣言と食い違ったら exit 1
 *
 * ── なぜ「本番を巡回する」形にしたのか ────────────────────
 *
 * 検査の場所は 2 つ考えられた。
 *
 *   ・各リポジトリの CI で dist/ を見る … playwright を持つのは 6 本だけ。
 *     42 本に入れるのは現実的でないし、入れても重い。
 *   ・ポータルから公開先を巡回する    … こちら。
 *
 * 後者にした理由は 3 つある。
 *   1. **児童の端末が実際に読むもの**を測るのが、この検査の目的そのもの
 *   2. ビルドを通さないので、42 本ぶんの環境を用意しなくてよい
 *   3. 測った結果が data/apps.json の hosts に返せる
 *
 * 3 が効く。`/filtering/` のページは、先生が情報担当に出す申請書そのもので、
 * いまは配布ファイルの静的解析から作った**推定**が載っている
 * （tools/lib/hosts.mjs の冒頭に、そう書いてある）。実測に変われば
 * 「塞がれて授業が止まる」「要らない申請を出す」がどちらも減る。
 *
 * ⚠️ ここは書き戻しをしない。まず「推定と実測がどれだけ違うか」を出すところまで。
 *    いきなり自動で書き替えると、巡回が 1 回こけただけで全アプリの
 *    hosts が空になる、という壊し方ができてしまう。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const VERIFIER = path.join(REPO_ROOT, 'standards/web/verify-no-external.mjs');

/** アプリの公開先。組み立て規則は tools/sync-updates.mjs と同じ */
export const liveUrl = (slug) => `https://${slug}.giga-school.com/`;

/**
 * 実測したホストと、data/apps.json の宣言を突き合わせる。
 *
 * @returns {{slug: string, measured: string[], declared: string[],
 *            onlyMeasured: string[], onlyDeclared: string[]}}
 */
export function compareHosts(slug, measured, declared) {
  const m = new Set(measured.map((h) => h.toLowerCase()));
  const d = new Set(declared.map((h) => h.toLowerCase()));
  return {
    slug,
    measured: [...m].sort(),
    declared: [...d].sort(),
    // 実測にあって宣言に無い ＝ 申請書に載っていないのに読んでいる（危ない側）
    onlyMeasured: [...m].filter((h) => !d.has(h)).sort(),
    // 宣言にあって実測に無い ＝ もう読んでいないのに申請させている（無駄な側）
    onlyDeclared: [...d].filter((h) => !m.has(h)).sort(),
  };
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

/** 1 本ぶん測る。測れなければ null（推測で埋めない） */
function measure(slug) {
  try {
    const out = execFileSync('node', [VERIFIER, '--url', liveUrl(slug), '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return JSON.parse(out).hosts ?? [];
  } catch (e) {
    /* verify-no-external は違反があると exit 1 で終わるが、--json のときは
       標準出力に結果を書いてから終わる。中身が読めるならそれを使う。 */
    const raw = e.stdout ? String(e.stdout) : '';
    try { return JSON.parse(raw).hosts ?? []; } catch { return null; }
  }
}

async function main() {
  const apps = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/apps.json'), 'utf8'));
  const only = arg('slug');
  const asJson = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');

  const items = apps.items.filter((i) => i.slug && (!only || i.slug === only));
  const rows = [];
  const unreachable = [];

  for (const item of items) {
    const measured = measure(item.slug);
    if (measured === null) { unreachable.push(item.slug); continue; }
    rows.push(compareHosts(item.slug, measured, item.hosts ?? []));
  }

  if (asJson) {
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), rows, unreachable }, null, 2));
  } else {
    const changed = rows.filter((r) => r.onlyMeasured.length || r.onlyDeclared.length);
    console.log(`実ブラウザで ${rows.length} 本を巡回しました（測れなかった: ${unreachable.length} 本）\n`);
    if (changed.length === 0) {
      console.log('✅ 推定（data/apps.json の hosts）と実測は一致しています。');
    } else {
      console.log(`⚠️  推定と実測が食い違うアプリが ${changed.length} 本あります:\n`);
      for (const r of changed) {
        console.log(`  ${r.slug}`);
        for (const h of r.onlyMeasured) console.log(`    ＋ ${h}（実際に読んでいるが、申請書に載っていない）`);
        for (const h of r.onlyDeclared) console.log(`    － ${h}（申請書に載っているが、もう読んでいない）`);
      }
      console.log('\n/filtering/ は先生が情報担当に出す申請書です。実測に合わせてください。');
    }
    if (unreachable.length) {
      console.log(`\n測れなかった: ${unreachable.join(', ')}`);
      console.log('（開けなかっただけで「外を読んでいない」ではありません。合格として数えていません）');
    }
  }

  /* ⚠️ 測れなかったものを「問題なし」に数えない。
        巡回できなかったのは、この検査が何も見ていないということ。 */
  if (strict && (rows.some((r) => r.onlyMeasured.length) || unreachable.length)) return 1;
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main().then((c) => process.exit(c));
