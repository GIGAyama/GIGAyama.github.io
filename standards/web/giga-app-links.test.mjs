/**
 * giga-app-links.js の検査。
 *
 * ⚠️ 文字が入っているかを見るだけの検査にしない。
 *    このファイルが決めるのは「どの URL へ飛ばすか」で、そこを間違えると
 *    存在しないページや、よそのアプリの利用規約へ子どもを飛ばすことになる。
 *    だから node:vm に読みこんで、実際に組ませた URL を見る。
 *
 *    画面（document）の無い文脈に読ませると、DOM を触る手前で return するので、
 *    ブラウザを立ち上げずに resolve() だけを試せる。そう書いてある。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = new URL('./giga-app-links.js', import.meta.url);
const code = readFileSync(SRC, 'utf8');

/* ⚠️ vm の中で作られた配列は、こちらの Array とは別物（realm が違う）。
   assert.deepEqual は作られ元まで見るので、素のまま比べると中身が同じでも
   落ちる。JSON を通して、こちら側の値に写してから比べる。 */
const plain = (x) => JSON.parse(JSON.stringify(x));

/** document の無い文脈に読みこんで、resolve() を取り出す。 */
function load() {
  const sandbox = { window: {}, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(sandbox.window.GigaAppLinks, 'window.GigaAppLinks が出ていること');
  return sandbox.window.GigaAppLinks;
}

test('slug を渡すと 4 本の行き先が組める', () => {
  const { items, slug } = load().resolve({ slug: 'schoolplan-editor' });
  assert.equal(slug, 'schoolplan-editor');
  assert.deepEqual(plain(items).map((i) => i.id), ['manual', 'article', 'terms', 'privacy']);
  assert.deepEqual(plain(items).map((i) => i.href), [
    'https://giga-school.com/apps/schoolplan-editor/manual/',
    'https://giga-school.com/apps/schoolplan-editor/',
    'https://schoolplan-editor.giga-school.com/terms.html',
    'https://schoolplan-editor.giga-school.com/privacy.html',
  ]);
});

test('ホスト名からも slug が取れる（ふつうのアプリは 1 行で済む）', () => {
  const { slug, items } = load().resolve({ hostname: 'kake-master.giga-school.com' });
  assert.equal(slug, 'kake-master');
  assert.equal(items[0].href, 'https://giga-school.com/apps/kake-master/manual/');
});

test('GAS の中（script.google.com）では、slug を渡さないと何も出さない', () => {
  /* ⚠️ ここが本題。当てずっぽうに組むと、存在しないアプリの利用規約へ飛ばす。
     GAS の画面は script.google.com か googleusercontent.com で動く。 */
  for (const hostname of ['script.google.com', 'n-abcdef.googleusercontent.com',
                          'localhost', '', 'giga-school.com']) {
    const got = load().resolve({ hostname });
    assert.equal(got.items.length, 0, `${hostname} では何も出さないこと`);
    assert.equal(got.slug, '');
  }
});

test('GAS でも slug を渡せば出る', () => {
  const got = load().resolve({ slug: 'schoolplan-editor', hostname: 'script.google.com' });
  assert.equal(got.items.length, 4);
});

test('よそのドメインに化けた slug は受けつけない', () => {
  for (const slug of ['../evil', 'a.b', 'UPPER', 'has space', '-lead', 'trail-',
                      'evil.com/x', '']) {
    assert.equal(load().resolve({ slug }).items.length, 0, `${slug} は受けつけないこと`);
  }
  /* ホスト名側も同じ。giga-school.com に「見える」だけのものを通さない */
  assert.equal(load().resolve({ hostname: 'qalc.giga-school.com.evil.jp' }).items.length, 0);
  assert.equal(load().resolve({ hostname: 'a.b.giga-school.com' }).items.length, 0);
});

test('data-links で出すものを絞れる', () => {
  const got = load().resolve({ slug: 'typa', links: 'manual,privacy' });
  assert.deepEqual(plain(got.items).map((i) => i.id), ['manual', 'privacy']);
});

test('data-links の書き順ではなく、決めた順に並ぶ', () => {
  /* いつも同じ場所にある、が崩れないようにする */
  const got = load().resolve({ slug: 'typa', links: 'privacy , manual' });
  assert.deepEqual(plain(got.items).map((i) => i.id), ['manual', 'privacy']);
});

test('知らない名前を混ぜても落ちない', () => {
  const got = load().resolve({ slug: 'typa', links: 'manual,しらないもの' });
  assert.deepEqual(plain(got.items).map((i) => i.id), ['manual']);
});

test('引数が無くても落ちない', () => {
  assert.deepEqual(plain(load().resolve().items), []);
  assert.deepEqual(plain(load().resolve({}).items), []);
});

test('外部から何も読まない（Zero External CDN）', () => {
  /* http(s) で外を指すのは giga-school.com だけ。書体もアイコンも自前 */
  /* コメントの中の説明（https://<slug>.giga-school.com/…）は取りに行く URL では
     ないので外す。実際に組み立てるところだけを見る。 */
  const urls = (code.match(/https?:\/\/[^\s'"`)]+/g) || []).filter((u) => !u.includes('<slug>'));
  const outside = urls.filter((u) => !/^https:\/\/(?:[a-z0-9-]+\.)?giga-school\.com/.test(u)
    && u !== 'http://www.w3.org/2000/svg');   // SVG の名前空間。取りに行く URL ではない
  assert.deepEqual(outside, [], '外部への参照が無いこと');
  assert.ok(!/@import|fonts\.googleapis|cdnjs|jsdelivr|unpkg/.test(code));
});

test('タップ領域が 48px 以上ある（艦隊のルール 2）', () => {
  assert.ok(code.includes('min-height:48px'), 'ボタンの高さが 48px 以上であること');
  assert.ok(code.includes('min-width:48px'));
});

test('リンクは別のタブで開く（iframe の中で戻れなくならないように）', () => {
  assert.ok(code.includes("a.target = '_blank'"));
  assert.ok(code.includes("a.rel = 'noopener noreferrer'"));
});

test('閉じタグをそのまま持たない（GAS に取りこめる形であること）', () => {
  /* ⚠️ GAS のアプリは <script src> が使えないので、このファイルの中身を
     <script> で囲んで取りこむ。コメントの中であっても閉じタグをそのまま
     書くと、そこで script が終わり、残りが素の HTML として画面に出る。
     2026-08-29 に SchoolPlan_Editor の品質ゲートが実際に見つけた。 */
  assert.ok(!code.includes('</scr' + 'ipt>'),
    '閉じタグは <\\/script> のように書くこと（コメントの中でも）');
});

test('アプリ固有の文字を持たない（42 本に同じものが配れる）', () => {
  /* ⚠️ ここが崩れると check-drift に normalize を足すことになり、
     「1 本の正本」ではなくなる。アプリ名や slug を書き足さないこと。 */
  const slugs = ['schoolplan-editor', 'qalc', 'kake-master', 'typa', 'werewolf'];
  for (const s of slugs) assert.ok(!code.includes(s), `${s} が書かれていないこと`);
});

/* --- CSP の下でも見た目が落ちないこと -------------------------------- */

test('見た目を CSP に弾かれない形で入れている（style-src 自己のみの画面）', () => {
  /* ⚠️ 2026-08-29、Shadow DOM の <style> が CSP の style-src 'self' に
     弾かれ、リンクは出たまま 48px が 28px になっていた。例外は飛ばないので、
     コンソールを読むまで気づけない。艦隊は 'unsafe-inline' を付けている repo と
     付けていない repo に割れていて、緩いほうで先に試したのが見落としの原因。

     構築可能なスタイルシートは style-src の対象外なので、そちらを先に使う。 */
  assert.match(code, /adoptedStyleSheets/, '構築可能なスタイルシートを使っていない');
  assert.match(code, /new CSSStyleSheet\(\)/);
  assert.match(code, /replaceSync/);
  /* 使えない browser のために <style> も残すこと（そちらは CSP も古いか無い） */
  assert.match(code, /createElement\('style'\)/, '古い browser 向けの降り先が無い');
});

test('style 属性で見た目を作らない（CSP の style-src が見ている）', () => {
  /* host.style.margin = … と書くと、厳しい CSP の画面で黙って効かない。
     余白も Shadow DOM の中の :host(...) で付ける。 */
  assert.ok(!/\.style\.(margin|padding|display|color|background)\s*=/.test(code),
    'style 属性で見た目を作っている箇所がある');
  assert.match(code, /:host\(\.giga-app-links--end\)/, '末尾へ出したときの余白が CSS 側に無い');
});

test('置き場所の div に書いた data-links も読む', () => {
  /* ⚠️ 2026-08-29、<script> と window だけを読んでいて、置き場所の <div> に
     書いた data-links が効かなかった。しかも黙って 4 つとも出るので、
     絞ったつもりの側は実ブラウザで数えるまで気づけない。 */
  assert.match(code, /\[data-giga-links\]'\)/);
  assert.match(code, /slot\.links/, '置き場所の data-links を読んでいない');
  assert.match(code, /slot\.slug/, '置き場所の data-slug を読んでいない');
});
