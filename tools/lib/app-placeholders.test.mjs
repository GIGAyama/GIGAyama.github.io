/**
 * 配布先ごとに埋める字。
 *
 * ここが抜けていたせいで、records-export.html を持つ 9 本のうち 8 本が
 * 「このページは、__APP_NAME__の学習記録を…」と公開されていた
 * （2026-08-30 実測）。check-drift は両側をプレースホルダーへそろえて
 * 比べるので、緑のまま気づけない形だった。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApps, fillPlaceholders, hasUnfilledPlaceholder, hasUnfilledAppId,
} from './app-placeholders.mjs';

const APPS = JSON.stringify({
  items: [
    { repo: 'Qalc', name: 'Qalc（カルク）', slug: 'qalc' },
    { repo: 'KANJI_Town', name: 'マイ漢字タウン', slug: 'kanji-town' },
    { repo: 'NoName', slug: 'no-name' },
  ],
});
const read = () => APPS;

test('apps.json を repo 名で引ける形にする', () => {
  const m = loadApps('apps.json', read);
  assert.equal(m.get('Qalc').name, 'Qalc（カルク）');
  assert.equal(m.size, 3);
});

test('apps.json が読めなくても落ちない（配布は止めない）', () => {
  const m = loadApps('apps.json', () => { throw new Error('ない'); });
  assert.equal(m.size, 0);
});

test('配列そのものの apps.json でも読める', () => {
  const m = loadApps('apps.json', () => JSON.stringify([{ repo: 'A', name: 'あ' }]));
  assert.equal(m.get('A').name, 'あ');
});

test('__APP_NAME__ を表示名で埋める（1 行に何度あっても）', () => {
  const src = '<title>受け渡し口｜__APP_NAME__</title>\n← __APP_NAME__に もどる';
  const out = fillPlaceholders(src, { name: 'Qalc（カルク）' });
  assert.equal(out, '<title>受け渡し口｜Qalc（カルク）</title>\n← Qalc（カルク）に もどる');
  assert.ok(!out.includes('__APP_NAME__'));
});

test('名前が分からないときは、そのまま返す（あとで警告する側にまわす）', () => {
  const src = '← __APP_NAME__に もどる';
  assert.equal(fillPlaceholders(src, undefined), src);
  assert.equal(fillPlaceholders(src, {}), src);
  assert.equal(fillPlaceholders(src, { name: '   ' }), src);
});

test('埋まっていないプレースホルダーを見分ける', () => {
  assert.equal(hasUnfilledPlaceholder('← __APP_NAME__に もどる'), true);
  assert.equal(hasUnfilledPlaceholder('← Qalc（カルク）に もどる'), false);
});

test('__APP_ID__ は埋めない。残っていることだけ分かればよい', () => {
  const src = "const APP_ID = '__APP_ID__';";
  // 表示名を埋めても APP_ID は触らない
  assert.equal(fillPlaceholders(src, { name: 'Qalc（カルク）', slug: 'qalc' }), src);
  assert.equal(hasUnfilledAppId(src), true);
  assert.equal(hasUnfilledAppId("const APP_ID = 'kuku-card';"), false);
});
