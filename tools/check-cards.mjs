#!/usr/bin/env node
/* =====================================================================
 * tools/check-cards.mjs — カードの決まりごとのテスト
 * =====================================================================
 * 使い方: リポジトリのルートで `node tools/check-cards.mjs`
 *
 * トップページのカードは index.html に手で書いてある。
 * そのうち data-slug は「最近開いた順」の記録に使うので、カードの「開く」の
 * 行き先と食い違うと、押したのとは別のアプリを開いたことになる。
 * 記録は端末の中に残り続けるので、気づきにくい壊れ方になる。
 *
 * 絞り込みボタンに書いてある件数も見る。手で書く数字なので、カードを
 * 増やしたときに数字だけ古くなりやすい。「8 本」と書いてあるのに 7 本しか
 * 出ない、という壊れ方は、画面を見ても気づけない。
 *
 * ここでは index.html だけを読んで確かめる。ブラウザは要らない。
 * ===================================================================== */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let failed = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${label}${!cond && extra !== undefined ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

const cards = [...html.matchAll(/<li class="card" ([^>]*data-slug="([a-z0-9-]+)"[^>]*)>([\s\S]*?)<\/li>/g)]
  .map(([, attrs, slug, body]) => ({ slug, attrs, body }));

console.log('■ カードに data-slug が入っている');
ok(cards.length > 0, `data-slug のあるカードが ${cards.length} 枚ある`);

/* data-slug の無いカードを見つける。足し忘れると、そのアプリだけ記録に残らない */
const all = [...html.matchAll(/<li class="card"[^>]*>/g)].length;
ok(all === cards.length, `data-slug の無いカードが無い（カード ${all} 枚）`,
   `${all - cards.length} 枚に data-slug が無い`);

ok(new Set(cards.map((c) => c.slug)).size === cards.length, 'data-slug が重複していない');

console.log('\n■ data-slug と「開く」の行き先が同じ');
for (const { slug, body } of cards) {
  const open = body.match(/class="card__open" href="https:\/\/([a-z0-9-]+)\.giga-school\.com\//)?.[1];
  ok(open === slug, `${slug}`, open ?? '「開く」のリンクが見つからない');
}

/* -----------------------------------------------------------------
 * 絞り込みの 2 本目（つかいかた）
 * -----------------------------------------------------------------
 * 件数は手で書く。カードを増やしたときに数字だけ古くなると、
 * 「8 本」と書いてあるのに 7 本しか出ない、という壊れ方をする。
 * 見た目には気づけないので、ここで数え直して突き合わせる。
 * 教科（data-cat）も同じ理由で見る。
 * --------------------------------------------------------------- */
const USES = ['susumu', 'renshu', 'shiraberu', 'tsukuru', 'furikaeru', 'minna', 'sensei', 'hoka'];
const CATS = ['kokugo', 'sansu', 'tankyu', 'gakkyu', 'koumu', 'seisaku', 'game', 'other'];

console.log('\n■ カードに「つかいかた」が入っている');
const uses = new Map(cards.map((c) => [c.slug, (c.attrs.match(/data-use="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean)]));
const noUse = [...uses].filter(([, v]) => v.length === 0).map(([slug]) => slug);
ok(noUse.length === 0, `data-use の無いカードが無い（カード ${cards.length} 枚）`, noUse.join(', '));
const unknown = [...uses].flatMap(([slug, v]) => v.filter((u) => !USES.includes(u)).map((u) => `${slug}:${u}`));
ok(unknown.length === 0, '知らない「つかいかた」が無い', unknown.join(', '));

console.log('\n■ 絞り込みの選択肢の件数が、カードの数と合っている');
/* <select data-filter="cat"> の中の <option value="kokugo">国語・言葉（8）</option> を読む。
   選択肢は 2 つの系統にあり、同じ value（all / そのほか）が両方に出てくるので、
   まず系統ごとに切り出してから数を拾う。 */
const selectOf = (name) =>
  html.match(new RegExp(`<select[^>]*data-filter="${name}"[\\s\\S]*?</select>`))?.[0] ?? '';

const optionCount = (name, id) =>
  Number(selectOf(name).match(new RegExp(`<option value="${id}">[^<（]*（(\\d+)）</option>`))?.[1]);

const realCat = (id) => cards.filter((c) => (c.attrs.match(/data-cat="([^"]*)"/)?.[1] ?? '') === id).length;
const realUse = (id) => [...uses.values()].filter((v) => v.includes(id)).length;

for (const id of CATS) {
  ok(optionCount('cat', id) === realCat(id), `教科・分野：${id} は ${realCat(id)} 本`,
     `選択肢には ${optionCount('cat', id)} と書いてある`);
}
for (const id of USES) {
  ok(optionCount('use', id) === realUse(id), `つかいかた：${id} は ${realUse(id)} 本`,
     `選択肢には ${optionCount('use', id)} と書いてある`);
}
/* 「すべて」は両方の系統に 1 つずつある。どちらもカードの総数 */
for (const name of ['cat', 'use']) {
  ok(optionCount(name, 'all') === cards.length, `「すべて」（${name}）は ${cards.length} 本`, optionCount(name, 'all'));
}

/* -----------------------------------------------------------------
 * 自己紹介ページの内訳
 * -----------------------------------------------------------------
 * /profile/ にも同じ数字が並んでいる。トップだけ直して片方が古くなると、
 * 「8 本」と書いてあるボタンを押したら 7 本、ということが起きる。
 * --------------------------------------------------------------- */
console.log('\n■ 自己紹介ページの内訳が、カードの数と合っている');
const profile = readFileSync(new URL('../profile/index.html', import.meta.url), 'utf8');
const profileCount = (attr, id) =>
  Number(profile.match(new RegExp(`href="/\\?${attr}=${id}#apps"[^>]*>[^<]*<span class="count">(\\d+)</span>`))?.[1]);

for (const id of CATS) {
  ok(profileCount('cat', id) === realCat(id), `教科・分野：${id} は ${realCat(id)} 本`,
     `自己紹介ページには ${profileCount('cat', id)} と書いてある`);
}
for (const id of USES) {
  ok(profileCount('use', id) === realUse(id), `つかいかた：${id} は ${realUse(id)} 本`,
     `自己紹介ページには ${profileCount('use', id)} と書いてある`);
}

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
