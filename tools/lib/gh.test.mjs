/**
 * GitHub の取り口の検査。
 *
 * ここは「記事・開発記録・マニュアルの 3 つが同じ道を通る」ための土台なので、
 * 壊れると 3 つ同時に、しかも「置いていないアプリ」と区別のつかない形で落ちる。
 *
 * fetch を差し替えて、実際に組み立てた URL とヘッダを見る。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ghApi, ghFindDoc, ghListMarkdown, ghText, imageResolvers, reachable } from './gh.mjs';

/** fetch を差し替える。呼ばれた記録を残す。 */
function fakeFetch(handler) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: (init && init.headers) || {}, method: (init && init.method) || 'GET' });
    return handler(String(url), init, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
const b64 = (s) => ({ encoding: 'base64', content: Buffer.from(s, 'utf8').toString('base64') });

test('トークンで断られたら、認証なしでもう一度だけ試す', async () => {
  process.env.GITHUB_TOKEN = 'test-token';
  const f = fakeFetch((url, init, n) => (n === 1 ? json({}, 403) : json({ ok: true })));
  try {
    const res = await ghApi('Qalc/contents/docs/note', 'test');
    assert.equal(res.status, 200);
    assert.equal(f.calls.length, 2, '2 回だけ試すこと');
    assert.ok(f.calls[0].headers.authorization, '1 回目はトークンを付ける');
    assert.ok(!f.calls[1].headers.authorization, '2 回目はトークンを外す');
  } finally { f.restore(); delete process.env.GITHUB_TOKEN; }
});

test('トークンが無いときは、やり直さない（同じことを 2 回聞かない）', async () => {
  delete process.env.GITHUB_TOKEN;
  const f = fakeFetch(() => json({}, 404));
  try {
    await ghApi('Qalc/contents/docs/note', 'test');
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test('200 のときはやり直さない', async () => {
  process.env.GITHUB_TOKEN = 'test-token';
  const f = fakeFetch(() => json({ ok: true }));
  try {
    await ghApi('Qalc/contents/docs/note', 'test');
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); delete process.env.GITHUB_TOKEN; }
});

test('置き場ごと無いアプリでは null（落ちない・空を作らない）', async () => {
  const f = fakeFetch(() => json({ message: 'Not Found' }, 404));
  try {
    assert.equal(await ghFindDoc('Gobblet', 'docs/manual', () => true, 'test'), null);
  } finally { f.restore(); }
});

test('置き場はあるが、探している名前が無ければ null', async () => {
  const f = fakeFetch(() => json([{ type: 'file', name: 'README.md' }]));
  try {
    assert.equal(await ghFindDoc('Qalc', 'docs/manual', (n) => n === 'manual.md', 'test'), null);
  } finally { f.restore(); }
});

test('見つかれば、中身を文字にして返す', async () => {
  const f = fakeFetch((url) => (url.includes('/contents/docs/manual/manual.md')
    ? json(b64('# つかいかた\n'))
    : json([{ type: 'file', name: 'manual.md', path: 'docs/manual/manual.md' }])));
  try {
    const got = await ghFindDoc('Qalc', 'docs/manual', (n) => n === 'manual.md', 'test');
    assert.equal(got.path, 'docs/manual/manual.md');
    assert.equal(got.markdown, '# つかいかた\n');
  } finally { f.restore(); }
});

test('置き場の Markdown の名前を並べられる（名前が違うときに理由を言うため）', async () => {
  const f = fakeFetch(() => json([
    { type: 'file', name: 'tsukaikata.md' },
    { type: 'file', name: 'a.png' },
    { type: 'dir', name: 'images' },
  ]));
  try {
    assert.deepEqual(await ghListMarkdown('Qalc', 'docs/manual', 'test'), ['tsukaikata.md']);
  } finally { f.restore(); }
});

test('ghText は、取れないときに例外ではなく空文字', async () => {
  const f = fakeFetch(() => { throw new Error('つながらない'); });
  try {
    assert.equal(await ghText('Qalc', 'docs/CHANGELOG.md', 'test'), '');
  } finally { f.restore(); }
});

test('reachable は、つながらないときに「届かない」側へ倒す', async () => {
  const f = fakeFetch(() => { throw new Error('つながらない'); });
  try {
    assert.equal(await reachable('https://qalc.giga-school.com/note/images/01.png'), false);
  } finally { f.restore(); }
});

/* -----------------------------------------------------------------
 * 画像の読み先。
 *
 * ⚠️ ここは tools/build-articles.mjs の中に直接書いてあったものを切り出した。
 *    切り出しで 1 文字でも変わると、32 本の記事の画像がまとめてずれる。
 *    切り出す前の式が作っていた URL を、そのまま書いて留めてある。
 * --------------------------------------------------------------- */
test('docs/ を配っているアプリ（docs/ を落として組む）', () => {
  const r = imageResolvers({
    repo: 'SchoolPlan_Editor', slug: 'schoolplan-editor', dir: 'docs/note',
    docsIsRoot: true, mirrorDir: '/assets/article',
  });
  assert.equal(r.onSubdomain('images/01-home.png'),
    'https://schoolplan-editor.giga-school.com/note/images/01-home.png');
  assert.equal(r.onMirror('images/01-home.png'), '/assets/article/schoolplan-editor/01-home.webp');
  assert.equal(r.onRaw('images/01-home.png'),
    'https://raw.githubusercontent.com/GIGAyama/SchoolPlan_Editor/HEAD/docs/note/images/01-home.png');
});

test('リポジトリまるごと配っているアプリ（docs/ を残す）', () => {
  const r = imageResolvers({
    repo: 'Qalc', slug: 'qalc', dir: 'docs/note',
    docsIsRoot: false, mirrorDir: '/assets/article',
  });
  assert.equal(r.onSubdomain('images/01-home.png'),
    'https://qalc.giga-school.com/docs/note/images/01-home.png');
});

test('./ ではじまる指定も、絶対 URL も、これまでどおり', () => {
  const r = imageResolvers({
    repo: 'Qalc', slug: 'qalc', dir: 'docs/note', docsIsRoot: true, mirrorDir: '/assets/article',
  });
  assert.equal(r.onSubdomain('./images/01-home.png'),
    'https://qalc.giga-school.com/note/images/01-home.png');
  /* すでに絶対 URL のものは触らない */
  for (const key of ['onSubdomain', 'onMirror', 'onRaw']) {
    assert.equal(r[key]('https://example.com/a.png'), 'https://example.com/a.png');
  }
});

test('マニュアルは、記事とは別の控えの置き場を指す', () => {
  /* ⚠️ 同じ入れ物にすると必ず衝突する。どちらも 01-home.png のような名前になる */
  const r = imageResolvers({
    repo: 'Qalc', slug: 'qalc', dir: 'docs/manual', docsIsRoot: true, mirrorDir: '/assets/manual',
  });
  assert.equal(r.onSubdomain('images/01-home.png'),
    'https://qalc.giga-school.com/manual/images/01-home.png');
  assert.equal(r.onMirror('images/01-home.png'), '/assets/manual/qalc/01-home.webp');
});

test('拡張子は WebP に置き替わる（大文字でも）', () => {
  const r = imageResolvers({
    repo: 'Qalc', slug: 'qalc', dir: 'docs/note', docsIsRoot: true, mirrorDir: '/assets/article',
  });
  assert.equal(r.onMirror('images/01-home.PNG'), '/assets/article/qalc/01-home.webp');
  assert.equal(r.onMirror('images/02-a.jpg'), '/assets/article/qalc/02-a.webp');
});
