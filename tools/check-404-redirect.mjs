#!/usr/bin/env node
/* =====================================================================
 * tools/check-404-redirect.mjs — 旧アドレスの受け皿のテスト
 * =====================================================================
 * 使い方: リポジトリのルートで `node tools/check-404-redirect.mjs`
 *
 * 各アプリはもともと gigayama.github.io/<リポジトリ名>/ で公開していた。
 * いまは <アプリ名>.giga-school.com へ移したが、古いブックマークや
 * 配布済みのプリント・QRコードは今も /<リポジトリ名>/ を指している。
 * それがここへ落ちてきたときに、404.html が正しいサブドメインへ
 * 送り直す（404.html の中のスクリプト）。
 *
 * ここでは、その行き先の決め方を 404.html から取り出して、
 * 実際の data/apps.json で確かめる。ブラウザは要らない。
 * ===================================================================== */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../404.html', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(new URL('../data/apps.json', import.meta.url), 'utf8'));

let failed = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${label}${!cond && extra !== undefined ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

console.log('■ 404.html に受け皿が入っている');
ok(html.includes("fetch('/data/apps.json'"), 'data/apps.json を読んでいる（一覧を書き写していない）');
ok(/SAFE_SLUG\s*=\s*\/\^\[a-z0-9\]/.test(html), 'slug の形を確かめてから転送している（開いたリダイレクトにしない）');
ok(html.includes('location.replace('), '履歴を残さず転送している');

/* 404.html と同じ決め方をここで再現する。
 * 片方だけ直すとずれるので、変えたときは両方を見ること。 */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
function target(pathname, search = '', hash = '') {
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length === 0) return null;
  const hit = data.items.filter((i) => i.repo && i.slug &&
    i.repo.toLowerCase() === seg[0].toLowerCase())[0];
  if (!hit || !SAFE_SLUG.test(hit.slug)) return null;
  const rest = seg.slice(1).join('/');
  const tail = pathname.endsWith('/') && rest ? '/' : '';
  return `https://${hit.slug}.giga-school.com/${rest}${tail}${search}${hash}`;
}

console.log('\n■ 旧アドレスが正しいサブドメインへ向く');
for (const [path, want] of [
  ['/KAKE_Master/', 'https://kake-master.giga-school.com/'],
  ['/KAKE_Master', 'https://kake-master.giga-school.com/'],
  ['/kake_master/', 'https://kake-master.giga-school.com/'],
  ['/KANJI_Town/', 'https://kanji-town.giga-school.com/'],
  ['/online-100square-calculation/', 'https://online-100square-calculation.giga-school.com/'],
  ['/Gamification/manabi-portal/', 'https://gamification.giga-school.com/manabi-portal/'],
  ['/KAKE_Master/privacy.html', 'https://kake-master.giga-school.com/privacy.html'],
]) ok(target(path) === want, `${path} → ${want}`, target(path));

console.log('\n■ 転送してはいけないものは転送しない');
for (const path of ['/', '/about', '/assets/style.css', '/../etc/passwd', '/知らないアプリ/'])
  ok(target(path) === null, `${path} は ふつうの 404`, target(path));

console.log('\n■ クエリとフラグメントを落とさない');
ok(target('/Gamification/manabi-portal/', '?app=x', '#y')
   === 'https://gamification.giga-school.com/manabi-portal/?app=x#y',
   '?app=x#y が引き継がれる', target('/Gamification/manabi-portal/', '?app=x', '#y'));

console.log('\n■ 一覧そのものの形');
const slugged = data.items.filter((i) => i.slug);
ok(slugged.length > 0, `slug のあるアプリが ${slugged.length} 件ある`);
ok(slugged.every((i) => SAFE_SLUG.test(i.slug)), 'すべての slug が転送に使える形');
ok(new Set(slugged.map((i) => i.repo.toLowerCase())).size === slugged.length,
   'repo 名が重複していない（重複すると行き先が定まらない）');

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
