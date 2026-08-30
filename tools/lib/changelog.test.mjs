/**
 * 更新の記録のテスト。
 *
 * 書いていないアプリに何かが出たり、書いたのに出なかったりすると、
 * 31 本ぶんを目で確かめることになる。ここで押さえておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHANGE_DAYS, CHANGE_ITEMS, PER_APP_DAY,
  changelogSection, changesFeed, changesOf, latestChanges,
} from './changelog.mjs';

const MD = `# 更新の記録

このアプリの、使う人から見た変化を書いています。

## 2026-08-23
- 写真の上限をなくしました
- 音が出ない端末があったのを直しました

## 2026-06-01

## 2026-05-10
* はじめて公開しました
`;

test('日付ごとに、箇条書きを拾う', () => {
  const out = changesOf(MD);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    date: '2026-08-23',
    items: ['写真の上限をなくしました', '音が出ない端末があったのを直しました'],
  });
});

test('最初の日付より前の前書きは読み飛ばす', () => {
  const out = changesOf(MD);
  assert.ok(!JSON.stringify(out).includes('使う人から見た変化'));
});

test('中身の無い日付は出さない', () => {
  /* 見出しだけ書いて中身を忘れることがある */
  assert.ok(!changesOf(MD).some((e) => e.date === '2026-06-01'));
});

test('「-」でも「*」でも箇条書きとして読む', () => {
  assert.deepEqual(changesOf(MD)[1].items, ['はじめて公開しました']);
});

test('新しい順に並べ、数を絞る', () => {
  const md = ['## 2026-01-01\n- ふるい', '## 2026-09-09\n- あたらしい', '## 2026-05-05\n- まんなか'].join('\n');
  assert.deepEqual(changesOf(md).map((e) => e.date), ['2026-09-09', '2026-05-05', '2026-01-01']);
  assert.deepEqual(changesOf(md, 1).map((e) => e.date), ['2026-09-09']);
});

test('書いていなければ、空で返す', () => {
  assert.deepEqual(changesOf(''), []);
  assert.deepEqual(changesOf(undefined), []);
  assert.deepEqual(changesOf('# 見出しだけ\n\nふつうの文章。'), []);
});

test('節の HTML は、書いてあるときだけ出る', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;');
  assert.equal(changelogSection([], esc), '');
  assert.equal(changelogSection(undefined, esc), '');

  const html = changelogSection(changesOf(MD), esc);
  assert.match(html, /<h2 class="changes__title" id="changes-title">最近の更新<\/h2>/);
  assert.match(html, /<time datetime="2026-08-23">2026\/08\/23<\/time>/);
  assert.match(html, /<li>写真の上限をなくしました<\/li>/);
});

test('書いてある文字は、そのまま HTML にしない', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;');
  const html = changelogSection(changesOf('## 2026-01-01\n- <script>あぶない'), esc);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;|&lt;script/);
});

test('コード枠の中の「- 行」を項目として拾わない', () => {
  /* ⚠️ 2026-08-31 まで拾っていた。giga-changelog スキルの references/format.md は
     書き方の例をコード枠で見せるので、それを写した CHANGELOG がそのまま
     公開ページに「## 2026/08/23」と並ぶ形になっていた。 */
  const md = `## 2026-08-23
- 写真の上限をなくしました

\`\`\`
- これは書き方の例なので出さない
\`\`\`
`;
  assert.deepEqual(changesOf(md), [{ date: '2026-08-23', items: ['写真の上限をなくしました'] }]);
});

