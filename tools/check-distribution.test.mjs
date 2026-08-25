import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ledgerProblems, missingFromLedger, goneFromGitHub,
  normalized, parseSymref, namesFromRepoPage, skillsOf,
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
