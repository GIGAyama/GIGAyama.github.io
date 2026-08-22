#!/usr/bin/env node
/* =====================================================================
 * tools/check-scenes.mjs — 「こんなときに」の割り当てのテスト
 * =====================================================================
 * 使い方: リポジトリのルートで `node tools/check-scenes.mjs`
 *
 * 場面タイル（<a class="scene" href="/?scene=…">）と、各カードの
 * data-scenes は、どちらも index.html に手で書いてある。片方だけ直すと、
 * 押しても 0 件のタイルや、どこからも辿り着けない割り当てが残る。
 *
 * いちばん困るのは「押したのに何も出ない」なので、ここで止める。
 * ブラウザは要らない。
 * ===================================================================== */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let failed = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${label}${!cond && extra !== undefined ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

/* タイル側 */
const tiles = [...html.matchAll(/<a class="scene" href="\/\?scene=([a-z-]+)#apps" data-scene="([a-z-]+)">/g)]
  .map(([, href, attr]) => ({ href, attr }));

/* カード側 */
const cards = [...html.matchAll(/<li class="card" [^>]*data-slug="([a-z0-9-]+)"([^>]*)>/g)]
  .map(([, slug, rest]) => ({
    slug,
    scenes: (rest.match(/data-scenes="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
  }));

console.log('■ 場面タイルとカードがそろっている');
ok(tiles.length > 0, `場面タイルが ${tiles.length} 枚ある`);
ok(cards.length > 0, `data-slug のあるカードが ${cards.length} 枚ある`);
ok(tiles.every((t) => t.href === t.attr),
   'タイルのリンク先と data-scene が一致している',
   tiles.filter((t) => t.href !== t.attr).map((t) => `${t.href}≠${t.attr}`).join(', '));

const tileIds = new Set(tiles.map((t) => t.attr));
ok(tileIds.size === tiles.length, '同じ場面のタイルが 2 枚無い');

console.log('\n■ 押しても 0 件になるタイルが無い');
const count = new Map([...tileIds].map((id) => [id, 0]));
for (const card of cards) {
  for (const id of card.scenes) if (count.has(id)) count.set(id, count.get(id) + 1);
}
for (const [id, n] of count) ok(n > 0, `${id} に ${n} 本`, '当てはまるカードが 1 枚も無い');

console.log('\n■ タイルの無い場面がカードに書かれていない');
for (const card of cards) {
  const stray = card.scenes.filter((id) => !tileIds.has(id));
  ok(stray.length === 0, `${card.slug}`, `タイルの無い場面：${stray.join(', ')}`);
}

console.log('\n■ カードの決まりごと');
ok(cards.every((c) => c.slug), 'すべてのカードに data-slug がある');
ok(new Set(cards.map((c) => c.slug)).size === cards.length, 'data-slug が重複していない');
/* data-slug は「最近開いた順」の記録に使う。カードの「開く」の行き先と食い違うと、
   別のアプリを開いたことになる。 */
const bodies = [...html.matchAll(/<li class="card" [^>]*data-slug="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/li>/g)];
for (const [, slug, body] of bodies) {
  const open = body.match(/class="card__open" href="https:\/\/([a-z0-9-]+)\.giga-school\.com\//)?.[1];
  ok(open === slug, `${slug} の data-slug と「開く」の行き先が同じ`, open);
}

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
