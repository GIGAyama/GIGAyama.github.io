import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLinks, shareOf, shareTextOf } from './article-share.mjs';

const URL_ = 'https://giga-school.com/apps/qalc/';
const TITLE = '「４択」じゃ届かない定着を。';

test('投稿の文は、題のうしろにサイトの名が付く', () => {
  assert.equal(shareTextOf(TITLE), `${TITLE}｜学校で使える Web アプリ`);
});

test('送り先は 4 つ。どれもアドレスを載せて開く', () => {
  const links = shareLinks({ url: URL_, title: TITLE });
  assert.deepEqual(links.map((l) => l.key), ['x', 'facebook', 'line', 'hatena']);
  for (const l of links) assert.ok(l.href.includes(encodeURIComponent(URL_)), l.key);
});

test('題とアドレスは、そのまま貼らずに符号化する', () => {
  const [x] = shareLinks({ url: URL_, title: 'あ&い' });
  assert.ok(!x.href.includes('あ&い'));
  assert.ok(x.href.includes(encodeURIComponent('あ&い｜学校で使える Web アプリ')));
});

test('枠には、送り先とコピーのボタンが並ぶ', () => {
  const html = shareOf({ url: URL_, title: TITLE });
  assert.ok(html.includes('class="share"'));
  assert.ok(html.includes('>X</a>'));
  assert.ok(html.includes('>はてブ</a>'));
  assert.ok(html.includes(`data-copy="${URL_}"`));
  /* 外へ開く先には、必ず rel を付ける */
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 4);
});

test('題かアドレスが無いときは、何も出さない', () => {
  assert.equal(shareOf({ url: '', title: TITLE }), '');
  assert.equal(shareOf({ url: URL_, title: '' }), '');
});

test('属性の中の引用符は落とす', () => {
  const html = shareOf({ url: 'https://example.com/?a="b"', title: TITLE });
  assert.ok(!/data-copy="[^"]*"[^ >]/.test(html));
  assert.ok(html.includes('&quot;'));
});