test('スキル側の写しと、ここの正規表現が食い違っていない', () => {
  /* ⚠️ standards/skills/giga-changelog/ は 42 本へ配られるので、あちらから
     この changelog.mjs を import できない。DATE_RE と ITEM_RE は写しになる。
     食い違うと「手元の lint は通ったのに、公開ページに出ない」が起きる。
     写しであることは向こうのコメントにも書いてあるが、コメントは腐るので
     ここで実際に読んで突き合わせる。 */
  const here = readFileSync(new URL('./changelog.mjs', import.meta.url), 'utf8');
  const skill = readFileSync(
    new URL('../../standards/skills/giga-changelog/scripts/lint-changelog.mjs', import.meta.url),
    'utf8');
  for (const name of ['DATE_RE', 'ITEM_RE']) {
    const of = (src) => src.match(new RegExp(`^const ${name} = (.+);$`, 'm'))?.[1];
    assert.ok(of(here), `${name} が tools/lib/changelog.mjs に無い`);
    assert.equal(of(skill), of(here), `${name} がスキル側の写しと食い違っている`);
  }
});

test('トップページ用：日付の新しい順に、アプリは repo の順で並ぶ', () => {
  const logs = {
    Zebra: '## 2026-08-20\n- ゼブラを直しました\n',
    Alpha: '## 2026-08-25\n- アルファを直しました\n## 2026-08-20\n- 古いほう\n',
  };
  const appOf = (repo) => ({ name: repo, href: `/apps/${repo.toLowerCase()}/` });
  const got = latestChanges(logs, appOf);
  assert.deepEqual(got.map((g) => g.date), ['2026-08-25', '2026-08-20']);
  assert.deepEqual(got[1].apps.map((a) => a.repo), ['Alpha', 'Zebra'], 'repo 順になっていない');
});

test('トップページ用：キーの並びを変えても、同じものが出る', () => {
  /* JSON のキー順は将来の書き手が簡単に変える。並びで出力が変わると
     index.html のハッシュが動き、lastmod が毎朝進む */
  const a = { Alpha: '## 2026-08-25\n- あ\n', Zebra: '## 2026-08-25\n- ぜ\n' };
  const b = { Zebra: '## 2026-08-25\n- ぜ\n', Alpha: '## 2026-08-25\n- あ\n' };
  const appOf = (repo) => ({ name: repo, href: `/apps/${repo}/` });
  assert.deepEqual(latestChanges(a, appOf), latestChanges(b, appOf));
});

test('トップページ用：載せないアプリ（appOf が null）は出さない', () => {
  const logs = { Hidden: '## 2026-08-25\n- 出ないはず\n', Shown: '## 2026-08-25\n- 出る\n' };
  const got = latestChanges(logs, (repo) => (repo === 'Hidden' ? null : { name: repo, href: '/' }));
  assert.deepEqual(got[0].apps.map((a) => a.repo), ['Shown']);
});

test('トップページ用：3 段の上限で切る', () => {
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, n) => [
    `R${n}`, `## 2026-08-2${n % 5}\n- あ\n- い\n- う\n- え\n- お\n`,
  ]));
  const got = latestChanges(many, (repo) => ({ name: repo, href: '/' }));
  assert.ok(got.length <= CHANGE_DAYS, '日付のかたまりが多すぎる');
  const total = got.reduce((n, g) => n + g.apps.reduce((m, a) => m + a.items.length, 0), 0);
  assert.ok(total <= CHANGE_ITEMS, `項目が ${total} 件（上限 ${CHANGE_ITEMS}）`);
  for (const g of got) {
    for (const a of g.apps) assert.ok(a.items.length <= PER_APP_DAY);
  }
});

test('トップページ用：1 本も書かれていなければ空文字', () => {
  assert.equal(changesFeed([], (s) => s, (d) => d), '');
});

test('トップページ用：同じ入力を 2 回組むと、バイトまで同じ', () => {
  const logs = { Alpha: '## 2026-08-25\n- あ\n' };
  const appOf = (repo) => ({ name: repo, href: '/' });
  const build = () => changesFeed(latestChanges(logs, appOf), (s) => s, (d) => d);
  assert.equal(build(), build());
});

test('トップページ用：字はエスケープする', () => {
  const logs = { A: '## 2026-08-25\n- <script>alert(1)</script> を直しました\n' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = changesFeed(latestChanges(logs, () => ({ name: 'A', href: '/' })), esc, (d) => d);
  assert.ok(!html.includes('<script>'), '素の <script> が出ている');
  assert.match(html, /&lt;script&gt;/);
});
