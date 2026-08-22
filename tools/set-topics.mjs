#!/usr/bin/env node
/* =====================================================================
 * tools/set-topics.mjs — GitHub のトピックをまとめて付ける
 * =====================================================================
 * 使い方:
 *   node tools/set-topics.mjs                    何を付けるか見るだけ（既定）
 *   GITHUB_TOKEN=xxx node tools/set-topics.mjs --apply   実際に付ける
 *   node tools/set-topics.mjs --repo Reversi     1 つだけ見る／付ける
 *
 * なぜ要るか
 * ----------
 * 40 のリポジトリはトピックが 1 つも付いていない（2026-08 時点）。
 * トピックは GitHub の中の検索とトピックページからの入口になる。
 * README や説明文をいくら書いても、トピックが無いと
 * 「education を見に来た人」の目には入らない。
 *
 * スターも watcher も 0、フォークは 3。外からの流入がほぼ無い状態なので、
 * まずここを埋めるのがいちばん安く効く。
 *
 * トークンについて
 * ----------------
 * Administration: write（classic なら repo）の権限が要る。
 * このスクリプトは環境変数からしか読まない。引数に書かないこと
 * （シェルの履歴と ps に残る）。
 *
 * ⚠️ PUT /topics は「置き換え」であって「追加」ではない。
 *    いまはどのリポジトリも 0 件なので消えるものは無いが、
 *    あとから手で足したトピックがあるときは、先に下の表へ写すこと。
 * ===================================================================== */

import { readFileSync } from 'node:fs';

const OWNER = 'GIGAyama';

/* すべての学習アプリに付けるもの。
   education と edtech は世界中から見られている大きなトピック。
   gigaschool と elementary-school は数は少ないが、探している人にまっすぐ当たる。
   japanese は「日本語で使える教材」を探している人への入口。 */
const BASE = ['education', 'edtech', 'elementary-school', 'gigaschool', 'japanese'];

/* 学習アプリではないもの（作者の道具・このサイト自体）は BASE を付けない。
   関係の薄いトピックを付けると、探している人の邪魔になる。 */
const NO_BASE = new Set(['GIGAyama.github.io', 'DigitalCloset', 'XXX_automatic']);

/* リポジトリごとの、そのアプリならではのトピック。
   1 つのリポジトリに付けすぎると薄まるので、BASE と合わせて 8〜10 に収める。 */
const TOPICS = {
  /* --- Chrome 拡張機能・ツール --- */
  app_launcher:                 ['chrome-extension', 'browser-extension', 'launcher', 'productivity'],
  Blackboard_Timer:             ['chrome-extension', 'browser-extension', 'timer', 'classroom', 'picture-in-picture'],
  'Linker-Clipper':             ['chrome-extension', 'browser-extension', 'bookmarks', 'link-collection'],

  /* --- 国語・言葉 --- */
  'Haiku-meeting':              ['google-apps-script', 'react', 'haiku', 'japanese-language', 'writing'],
  'online-manuscript-paper-lite': ['writing', 'japanese-language', 'vertical-writing', 'single-file', 'offline-first'],
  'online-manuscript-paper-pro':  ['google-apps-script', 'react', 'writing', 'japanese-language', 'vertical-writing'],
  'Online-Publisher-pro':       ['google-apps-script', 'react', 'gemini-api', 'writing', 'japanese-language'],
  KANJI_Town:                   ['kanji', 'japanese-language', 'learning-game'],
  KANA_Master:                  ['hiragana', 'katakana', 'japanese-language', 'handwriting'],
  'Reading-Books':              ['reading', 'reading-log', 'barcode', 'isbn'],
  'tsubomi-learning':           ['japanese-language', 'picture-book', 'plants', 'science'],
  JIDOSHA_ZUKAN:                ['japanese-language', 'picture-book', 'vehicles'],

  /* --- 算数 --- */
  'online-100square-calculation': ['math', 'arithmetic', 'handwriting-recognition', 'chromebook', 'drill'],
  Qalc:                         ['math', 'arithmetic', 'multiplayer', 'learning-game'],
  'KEISAN-BLOCK':               ['math', 'arithmetic', 'visual-learning', 'manipulatives'],
  'Keisan-Card':                ['math', 'arithmetic', 'flashcards', 'drill'],
  KAKE_Master:                  ['math', 'arithmetic', 'multiplication', 'flashcards'],

  /* --- 学習・探究 --- */
  Typa:                         ['typing', 'typing-practice', 'keyboard', 'learning-game'],
  Moral_note:                   ['moral-education', 'journal', 'reflection'],
  Gamification:                 ['google-apps-script', 'google-sheets', 'gamification'],
  Townmap_Mikke:                ['google-apps-script', 'react', 'gemini-api', 'collaborative-learning', 'inquiry-based-learning'],
  'MIRAI-Compass':              ['google-apps-script', 'self-paced-learning', 'classroom-management'],
  PhysicalEducation_note:       ['physical-education', 'journal', 'record-keeping'],

  /* --- 学級経営 --- */
  Reflection_Journal:           ['google-apps-script', 'react', 'gemini-api', 'journal', 'classroom-management'],
  Homework_barcordreader:       ['google-apps-script', 'react', 'barcode', 'classroom-management'],

  /* --- 授業づくり・校務 --- */
  Digital_textbook:             ['pdf', 'annotation', 'webrtc', 'digital-textbook', 'classroom'],
  NotebookSample_Generator:     ['teaching-materials', 'notebook', 'classroom'],
  SchoolPlan_Editor:            ['lesson-planning', 'teacher-tools', 'weekly-plan'],
  'Shared-Folder-Sync':         ['google-apps-script', 'google-drive', 'sync', 'automation', 'teacher-tools'],

  /* --- 表現・制作 --- */
  'Digital-Newspaper':          ['google-apps-script', 'google-sheets', 'newspaper', 'writing'],
  'Music-production_studio':    ['daw', 'music', 'web-audio', 'react', 'music-education'],

  /* --- ゲーム・対戦 --- */
  Quarto:                       ['google-apps-script', 'board-game', 'two-player', 'strategy-game'],
  Gobblet:                      ['google-apps-script', 'board-game', 'two-player', 'strategy-game'],
  Quoridor:                     ['board-game', 'two-player', 'strategy-game'],
  Reversi:                      ['board-game', 'othello', 'chromebook', 'vanilla-javascript'],
  'Ice_slide-puzzle':           ['board-game', 'two-player', 'puzzle-game'],
  Werewolf:                     ['typescript', 'party-game', 'werewolf', 'pass-and-play'],
  word_basket:                  ['word-game', 'card-game', 'japanese-language', 'multiplayer'],
  Shiritori_fighter:            ['word-game', 'japanese-language', 'shiritori'],

  /* --- 学習アプリではないもの（BASE を付けない） --- */
  'GIGAyama.github.io':         ['github-pages', 'static-site', 'no-build', 'showcase', 'education', 'gigaschool'],
  DigitalCloset:                ['gemini-api', 'indexeddb', 'wardrobe', 'spa', 'javascript'],
  XXX_automatic:                ['automation', 'content-creation', 'social-media', 'javascript'],
};

