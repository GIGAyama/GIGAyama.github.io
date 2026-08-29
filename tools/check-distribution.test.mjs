import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ledgerProblems, missingFromLedger, goneFromGitHub,
  normalized, parseSymref, namesFromRepoPage, skillsOf,
  agentContextProblems, agentContextNeedsBody, RULES_IMPORT_LINE,
} from './check-distribution.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/distribution.json'), 'utf8'));

test('いま置いてある台帳そのものに不備がない', () => {
  assert.deepEqual(ledgerProblems(ledger), []);
});

test('理由の無い除外は通さない', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'b' }] });
  assert.ok(problems.some((p) => p.includes('b: excluded に理由')), problems.join('\n'));
});

test('空白だけの理由も理由として認めない', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'b', reason: '   ' }] });
  assert.ok(problems.some((p) => p.includes('b: excluded に理由')), problems.join('\n'));
});

test('配る先が空の台帳は通さない（1本も見ずに緑になるため）', () => {
  const problems = ledgerProblems({ owner: 'x', targets: [], excluded: [] });
  assert.ok(problems.some((p) => p.includes('targets が空')), problems.join('\n'));
});

test('同じリポジトリを2回書いたら気づく', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['a'], excluded: [{ repo: 'a', reason: 'なぜか' }] });
  assert.ok(problems.some((p) => p.includes('2回')), problems.join('\n'));
});

test('台帳に無いリポジトリを見つける。ポータル自身は除く', () => {
  const found = missingFromLedger(['Typa', 'GIGAyama.github.io', 'newcomer'], ledger);
  assert.deepEqual(found, ['newcomer']);
});

test('除外に書いてあれば「台帳に無い」とは言わない', () => {
  assert.deepEqual(missingFromLedger(['Werewolf'], ledger), []);
});

test('台帳にあるのに GitHub に無いものを見つける', () => {
  const gone = goneFromGitHub(['typa'], { targets: ['typa', 'kesareta'], excluded: [{ repo: 'werewolf', reason: 'r' }] });
  assert.deepEqual(gone.sort(), ['kesareta', 'werewolf']);
});

test('normalize は APP_ID の行だけを潰し、他は残す', () => {
  const before = "const APP_ID = 'typa';\nconst NAME = 'typa';\n";
  const after = normalized(before, ['app-id']);
  assert.equal(after, "const APP_ID = '__APP_ID__';\nconst NAME = 'typa';\n");
});

test('知らない normalize は黙って素通りさせない', () => {
  assert.throws(() => normalized('x', ['そんな正規化はない']), /未知の normalize/);
});

test('ls-remote の出力から既定ブランチと SHA を読む', () => {
  const out = 'ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n';
  assert.deepEqual(parseSymref(out), { ref: 'refs/heads/main', sha: '0123456789abcdef0123456789abcdef01234567' });
});

test('ls-remote が空を返したら投げる（空を「異常なし」と読まない）', () => {
  assert.throws(() => parseSymref(''), /読めませんでした/);
});

test('リポジトリ一覧が配列でなければ投げる（API のエラー本文を名前として扱わない）', () => {
  assert.throws(() => namesFromRepoPage({ message: 'Not Found' }), /配列ではありません/);
  assert.deepEqual(namesFromRepoPage([{ name: 'a' }, { name: 'b' }]), ['a', 'b']);
});

test('大文字小文字の違いは同じリポジトリとして扱う（GitHub がそうだから）', () => {
  const led = { self: 'GIGAyama.github.io', targets: ['Typa'], excluded: [{ repo: 'Werewolf', reason: 'r' }] };
  assert.deepEqual(missingFromLedger(['typa', 'werewolf', 'gigayama.github.io'], led), []);
  assert.deepEqual(goneFromGitHub(['typa', 'werewolf'], led), []);
});

test('大文字小文字だけ違う2つを台帳に書いたら、2回書いたと言う', () => {
  const problems = ledgerProblems({ owner: 'x', targets: ['Typa', 'typa'], excluded: [] });
  assert.ok(problems.some((p) => p.includes('2回')), problems.join('\n'));
});

// ── スキルの軸 ───────────────────────────────────────────────
//
// 台帳は軸を2つ持つ。targets はコードの正本（ゲート・SW・受け渡し口）を配る先、
// skills.extra はコードは配らないがスキルは配る先。
// excluded の理由はどれも「正本のコピーを1つも持たない」で、これはコードの話。
// 開発はどのリポジトリでも起きるので、スキルはそちらにも配る。

