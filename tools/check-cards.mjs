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
 * ここでは index.html だけを読んで確かめる。ブラウザは要らない。
 * ===================================================================== */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let failed = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${label}${!cond && extra !== undefined ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

const cards = [...html.matchAll(/<li class="card" [^>]*data-slug="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map(([, slug, body]) => ({ slug, body }));

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

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
