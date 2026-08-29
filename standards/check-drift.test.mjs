/* =====================================================================
 * check-drift のテスト
 * =====================================================================
 * このツールの値打ちは「正本と揃っている」と言い切れることにある。
 * 揃っていないのに緑を返したら、そのあとの判断が全部その嘘の上に乗る。
 *
 * 実際に digitalcloset で起きていた: standards-map.json が無いだけで
 * 「このリポジトリは正本コピーを持ちません」と言って exit 0 を返していたが、
 * scripts/lib/giga-v5-checks.mjs（正本と同じ場所・同じ名前の 304 行の別物）を
 * 現に持っていた。ここではその見落としを固定する。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  NORMALIZERS, canonicalIndex, compareDir, findLookalikes, listFiles, unregistered, unregisteredSkills,
} from './check-drift.mjs';

/** メモリ上の疑似ファイル木から readdir / statSync を作る */
function fakeFs(tree) {
  const at = (p) => {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = tree;
    for (const part of parts) node = node?.[part];
    return node;
  };
  return {
    // 実際の readdirSync は名前順に返す。並び順は結果を変える（同じ名前が
    // 複数あると先に見つけたほうを採るため）ので、ここでもそろえておく。
    readdir: (p) => Object.keys(at(p) || {}).sort(),
    stat: (p) => ({ isDirectory: () => typeof at(p) === 'object' }),
  };
}

const STANDARDS = {
  lib: { 'giga-v5-checks.mjs': '', 'giga-v5-checks.test.mjs': '', 'run-giga-checks.mjs': '' },
  // スキルの中には capture.mjs / serve.mjs のような、どこにでもある名前が入っている。
  // basename の索引に入れると、関係のないファイルが「未登録コピー」に見える
  skills: { 'note-article': { scripts: { 'serve.mjs': '', 'capture.mjs': '' } } },
  gas: { 'Gemini.gs': '', 'gas-deploy.mjs': '', 'deploy.yml': '' },
  records: { 'records-export.js': '', 'records-export.html': '' },
  // docs には読み物のほかに例示の HTML が置かれることがある。
  // 拡張子だけでは外れないので、docs/ そのものを除外できているかを見る
  docs: { 'gas-type-e.md': '', 'app-hardening.md': '', 'records-export.html': '' },
  'README.md': '',
};

// ── 正本の索引 ──────────────────────────────────────────────

test('skills/ は索引に入れない（どこにでもある名前で誤検知するため）', () => {
  // ⚠️ 2026-08-25 に実測した誤検知。note-article スキルに serve.mjs を入れたところ、
  //    KANA_Master の tools/serve.mjs が「未登録のコピー」として 4 本で出た。
  //    スキルは dirs と unregisteredSkills がパスで見るので、名前から探す必要がない
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.get('serve.mjs'), undefined);
  assert.equal(index.get('capture.mjs'), undefined);
});

test('skills/ を外しても、ほかの正本は索引に残る', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.get('giga-v5-checks.mjs'), 'lib/giga-v5-checks.mjs');
});

test('配るファイルだけを索引にする', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.get('giga-v5-checks.mjs'), 'lib/giga-v5-checks.mjs');
  assert.equal(index.get('Gemini.gs'), 'gas/Gemini.gs');
  assert.equal(index.get('records-export.html'), 'records/records-export.html');
});

test('README.md を索引に入れない（どのリポジトリにもあるので毎回引っかかる）', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  assert.equal(canonicalIndex('s', readdir, stat).has('README.md'), false);
});

test('docs/ は読み物なので配布物として数えない', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  assert.equal(index.has('gas-type-e.md'), false);
  assert.equal(index.has('app-hardening.md'), false);
});

test('docs/ の中の HTML も配布物として数えない（例示であって正本ではない）', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  const index = canonicalIndex('s', readdir, stat);
  // 同名の正本が records/ にある。docs/ 側に引っぱられていないこと
  assert.equal(index.get('records-export.html'), 'records/records-export.html');
});

test('テストファイルは配らないので手がかりにしない', () => {
  const { readdir, stat } = fakeFs({ s: STANDARDS });
  assert.equal(canonicalIndex('s', readdir, stat).has('giga-v5-checks.test.mjs'), false);
});

// ── リポジトリ側の走査 ──────────────────────────────────────

test('正本と同じ名前のファイルを、階層の深さによらず見つける', () => {
  const { readdir, stat } = fakeFs({
    s: STANDARDS,
    repo: { scripts: { lib: { 'giga-v5-checks.mjs': '' } }, 'index.html': '' },
  });
  const index = canonicalIndex('s', readdir, stat);
  assert.deepEqual(findLookalikes('repo', index, readdir, stat), [
    { local: 'scripts/lib/giga-v5-checks.mjs', canonical: 'lib/giga-v5-checks.mjs' },
  ]);
});