test('skillsOf: skills が無い台帳でも空で返す（落ちない）', () => {
  assert.deepEqual(skillsOf({}), { required: [], extra: [] });
});

test('skillsOf: required と extra を取り出す', () => {
  const got = skillsOf({ skills: { required: ['note-article'], extra: ['Werewolf'] } });
  assert.deepEqual(got, { required: ['note-article'], extra: ['Werewolf'] });
});

test('excluded と skills.extra の両方に載っているのは、二重登録ではない', () => {
  // ⚠️ ここを二重登録として弾くと、スキルだけ配る形が台帳に書けなくなる
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'],
    excluded: [{ repo: 'Werewolf', reason: 'コードの正本を持たない' }],
    skills: { required: [], extra: ['Werewolf'] },
  };
  assert.deepEqual(ledgerProblems(ledger), []);
});

test('targets にあるものを skills.extra に書いたら言う', () => {
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'], excluded: [],
    skills: { required: [], extra: ['Typa'] },
  };
  assert.match(ledgerProblems(ledger).join('\n'), /Typa: targets にあるので/);
});

test('台帳のどこにも無いものを skills.extra に書いたら言う', () => {
  // 書き忘れると、GitHub との突き合わせ（missingFromLedger）からこぼれる
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'], excluded: [],
    skills: { required: [], extra: ['Nazo'] },
  };
  assert.match(ledgerProblems(ledger).join('\n'), /Nazo: skills\.extra にありますが/);
});

test('required に書いたスキルが正本に無ければ言う', () => {
  // 綴り違いを、配布先ぜんぶの「まだ配っていません」で気づくのは遅い
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'], excluded: [],
    skills: { required: ['devlog-artcile'], extra: [] },
  };
  const out = ledgerProblems(ledger, ['devlog-article', 'note-article']).join('\n');
  assert.match(out, /devlog-artcile が正本/);
});

test('required が正本にそろっていれば、何も言わない', () => {
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'], excluded: [],
    skills: { required: ['devlog-article'], extra: [] },
  };
  assert.deepEqual(ledgerProblems(ledger, ['devlog-article', 'note-article']), []);
});

test('正本の一覧を渡さなければ、名前の確認はしない（純粋な台帳の検査として使える）', () => {
  const ledger = {
    owner: 'GIGAyama', targets: ['Typa'], excluded: [],
    skills: { required: ['なんでも'], extra: [] },
  };
  assert.deepEqual(ledgerProblems(ledger), []);
});