/* この表と data/apps.json の食い違いを見つける。
   アプリを増やしたときに表へ足し忘れると、そのリポジトリだけトピックが空のまま残る。
   逆に、取り下げたリポジトリが表に残っていると --apply が 404 で止まる。 */
function drift() {
  const data = JSON.parse(readFileSync(new URL('../data/apps.json', import.meta.url), 'utf8'));
  const want = new Set([...data.items.map((i) => i.repo), 'GIGAyama.github.io']);
  const have = new Set(Object.keys(TOPICS));
  return {
    missing: [...want].filter((r) => !have.has(r)),   // 表に足し忘れ
    extra: [...have].filter((r) => !want.has(r)),     // 表に残ったまま
  };
}

/* GitHub の決まり：小文字・数字・ハイフンだけ。50 字以内。1 リポジトリ 20 個まで。 */
const VALID = /^[a-z0-9][a-z0-9-]{0,49}$/;

function topicsFor(repo) {
  const own = TOPICS[repo] ?? [];
  const base = NO_BASE.has(repo) ? [] : BASE;
  return [...new Set([...base, ...own])];
}

async function put(repo, names) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/topics`, {
    method: 'PUT',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).names;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;

if (apply && !process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN が要ります（Administration: write）。引数ではなく環境変数で渡してください。');
  process.exit(1);
}

const repos = Object.keys(TOPICS).filter((r) => !only || r === only);
if (only && !repos.length) {
  console.error(`表に無いリポジトリです: ${only}`);
  process.exit(1);
}

/* 先に食い違いと綴りを確かめる。途中で弾かれると、half-applied になって直しにくい */
const { missing, extra } = drift();
if (missing.length) console.warn('\u26a0\ufe0f 表に足りない（トピックが空のまま残る）: ' + missing.join(', '));
if (extra.length) console.warn('\u26a0\ufe0f 表に余分（apps.json に無い）: ' + extra.join(', '));

let bad = 0;
for (const repo of repos) {
  const names = topicsFor(repo);
  for (const t of names) if (!VALID.test(t)) { console.error(`使えない綴り ${repo}: ${t}`); bad++; }
  if (names.length > 20) { console.error(`多すぎる ${repo}: ${names.length} 個`); bad++; }
}
if (bad) process.exit(1);

console.log(apply ? `■ ${repos.length} リポジトリに付けます` : `■ ${repos.length} リポジトリ（見るだけ。付けるには --apply）`);
let failed = 0;
for (const repo of repos) {
  const names = topicsFor(repo);
  if (!apply) { console.log(`  ${repo}\n    ${names.join(' ')}`); continue; }
  try {
    const got = await put(repo, names);
    console.log(`  ✅ ${repo}（${got.length} 個）`);
  } catch (e) {
    console.error(`  ❌ ${repo}: ${e.message}`);
    failed++;
  }
}
if (failed) { console.error(`\n${failed} 件 付けられませんでした`); process.exit(1); }
console.log(apply ? '\n✅ 付け終わりました' : '\n付けるには GITHUB_TOKEN=… node tools/set-topics.mjs --apply');