test('node_modules と dist は見ない（コピーではなく取り寄せたもの・生成物）', () => {
  const { readdir, stat } = fakeFs({
    s: STANDARDS,
    repo: {
      node_modules: { x: { 'Gemini.gs': '' } },
      dist: { 'records-export.js': '' },
      '.git': { 'deploy.yml': '' },
    },
  });
  const index = canonicalIndex('s', readdir, stat);
  assert.deepEqual(findLookalikes('repo', index, readdir, stat), []);
});

// ── 未登録の判定 ────────────────────────────────────────────

const found = [
  { local: 'scripts/lib/giga-v5-checks.mjs', canonical: 'lib/giga-v5-checks.mjs' },
  { local: 'scripts/gas-deploy.mjs', canonical: 'gas/gas-deploy.mjs' },
];

test('対応表に載っていれば未登録ではない', () => {
  assert.deepEqual(unregistered(found, ['scripts/lib/giga-v5-checks.mjs'], []), [found[1]]);
});

test('unmanaged に理由つきで宣言してあれば未登録ではない', () => {
  assert.deepEqual(unregistered(found, [], ['scripts/lib/giga-v5-checks.mjs']), [found[1]]);
});

test('どちらにも無ければ未登録として報告する', () => {
  // これが digitalcloset で起きていたこと。以前は「持ちません」と言って緑だった
  assert.deepEqual(unregistered(found, [], []), found);
});

test('照合するものが無くても、別物として宣言していれば「コピーが無い」とは言わない', () => {
  // digitalcloset は 304 行のフォークを unmanaged に宣言している。
  // files が空だからといって「正本のコピーは見つかりませんでした」と言うと、
  // フォークを現に持っているという事実と食い違う。
  // （この判断は check-drift.mjs の main() 側にあるので、ここでは
  //   unregistered が空になること＝宣言が効くことを固定する）
  assert.deepEqual(unregistered(found, [], found.map((f) => f.local)), []);
});

test('全部宣言してあれば何も残らない', () => {
  assert.deepEqual(
    unregistered(found, ['scripts/gas-deploy.mjs'], ['scripts/lib/giga-v5-checks.mjs']),
    []
  );
});

/* ── normalize ────────────────────────────────────────────────────────
 * 「1行だけ変えてよい」を機械で言い切るための仕組み。ここが広すぎると
 * 正本を直しても届かなくなり、狭すぎると毎回ずれとして出る。
 * どちらも「ドリフト検知が通ったから揃っている」という判断を壊す。
 * ================================================================== */

const HTML = (name, src) => `<!DOCTYPE html>
<title>学習ログの受け渡し口｜${name}</title>
<p>このページは、${name}の学習記録を集計ページへ受け渡すためのものです。</p>
<p><a href="./">← ${name}に もどる</a></p>
<script type="module" src="${src}"></script>`;

test('app-name: アプリ名の違いだけなら同じものとして扱う', () => {
  const canonical = NORMALIZERS['app-name'](HTML('__APP_NAME__', './records-export.js'));
  const local = NORMALIZERS['app-name'](HTML('九九カード', './records-export.js'));
  assert.equal(local, canonical);
});

test('app-name: 名前の入る場所しか潰さない（文言を書き替えたらずれとして出る）', () => {
  const canonical = NORMALIZERS['app-name'](HTML('__APP_NAME__', './records-export.js'));
  // 「学習記録」を別の言い方に書き替えたコピー
  const reworded = NORMALIZERS['app-name'](
    HTML('九九カード', './records-export.js').replace('の学習記録を', 'のべんきょうのきろくを'));
  assert.notEqual(reworded, canonical);
});

test('records-export-import: <script src> の置き場の違いを許す', () => {
  const canonical = NORMALIZERS['records-export-import'](HTML('x', './records-export.js'));
  const local = NORMALIZERS['records-export-import'](HTML('x', './js/records-export.js'));
  assert.equal(local, canonical);
});

test('records-export-import: 別のファイルを読みこんでいたら、ずれとして出る', () => {
  const canonical = NORMALIZERS['records-export-import'](HTML('x', './records-export.js'));
  const other = NORMALIZERS['records-export-import'](HTML('x', './records-hub-client.js'));
  assert.notEqual(other, canonical);
});

// ── ディレクトリまるごと（dirs）──────────────────────────────
//
// スキル（.claude/skills/<名前>/）は中身が増えたり減ったりする。
// files に 1 本ずつ並べる方式だと、正本にファイルを足したとき 42 本ぶんの
// 対応表を直し忘れれば黙って配られない。dirs は両方向に見るので、
// 足した瞬間に配布先ぜんぶが赤くなる。ここではその両方向を固定する。

