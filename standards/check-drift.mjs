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
 *
 * ── ディレクトリまるごとを配る（dirs）──────────────────────
 * files は 1 ファイルずつ並べる。スキル（.claude/skills/<名前>/）のように
 * 中身が増えたり減ったりするものには向かない。正本にファイルを1本足したとき、
 * 42本ぶんの対応表を直し忘れれば**黙って配られない**。
 *
 *   {
 *     "dirs": [
 *       { "canonical": "skills/devlog-article", "local": ".claude/skills/devlog-article" }
 *     ]
 *   }
 *
 * dirs は両方向に見る。正本にあってローカルに無ければ「欠け」、
 * ローカルにあって正本に無ければ「余り」。だから正本にファイルを足した瞬間、
 * 配布先ぜんぶが赤くなる。
 *
 * ⚠️ files と違って normalize は無い。スキルにアプリ固有の1行は無いので、
 *    ずらしてよい場所を作らない。要るようになったら files に並べ直すこと。
 */
import fs from 'node:fs';
import path from 'node:path';

export const NORMALIZERS = {
  // APP_ID の定義行と、テストデータ内の appId 値を許す
  'app-id': (s) => s
    .replace(/(APP_ID\s*=\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'")
    .replace(/(appId:\s*)['"][^'"]*['"]/g, "$1'__APP_ID__'"),
  // records-export.js の置き場（js/ か public/ か）の違いを許す。
  // テストの import と、records-export.html の <script src> の両方に効く。
  'records-export-import': (s) => s
    .replace(/from\s+['"][^'"]*records-export\.js['"]/g, "from '__RECORDS_EXPORT_PATH__'")
    .replace(/src=['"][^'"]*records-export\.js['"]/g, "src='__RECORDS_EXPORT_PATH__'"),
  // records-export.html に出るアプリの表示名を許す。
  //
  // 名前の入る場所だけを潰す。文言そのものは照合に残すので、たとえば
  // 「学習記録」を別の言い方に書き替えたら、そこはちゃんとずれとして出る。
  // 見出しごと '.*' で消してしまうと、正本の文言を直しても届かなくなる。
  'app-name': (s) => s
    .replace(/(<title>学習ログの受け渡し口｜)[^<]*(<\/title>)/g, '$1__APP_NAME__$2')
    .replace(/(このページは、)[^、]*?(の学習記録を)/g, '$1__APP_NAME__$2')
    .replace(/(← )[^<]*?(に もどる)/g, '$1__APP_NAME__$2'),
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
        /* ⚠️ standards/skills/ も索引に入れない。ここは basename の索引で、
           スキルの中には capture.mjs や serve.mjs のような、どこにでもある名前が
           入っている。索引に入れると KANA_Master の tools/serve.mjs が
           「note-article スキルの未登録コピー」に見える（2026-08-25 に 4 本で実測）。
           スキルは dirs と unregisteredSkills が**パスで**見ているので、
           ここで名前から探す必要がない。docs/ と同じ理由で外す。 */
        if (!rel && name === 'skills') continue;
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
 * ディレクトリの中のファイルを、相対パスで並べる。
 *
 * ⚠️ 隠しファイルも数える。配布先にだけ置かれた .DS_Store や .gitkeep は
 *    正本に無いので「余り」として出したい。ここで飛ばすと黙って通る。
 */
export function listFiles(dir, readdir = fs.readdirSync, stat = fs.statSync) {
  const out = [];
  const walk = (abs, rel) => {
    let names;
    try { names = readdir(abs); } catch { return; }
    for (const name of names) {
      const full = path.join(abs, name);
      const relPath = rel ? path.posix.join(rel, name) : name;
      if (stat(full).isDirectory()) walk(full, relPath);
      else out.push(relPath);
    }
  };
  walk(dir, '');
  return out.sort();
}

/**
 * dirs の 1 件を突き合わせる。ずれの説明の配列を返す（空なら一致）。
 *
 * 正本にあってローカルに無い → 欠け（配り忘れ）
 * ローカルにあって正本に無い → 余り（正本で消したのに配布先に残っている）
 * 中身が違う                 → ずれ
 */
export function compareDir({ canonical, local }, standardsDir, repoDir, deps = {}) {
  const { read = fs.readFileSync, exists = fs.existsSync, readdir, stat } = deps;
  const ls = (d) => listFiles(d, readdir ?? fs.readdirSync, stat ?? fs.statSync);
  const cAbs = path.join(standardsDir, canonical);
  const lAbs = path.resolve(repoDir, local);
  if (!exists(cAbs)) return [`${local}: 正本 standards/${canonical} がありません（正本で消したのなら、対応表からも外してください）`];
  if (!exists(lAbs)) return [`${local}: ローカルコピーがありません（standards/${canonical} をまるごとコピーしてください）`];

  const here = ls(cAbs);
  const there = new Set(ls(lAbs));
  const problems = [];
  for (const f of here) {
    if (!there.has(f)) { problems.push(`${local}/${f}: 配布先にありません（正本 standards/${canonical}/${f}）`); continue; }
    if (read(path.join(cAbs, f), 'utf8') !== read(path.join(lAbs, f), 'utf8')) {
      problems.push(`${local}/${f}: 正本 standards/${canonical}/${f} とずれています`);
    }
  }
  const hereSet = new Set(here);
  for (const f of there) {
    if (!hereSet.has(f)) problems.push(`${local}/${f}: 正本 standards/${canonical}/ にありません（余分なファイル）`);
  }
  return problems;
}

/**
 * スキルの置き場。エージェントごとに読む場所が違うので、両方を見る。
 *
 * ⚠️ .agents/ を足し忘れると、そちらは一度も照合されない。2026-08-28 に実測した:
 *    .agents/skills/note-article/SKILL.md を書き替えても、
 *    .agents/skills/ に見知らぬスキルを置いても、check-drift は緑のままだった。
 *    同じ壊し方を .claude/ で行えば赤くなる。つまり「配ったものの半分を
 *    誰も見ていない」状態で「正本と一致しています」と言っていた。
 */
export const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];

/**
 * 対応表に載っていないスキルを探す。
 *
 * ⚠️ findLookalikes は "." で始まる名前を飛ばす（.git や .github まで歩かないため）。
 *    つまり .claude/ と .agents/ の中は一度も見ていない。スキルを置いたのに
 *    対応表へ書かなければ、照合 0 件のまま緑になる。
 *    「見ていない」を「きれい」と読ませないための検査。
 *
 * ⚠️ basename の索引（canonicalIndex）は使わない。スキルの中身はほとんど .md で、
 *    あれに .md を足すと README.md がどのリポジトリでも当たる。ここはパスで見る。
 *
 * ⚠️ スキルは必ずディレクトリ。置き場に直に置かれたファイル（README.md など）は
 *    スキルではないので数えない。以前は数えていたので、distribute.mjs が
 *    .claude/skills/README.md をわざわざ消して回っていた。原因のほうを直す。
 */
export function unregisteredSkills(
  repoDir, registeredLocals, unmanagedLocals, readdir = fs.readdirSync, stat = fs.statSync,
) {
  const trim = (l) => String(l).replace(/\/+$/, '');
  const known = new Set([...registeredLocals, ...unmanagedLocals].map(trim));
  const out = [];
  for (const root of SKILL_ROOTS) {
    let names;
    try { names = readdir(path.join(repoDir, ...root.split('/'))); } catch { continue; }
    for (const name of names) {
      // スキルはディレクトリだけ。判定できないときは従来どおりスキル扱いにして、
      // 「見落とすより余計に言う」側へ倒す。
      let isDir = true;
      try { isDir = stat(path.join(repoDir, ...root.split('/'), name)).isDirectory(); } catch { /* 判定不能 */ }
      if (!isDir) continue;
      const local = `${root}/${name}`;
      if (!known.has(local)) out.push(local);
    }
  }
  return out;
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
  const dirEntries = Array.isArray(map.dirs) ? map.dirs : [];
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

  // ディレクトリまるごと（スキルなど）。欠け・余り・ずれを両方向に見る
  for (const entry of dirEntries) {
    drifted.push(...compareDir(entry, standardsDir, repoDir));
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

  /* 対応表に書かずに置かれたスキル。ポータルも見る。
     ⚠️ ポータルの .claude/skills/ と .agents/skills/ は正本へのシンボリックリンクなので、
        dirs に書かなくてよいように unmanaged で宣言してある。
        「見ていない」ではなく「見たうえで外してある」に寄せる。 */
  const looseSkills = unregisteredSkills(
    repoDir,
    dirEntries.map((e) => e.local),
    unmanagedList.map((u) => u.local)
  );

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

  /* ⚠️ ここは strays と違って、はじめから赤くする。
     未登録のコピー（strays）は 2026-08-22 の時点で各リポジトリに散らばっていたので
     段階的に締める必要があったが、スキルは今回まとめて配る。
     はじめから締めておかないと、締めるきっかけが二度と来ない。 */
  if (looseSkills.length) {
    console.error(`❌ 対応表に無いスキルが ${looseSkills.length} 件あります:`);
    for (const l of looseSkills) console.error('  - ' + l);
    console.error('');
    console.error('照合されていないので、正本を直してもここには届きません。次のどちらかを行ってください:');
    console.error('  ・正本のコピーなら standards-map.json の dirs に足す');
    console.error('      { "canonical": "skills/<名前>", "local": ".claude/skills/<名前>" }');
    console.error('      { "canonical": "skills/<名前>", "local": ".agents/skills/<名前>" }');
    console.error('  ・意図して別物を持っているなら unmanaged に理由つきで書く');
  }

  if (drifted.length || looseSkills.length || (strict && strays.length)) process.exit(1);

  const declared = unmanagedList.length ? `、別物として宣言 ${unmanagedList.length} 件` : '';
  const dirCount = dirEntries.reduce(
    (n, e) => n + listFiles(path.join(standardsDir, e.canonical)).length, 0);
  const withDirs = dirEntries.length
    ? `${entries.length + dirCount} ファイル（うちスキル ${dirEntries.length} 組 ${dirCount} ファイル）`
    : `${entries.length} ファイル`;
  if (entries.length > 0 || dirEntries.length > 0) {
    console.log(`✅ 正本と一致しています（${withDirs}${declared}）`);
  } else if (unmanagedList.length > 0) {
    // 照合するものは無いが、別物を持っていることは宣言してある。
    // 「コピーは見つかりませんでした」と言うと事実と食い違う。
    console.log(`[drift] 照合するコピーはありません（別物として宣言 ${unmanagedList.length} 件）`);
  } else if (strays.length === 0) {
    console.log('[drift] 正本のコピーは見つかりませんでした（対応表も同名ファイルも無し）');
  }
}

// 直接起動されたときだけ動かす
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]).endsWith('check-drift.mjs');
if (invokedDirectly) main();
