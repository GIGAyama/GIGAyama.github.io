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

test('slug を渡すと 3 本の行き先が組める', () => {
  const { items, slug } = load().resolve({ slug: 'schoolplan-editor' });
  assert.equal(slug, 'schoolplan-editor');
  assert.deepEqual(plain(items).map((i) => i.id), ['manual', 'terms', 'privacy']);
  assert.deepEqual(plain(items).map((i) => i.href), [
    'https://giga-school.com/apps/schoolplan-editor/manual/',
    'https://schoolplan-editor.giga-school.com/terms.html',
    'https://schoolplan-editor.giga-school.com/privacy.html',
  ]);
});

test('紹介記事へは出さない', () => {
  /* ⚠️ 2026-08-29 に外した。あれは「なぜ作ったか」を、まだ使っていない先生に
     向けて書いたもので、いま画面の前で困っている人が求めているものではない。
     そもそもこの部品は、42 本のフッターが揃って紹介記事を指していたのを
     直すために作った。戻すときは、その経緯ごと考え直すこと。 */
  const { items } = load().resolve({ slug: 'kake-master' });
  assert.ok(!plain(items).some((i) => i.id === 'article'), '紹介記事が混ざっている');
  assert.ok(!plain(items).some((i) => i.href === 'https://giga-school.com/apps/kake-master/'),
    '紹介記事の URL が混ざっている');
  /* 名指しで頼まれても出さない（古い data-links が残っている repo があるため） */
  const asked = load().resolve({ slug: 'kake-master', links: 'article,terms' });
  assert.deepEqual(plain(asked.items).map((i) => i.id), ['terms']);
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
  assert.equal(got.items.length, 3);
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

test('押せる大きさは 48px、見えている高さは細いまま（艦隊のルール 2）', () => {
  /* ⚠️ min-height:48px に戻さないこと。それをやるとこの 1 行だけで
     フッターが 56px になり、アプリの表示領域を押しつぶす。
     2026-08-29、デジタル・クラス新聞社のフッターが 2 行 115px まで太った。
     見た目の高さと当たり判定は別に持つ。 */
  /* ⚠️ ここで /min-height:48px/ とだけ書かないこと。すぐ上の警告コメントが
     その文字をそのまま持っているので、書いてはいけないと注意した側が
     検査に引っかかる。CSS は '…' の中にしかないので、そこだけを見る。 */
  assert.ok(!/'[^'\n]*min-height:48px/.test(code), '高さそのものを 48px にしていない');
  assert.ok(/a::after\{[^}]*block-size:48px/.test(code), '当たり判定が 48px あること');
  /* 当たり判定だけを広げると隣どうしが重なって、押したつもりと違うほうが開く。
     見た目の幅も 48px 以上あること。 */
  assert.ok(/min-inline-size:48px/.test(code), '横も 48px 以上あること');
  assert.ok(/a::after\{[^}]*inline-size:100%/.test(code), '当たり判定が見た目の幅に合っていること');
});

test('フッターの 1 行に収まる形になっている', () => {
  /* 部品そのものが行を占めると、著作権表示と別の行になってフッターが 2 行になる。 */
  assert.ok(/:host\{[^}]*display:inline-flex/.test(code), ':host が行の一部として振る舞うこと');
  assert.ok(/\.row\{[^}]*flex-wrap:nowrap/.test(code), 'リンクの並びが折り返さないこと');
  /* 置き場所が無くて画面のいちばん下へ出したときだけ、1 行を占めてよい。 */
  assert.ok(/:host\(\.giga-app-links--end\)\{[^}]*display:flex/.test(code));
});

test('狭い画面では文字を落として絵だけにする（名前は残す）', () => {
  assert.ok(/@media \(max-width: 640px\)\{\.t\{/.test(code), '狭い画面で文字を隠す指定があること');
  /* ⚠️ display:none にすると読み上げからも消え、絵だけのリンクに名前が無くなる。 */
  assert.ok(!/\.t\{display:none/.test(code), '文字を display:none で消していない');
  assert.ok(/clip-path:inset\(50%\)/.test(code), '見えなくするだけで、読み上げには残すこと');
  assert.ok(code.includes("t.className = 't'"), '文字が <span class="t"> で包まれていること');
  assert.ok(code.includes('a.title = it.label'), '絵だけになったときに指す名前があること');
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
     書いた data-links が効かなかった。しかも黙って全部出るので、
     絞ったつもりの側は実ブラウザで数えるまで気づけない。 */
  assert.match(code, /\[data-giga-links\]'\)/);
  assert.match(code, /slot\.links/, '置き場所の data-links を読んでいない');
  assert.match(code, /slot\.slug/, '置き場所の data-slug を読んでいない');
});

test('置き場所が後から来たら、出しなおして移す（React などのアプリ）', () => {
  /* ⚠️ 2026-08-29、Reversi（React）で起きた。画面は DOMContentLoaded より後に
     描かれるので、そのとき <div data-giga-links> はまだ無い。そこで諦めると
     置き場所が見つからないだけでなく、**そこに書いた data-links も読めない**。
     黙って既定の 3 本が画面のいちばん下に出る。フッターに置いたはずの
     リンクが本文の下に落ち、外したはずの「つかいかた」も出ていた。 */
  assert.match(code, /MutationObserver/, '後から来る置き場所を見張っていない');
  assert.match(code, /SLOT_WAIT_MS/, '見張りの上限が無い');
  assert.match(code, /setTimeout\(stop, SLOT_WAIT_MS\)/, '見張りに上限が効いていない');
  assert.match(code, /obs\.disconnect\(\)/, '見張りを外していない');
});

test('待ってから出さない。まず出して、あとで移す', () => {
  /* ⚠️ 同じ 2026-08-29、上を「待ってから出す」と書いたせいで、置き場所を
     持たないアプリ（Typa）でリンクが 1.5 秒あとに出るようになっていた。
     フッターの無いアプリは艦隊にいくつもあり、そちらのほうが数が多い。
     実ブラウザで測って気づいた（400ms の時点では 1 本も出ていなかった）。 */
  const started = code.slice(code.indexOf('function start()'));
  const paintAt = started.indexOf('paint()');
  const watchAt = started.indexOf('watchForSlot()');
  assert.ok(paintAt !== -1 && watchAt !== -1, 'start() の形が変わっている');
  assert.ok(paintAt < watchAt, '見張りより先に出していない（待たせている）');
  /* 出しなおすときは、前のものを外すこと（二重に出さない） */
  assert.match(code, /shown\.parentNode\.removeChild\(shown\)/, '出しなおしで前のものを外していない');
});