/**
 * compareDir に渡す、メモリ上の読み手一式を作る。
 *
 * ⚠️ compareDir は local を path.resolve で絶対パスに直す（本物の挙動）。
 *    疑似ファイル木は相対の鍵で引くので、絶対パスで来たら cwd からの
 *    相対に戻してから引く。ここを合わせないと、テストのほうが
 *    「ローカルコピーがありません」しか見なくなる。
 */
function fakeDir(tree) {
  const { readdir: rd, stat: st } = fakeFs(tree);
  const rel = (p) => (path.isAbsolute(p) ? path.relative(process.cwd(), p) : p);
  const at = (p) => rel(p).replace(/\\/g, '/').split('/').filter(Boolean).reduce((n, k) => n?.[k], tree);
  return {
    readdir: (p) => rd(rel(p)),
    stat: (p) => st(rel(p)),
    exists: (p) => at(p) !== undefined,
    read: (p) => at(p),
  };
}

const SKILL = { 'SKILL.md': 'A', references: { 'style.md': 'B' } };

test('dirs: 中身がそろっていれば、ずれとして出ない', () => {
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: { note: SKILL } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.deepEqual(out, []);
});

test('dirs: 中身が1バイト違えば、ずれとして出る', () => {
  const changed = { 'SKILL.md': 'A', references: { 'style.md': 'B です' } };
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: { note: changed } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /style\.md: 正本 .* とずれています/);
});

test('dirs: 正本にあって配布先に無いファイルを「欠け」として出す', () => {
  // ⚠️ これが files 方式との違い。正本にファイルを足したとき、
  //    対応表を直さなくても配布先が赤くなる
  const missing = { 'SKILL.md': 'A', references: {} };
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: { note: missing } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /style\.md: 配布先にありません/);
});

test('dirs: 正本に無いファイルが配布先にあれば「余り」として出す', () => {
  // 正本で消したのに配布先に残っている形。消し忘れは目で気づけない
  const extra = { 'SKILL.md': 'A', references: { 'style.md': 'B', 'memo.md': 'C' } };
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: { note: extra } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /memo\.md: 正本 .* にありません（余分なファイル）/);
});

test('dirs: 隠しファイルも「余り」として数える', () => {
  // .DS_Store や .gitkeep を飛ばすと、配布先にだけあるファイルが黙って通る
  const extra = { 'SKILL.md': 'A', references: { 'style.md': 'B' }, '.DS_Store': 'x' };
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: { note: extra } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /\.DS_Store/);
});

