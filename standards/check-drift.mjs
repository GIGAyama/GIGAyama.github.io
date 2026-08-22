#!/usr/bin/env node
/**
 * 正本（standards/）とのずれ検知。
 *
 *   node check-drift.mjs --standards <standardsディレクトリ> [--strict]
 *
 * 実行するリポジトリの直下にある standards-map.json を読み、
 * 正本とローカルコピーを照合する。ずれていたら一覧を出して落ちる。
 *
 * アプリ固有の値（APP_ID など）は normalize で両側をプレースホルダーに
 * そろえてから比べる。「1行だけ変えてよい」を機械で言い切るための仕組み。
 *
 * ── 対応表に載っていないコピーも探す ──────────────────────────
 * 以前はこのツール、standards-map.json が無いだけで
 *
 *   [drift] standards-map.json が無いので照合するものがありません
 *           （このリポジトリは正本コピーを持ちません）
 *
 * と言って exit 0 を返していた。ところが digitalcloset は
 * scripts/lib/giga-v5-checks.mjs（正本と同じ場所・同じ名前の 304 行の別物）を
 * 現に持っている。ツールの文言そのものが事実と食い違ったまま緑になり、
 * 「ドリフト検知を通ったから正本と揃っている」という判断が嘘になっていた。
 *
 * そこで、正本と同じ名前のファイルがリポジトリにあるのに対応表へ載って
 * いなければ、それを「未登録」として必ず報告する。意図的に別物を持って
 * いるなら standards-map.json の unmanaged に理由つきで書くこと。
 *
 *   {
 *     "files": [ ... ],
 *     "unmanaged": [
 *       { "local": "scripts/lib/giga-v5-checks.mjs",
 *         "reason": "v4世代のフォーク。正本移行は未実施（2026-08-22）" }
 *     ]
 *   }
 *
 * 既定では未登録は報告するだけで exit 0（全リポジトリを一度に赤くしても
 * 直せないため）。宣言を済ませたリポジトリから --strict を付けていく。
 */
import fs from 'node:fs';
import path from 'node:path';