test('実際の台帳を、正本にあるスキル名と突き合わせても不備が無い', () => {
  const skills = fs.readdirSync(path.join(REPO_ROOT, 'standards/skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(ledgerProblems(ledger, skills), []);
  // スキルは 42 本に配る（targets 32 ＋ skills.extra 10）
  assert.equal(ledger.targets.length + skillsOf(ledger).extra.length, 42);
});

/* ── エージェントの常時ルールが照合の対象になっているか ──────────────
 *
 * 2026-08-29 に実測した穴の回帰試験。.agents/rules/gigaschool-standards.md は
 * 42 本へ配られていたのに、どの standards-map.json にも載っていなかった。
 * 載っていないものは誰も見ないので、書き替えても緑のまま通る。 */

test('ルールファイルが対応表に無ければ落ちる（配ってはいるが無検査）', () => {
  const problems = agentContextProblems({ files: [], unmanaged: [{ local: 'CLAUDE.md' }] }, 'x\n@.agents/rules/gigaschool-standards.md\n');
  assert.ok(
    problems.some((p) => p.includes('.agents/rules/gigaschool-standards.md') && p.includes('照合されていない')),
    problems.join('\n'),
  );
});

test('ルールファイルが files に載っていれば通る', () => {
  const map = {
    files: [
      { canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' },
      { canonical: 'agents/CLAUDE.md', local: 'CLAUDE.md' },
    ],
  };
  assert.deepEqual(agentContextProblems(map, undefined), []);
});

test('CLAUDE.md が対応表にも unmanaged にも無ければ落ちる', () => {
  const map = { files: [{ canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' }] };
  const problems = agentContextProblems(map, undefined);
  assert.ok(problems.some((p) => p.startsWith('CLAUDE.md:')), problems.join('\n'));
});

test('独自の CLAUDE.md でも、取りこみ 1 行が無ければ落ちる', () => {
  const map = {
    files: [{ canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' }],
    unmanaged: [{ local: 'CLAUDE.md', reason: 'このアプリ固有の手引き' }],
  };
  const problems = agentContextProblems(map, '# 独自の手引き\n\nルールは書いていない\n');
  assert.ok(problems.some((p) => p.includes('取りこみの行')), problems.join('\n'));
});

test('独自の CLAUDE.md でも、取りこみ 1 行が在れば通る', () => {
  const map = {
    files: [{ canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' }],
    unmanaged: [{ local: 'CLAUDE.md', reason: 'このアプリ固有の手引き' }],
  };
  assert.deepEqual(
    agentContextProblems(map, `# 手引き\n\n${RULES_IMPORT_LINE}\n\n## このアプリのこと\n`),
    [],
  );
});

test('宣言はあるのにファイルが無ければ落ちる', () => {
  const map = {
    files: [{ canonical: 'agents/rules/gigaschool-standards.md', local: '.agents/rules/gigaschool-standards.md' }],
    unmanaged: [{ local: 'CLAUDE.md', reason: '独自' }],
  };
  const problems = agentContextProblems(map, null);
  assert.ok(problems.some((p) => p.includes('ファイルがありません')), problems.join('\n'));
});

test('本文を取りにいく必要があるのは、独自の中身を宣言したときだけ', () => {
  assert.equal(agentContextNeedsBody({ unmanaged: [{ local: 'CLAUDE.md' }] }), true);
  assert.equal(agentContextNeedsBody({ files: [{ local: 'CLAUDE.md' }] }), false);
  assert.equal(agentContextNeedsBody({}), false);
});

test('正本の CLAUDE.md 自身に、取りこみの 1 行が在る', () => {
  const canonical = fs.readFileSync(path.join(REPO_ROOT, 'standards/agents/CLAUDE.md'), 'utf8');
  assert.ok(canonical.includes(RULES_IMPORT_LINE), '正本から取りこみ行が消えている');
});

/* ── ワークフローの起動条件 ─────────────────────────────
 *
 * 2026-08-29 の回帰試験。check-distribution は push で起動していたが、
 * auto-distribute も同じ push で起動するため、2 つが同時に走って
 * **検査のほうが必ず先に終わっていた**（#104 で 検査 04:15 / 配布 04:20）。
 * 配る前の艦隊を見るので毎回かならず赤くなり、2026-08-27 以降ほぼ全部の
 * マージが赤かった。毎回赤い検査は、赤いことに意味が無くなる。
 */

const wf = (name) => fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', name), 'utf8');

/* ⚠️ YAML を解析しない（Node に解析器が無く、依存を足さない方針のため）。
      見たいのは「その行が在るか」だけなので文字列で足りる。 */
const triggerBlock = (text) => text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));

test('配布のとりのこしは push で起動しない（配布と競走して必ず負ける）', () => {
  const on = triggerBlock(wf('check-distribution.yml'));
  assert.ok(!/^\s*push:/m.test(on),
    'push で起動すると auto-distribute と同時に走り、配る前の艦隊を見て毎回赤くなる');
});

test('配布のとりのこしは、配布が終わってから起動する', () => {
  const on = triggerBlock(wf('check-distribution.yml'));
  assert.ok(on.includes('workflow_run'), 'workflow_run で配布の完了を待つこと');
  assert.ok(on.includes('types: [completed]'),
    '成功でも失敗でも見る（配布が落ちた日ほど、何が配られていないかを知りたい）');
});

test('workflow_run が指す名前が、配布ワークフローの name と一致する', () => {
  /* ⚠️ ここがこの形のいちばん弱いところ。workflow_run は**表示名**で相手を
        指すので、auto-distribute の name: を変えると、check-distribution は
        二度と起動しないのに誰も気づかない（エラーも警告も出ない）。
        名前を変えたらここで落ちるようにしておく。 */
  const distributeName = (wf('auto-distribute.yml').match(/^name:\s*(.+)$/m) ?? [])[1]?.trim();
  assert.ok(distributeName, 'auto-distribute.yml に name: がありません');
  const on = triggerBlock(wf('check-distribution.yml'));
  assert.ok(on.includes(distributeName),
    `workflow_run が「${distributeName}」を指していません（名前を変えたら、こちらも直すこと）`);
});

test('毎朝の巡回は残す（配布以外の理由で生まれたずれを拾う唯一の口）', () => {
  assert.ok(triggerBlock(wf('check-distribution.yml')).includes('schedule'));
});