test('dirs: 配布先にディレクトリごと無ければ、そう言う', () => {
  const deps = fakeDir({ s: { skills: { note: SKILL } }, r: { '.claude': { skills: {} } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /ローカルコピーがありません/);
});

test('dirs: 正本のほうが無ければ、対応表から外すよう言う', () => {
  const deps = fakeDir({ s: { skills: {} }, r: { '.claude': { skills: { note: SKILL } } } });
  const out = compareDir({ canonical: 'skills/note', local: '.claude/skills/note' }, 's', 'r', deps);
  assert.equal(out.length, 1);
  assert.match(out[0], /正本 standards\/skills\/note がありません/);
});

test('listFiles: 入れ子の中まで、相対パスで並べる', () => {
  const { readdir, stat } = fakeFs({ d: { a: 'x', sub: { b: 'y', deep: { c: 'z' } } } });
  assert.deepEqual(listFiles('d', readdir, stat), ['a', 'sub/b', 'sub/deep/c']);
});

// ── 対応表に書かずに置かれたスキル ───────────────────────────
//
// findLookalikes は "." で始まる名前を飛ばすので、.claude/ の中は
// 一度も歩かれない。スキルを置いたのに対応表へ書かなければ、
// 照合 0 件のまま緑になる。それを塞ぐ検査。

test('未登録のスキル: 対応表に無いものを見つける', () => {
  const { readdir, stat } = fakeFs({ r: { '.claude': { skills: { note: {}, devlog: {} } } } });
  const out = unregisteredSkills('r', ['.claude/skills/note'], [], readdir, stat);
  assert.deepEqual(out, ['.claude/skills/devlog']);
});

test('未登録のスキル: dirs に載っていれば出さない', () => {
  const { readdir, stat } = fakeFs({ r: { '.claude': { skills: { note: {} } } } });
  assert.deepEqual(unregisteredSkills('r', ['.claude/skills/note'], [], readdir, stat), []);
});

test('未登録のスキル: unmanaged に理由つきで書いてあれば出さない', () => {
  // ポータル自身は正本へのシンボリックリンクなので、この形で外してある
  const { readdir, stat } = fakeFs({ r: { '.claude': { skills: { note: {} } } } });
  assert.deepEqual(unregisteredSkills('r', [], ['.claude/skills/note'], readdir, stat), []);
});

test('未登録のスキル: 末尾の / の有無で取りちがえない', () => {
  const { readdir, stat } = fakeFs({ r: { '.claude': { skills: { note: {} } } } });
  assert.deepEqual(unregisteredSkills('r', ['.claude/skills/note/'], [], readdir, stat), []);
});

test('未登録のスキル: 置き場が無いリポジトリでは何も言わない', () => {
  const { readdir, stat } = fakeFs({ r: { src: {} } });
  assert.deepEqual(unregisteredSkills('r', [], [], readdir, stat), []);
});

/* ── Antigravity（.agents/）も同じ目で見る ──────────────────────
   2026-08-28 まで unregisteredSkills は .claude/skills しか読んでいなかった。
   .agents/skills は配布物なのに一度も照合されず、書き替えても緑のままだった。 */

test('未登録のスキル: .agents/skills も見る', () => {
  const { readdir, stat } = fakeFs({ r: { '.agents': { skills: { note: {}, rogue: {} } } } });
  const out = unregisteredSkills('r', ['.agents/skills/note'], [], readdir, stat);
  assert.deepEqual(out, ['.agents/skills/rogue']);
});

test('未登録のスキル: .claude と .agents の両方を並べて返す', () => {
  const { readdir, stat } = fakeFs({
    r: { '.claude': { skills: { note: {} } }, '.agents': { skills: { note: {} } } },
  });
  assert.deepEqual(unregisteredSkills('r', [], [], readdir, stat), [
    '.claude/skills/note', '.agents/skills/note',
  ]);
});

test('未登録のスキル: 片方だけ対応表にあっても、もう片方は出す', () => {
  // 「.claude には配ったが .agents には配っていない」を取りこぼさないため
  const { readdir, stat } = fakeFs({
    r: { '.claude': { skills: { note: {} } }, '.agents': { skills: { note: {} } } },
  });
  assert.deepEqual(
    unregisteredSkills('r', ['.claude/skills/note'], [], readdir, stat),
    ['.agents/skills/note'],
  );
});

test('未登録のスキル: 置き場に直に置かれたファイルはスキルではない', () => {
  // README.md は説明であってスキルではない。以前は数えていたので、
  // distribute.mjs が .claude/skills/README.md を消して回っていた
  const { readdir, stat } = fakeFs({
    r: { '.agents': { skills: { note: {}, 'README.md': '' } } },
  });
  assert.deepEqual(unregisteredSkills('r', ['.agents/skills/note'], [], readdir, stat), []);
});

/* ── 配ったものが本当に照合されているか（CLI を実際に起動して見る）─────
 *
 * 2026-08-29 に実測した穴の回帰試験。.agents/rules/gigaschool-standards.md は
 * 42 本へ配られていたのに、どの standards-map.json にも載っていなかった。
 * Typa で 1 行足して走らせたら「✅ 正本と一致しています」で exit 0 が返った。
 * エージェントの行動を決める文書が、書き替え放題で緑になっていた。
 *
 * 純関数の試験では、この壊れ方は捕まらない。「対応表に載っていない」が原因で、
 * 比べる処理そのものは正しく動いていたため。だから CLI を実際に起動する。 */
{
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { fileURLToPath } = await import('node:url');

  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const STANDARDS = HERE;                       // standards/ そのもの
  const CLI = path.join(HERE, 'check-drift.mjs');
  const RULES = 'agents/rules/gigaschool-standards.md';

  /** 配布先を 1 本ぶん作る。戻り値は repo ディレクトリ */
  const makeRepo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-rules-'));
    fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
    fs.copyFileSync(path.join(STANDARDS, RULES), path.join(dir, '.agents/rules/gigaschool-standards.md'));
    fs.writeFileSync(path.join(dir, 'standards-map.json'), JSON.stringify({
      files: [{ canonical: RULES, local: '.agents/rules/gigaschool-standards.md' }],
    }, null, 2) + '\n');
    return dir;
  };

  const runDrift = (cwd) => {
    try {
      execFileSync('node', [CLI, '--standards', STANDARDS], { cwd, encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (e) { return e.status ?? -1; }
  };

  test('CLI: 対応表に載せたルールファイルが正本と同じなら通る', () => {
    const dir = makeRepo();
    try { assert.equal(runDrift(dir), 0); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI: ルールファイルを 1 行書き替えたら落ちる（2026-08-29 はここが exit 0 だった）', () => {
    const dir = makeRepo();
    try {
      fs.appendFileSync(path.join(dir, '.agents/rules/gigaschool-standards.md'), '\n勝手に足した行\n');
      assert.equal(runDrift(dir), 1, 'ルールを書き替えたのに check-drift が通してしまった');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI: ルールファイルを消したら落ちる', () => {
    const dir = makeRepo();
    try {
      fs.rmSync(path.join(dir, '.agents/rules/gigaschool-standards.md'));
      assert.equal(runDrift(dir), 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