const NORMALIZERS = {
  // APP_ID の定義行と、テストデータ内の appId 値を許す
  'app-id': (s) => s
    .replace(/(APP_ID\s*=\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'")
    .replace(/(appId:\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'"),
  // records-export.js の置き場（js/ か public/ か）の違いを許す
  'records-export-import': (s) => s
    .replace(/from\s+['"][^'"]*records-export\.js['"]/g, "from '__RECORDS_EXPORT_PATH__'"),
};

/** 走査から外す置き場。生成物と取り寄せたものは「コピー」ではない */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.standards-src', 'vendor',
]);

/**
 * 配るファイルの拡張子。文書（.md）は各リポジトリへコピーしないので入れない。
 * 入れると、どのリポジトリにもある README.md が毎回引っかかる。
 */
const DISTRIBUTED_EXT = new Set(['.mjs', '.js', '.gs', '.yml', '.yaml', '.html', '.json']);

/** 正本にあるファイルの basename → 正本内の相対パス */
export function canonicalIndex(standardsDir, readdir = fs.readdirSync, stat = fs.statSync) {
  const index = new Map();
  const walk = (dir, rel) => {
    for (const name of readdir(dir)) {
      const full = path.join(dir, name);
      const relPath = rel ? path.posix.join(rel, name) : name;
      if (stat(full).isDirectory()) {
        // standards/docs/ は読み物であって配布物ではない
        if (!rel && name === 'docs') continue;
        walk(full, relPath);
        continue;
      }
      // テストは配らないので、コピーの手がかりにしない
      if (name.endsWith('.test.mjs')) continue;
      if (!DISTRIBUTED_EXT.has(path.extname(name))) continue;
      if (!index.has(name)) index.set(name, relPath);
    }
  };
  walk(standardsDir, '');
  return index;
}

/** リポジトリの中から、正本と同じ名前のファイルを探す */
export function findLookalikes(repoDir, index, readdir = fs.readdirSync, stat = fs.statSync) {
  const found = [];
  const walk = (dir, rel) => {
    for (const name of readdir(dir)) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const relPath = rel ? path.posix.join(rel, name) : name;
      if (stat(full).isDirectory()) { walk(full, relPath); continue; }
      if (index.has(name)) found.push({ local: relPath, canonical: index.get(name) });
    }
  };
  walk(repoDir, '');
  return found;
}

/**
 * 見つかったコピーのうち、対応表にも unmanaged にも載っていないものを返す。
 * @returns {Array<{local: string, canonical: string}>}
 */
export function unregistered(lookalikes, registeredLocals, unmanagedLocals) {
  const known = new Set([...registeredLocals, ...unmanagedLocals]);
  return lookalikes.filter((f) => !known.has(f.local));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/**
 * 実行本体。テストから読み込むときは走らせない
 * （純関数だけを取り出せるように）。
 */
function main() {
  const standardsDir = arg('--standards');
  if (!standardsDir) {
    console.error('使い方: node check-drift.mjs --standards <standardsディレクトリ>');
    process.exit(2);
  }

  const strict = process.argv.includes('--strict');
  const repoDir = process.cwd();

  const mapPath = path.resolve('standards-map.json');
  const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
  const entries = Array.isArray(map.files) ? map.files : [];
  const unmanagedList = Array.isArray(map.unmanaged) ? map.unmanaged : [];

  const drifted = [];
  for (const { canonical, local, normalize = [] } of entries) {
    const cPath = path.join(standardsDir, canonical);
    const lPath = path.resolve(local);
    if (!fs.existsSync(cPath)) { drifted.push(`${local}: 正本 ${canonical} が standards/ にありません`); continue; }
    if (!fs.existsSync(lPath)) { drifted.push(`${local}: ローカルコピーがありません（standards/${canonical} からコピーしてください）`); continue; }
    let c = fs.readFileSync(cPath, 'utf8');
    let l = fs.readFileSync(lPath, 'utf8');
    for (const n of normalize) {
      const fn = NORMALIZERS[n];
      if (!fn) { drifted.push(`${local}: 未知の normalize "${n}"`); continue; }
      c = fn(c); l = fn(l);
    }
    if (c !== l) drifted.push(`${local}: 正本 standards/${canonical} とずれています`);
  }

  // 対応表に載っていないコピーを探す。
  // 正本そのものを持つリポジトリ（ポータル）は、standards/ の中身が原本なので対象外。
  const standardsInsideRepo = path.resolve(standardsDir).startsWith(repoDir + path.sep);
  let strays = [];
  if (!standardsInsideRepo) {
    const index = canonicalIndex(path.resolve(standardsDir));
    strays = unregistered(
      findLookalikes(repoDir, index),
      entries.map((e) => e.local),
      unmanagedList.map((u) => u.local)
    );
  }

  if (drifted.length) {
    console.error('❌ 正本とのずれを検知しました:');
    for (const d of drifted) console.error('  - ' + d);
    console.error('');
    console.error('直し方: 正本（GIGAyama.github.io/standards/）を先に直してから各リポジトリへコピーします。');
    console.error('このリポジトリ側だけを直すと、他のコピーにその修正が届きません。');
  }

  if (strays.length) {
    const say = strict ? console.error : console.log;
    say(`${strict ? '❌' : '⚠️ '} 正本と同じ名前のファイルが ${strays.length} 件、対応表にありません:`);
    for (const f of strays) say(`  - ${f.local}（正本 standards/${f.canonical}）`);
    say('');
    say('照合されていないので、正本を直してもここには届きません。次のどちらかを行ってください:');
    say('  ・正本のコピーなら standards-map.json の files に足す');
    say('  ・意図して別物を持っているなら unmanaged に理由つきで書く');
    say('      { "local": "…", "reason": "…（いつ・なぜ）" }');
  }

  if (drifted.length || (strict && strays.length)) process.exit(1);

  if (entries.length === 0 && strays.length === 0) {
    console.log('[drift] 正本のコピーは見つかりませんでした（対応表も同名ファイルも無し）');
  } else if (entries.length > 0) {
    const declared = unmanagedList.length ? `、別物として宣言 ${unmanagedList.length} 件` : '';
    console.log(`✅ 正本と一致しています（${entries.length} ファイル${declared}）`);
  }
}

// 直接起動されたときだけ動かす
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]).endsWith('check-drift.mjs');
if (invokedDirectly) main();
