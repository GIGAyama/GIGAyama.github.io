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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ACCOUNT_LABEL, CATEGORY_LABEL, STORAGE_LABEL, USE_LABEL } from './lib/categories.mjs';
import { HOST_INFO } from './lib/hosts.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
/* 学年の検査（下のほう）より先に要るので、ここで読む */
const apps = JSON.parse(readFileSync(new URL('../data/apps.json', import.meta.url), 'utf8')).items;

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
/* -----------------------------------------------------------------
 * 絞り込みの 3 本目（学年）
 * -----------------------------------------------------------------
 * ⚠️ 件数がずれると、いちばん静かに壊れる。「3年生（24）」と書いてあるのに
 *    23 本しか出ない、という壊れ方は目で見て気づけない。
 *    しかも学年は data/apps.json とカードの両方にあるので、
 *    ずれる口が 2 つある。両方見る。
 * --------------------------------------------------------------- */
console.log('\n■ カードの学年が data/apps.json と同じ');
const cardGrades = new Map(cards.map((c) => [
  c.slug,
  (c.attrs.match(/data-grades="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean).map(Number),
]));
const bySlug = new Map(apps.filter((a) => a.slug).map((a) => [a.slug, a]));
const drift = [...cardGrades].filter(([slug, g]) => {
  const want = bySlug.get(slug)?.grades ?? [];
  return JSON.stringify(g) !== JSON.stringify(want);
}).map(([slug]) => slug);
ok(drift.length === 0, `${cards.length} 枚すべてで data-grades が apps.json と同じ`, drift.join(', '));

/* 児童が使わないアプリには data-grades を付けない。付けると、
   学年を選んだときに先生用の道具が子ども向けの列に混ざる */
const teacherOnly = [...cardGrades].filter(([, g]) => g.length === 0).map(([slug]) => slug);
ok(teacherOnly.every((slug) => (bySlug.get(slug)?.grades ?? []).length === 0),
   `data-grades の無いカード ${teacherOnly.length} 枚は、apps.json でも学年なし`);

console.log('\n■ 学年の選択肢の件数が、カードの数と合っている');
const realGrade = (n) => [...cardGrades.values()].filter((g) => g.includes(Number(n))).length;
for (const n of [1, 2, 3, 4, 5, 6]) {
  ok(optionCount('grade', String(n)) === realGrade(n), `${n}年生は ${realGrade(n)} 本`,
     `選択肢には ${optionCount('grade', String(n))} と書いてある`);
}

/* 「すべて」は 3 つの系統に 1 つずつある。どれもカードの総数。
   ⚠️ 学年の「すべて」も総数（38）でよい。学年を選んだときにだけ
      先生用の 7 本が外れる、という動きにしてある */
for (const name of ['grade', 'cat', 'use']) {
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

/* -----------------------------------------------------------------
 * 総数（アプリ・拡張機能とツール・紹介記事）
 * -----------------------------------------------------------------
 * ⚠️ 同じ 3 つの数字が、機械が書く場所と手で書く場所に散らばっている。
 *    tools/sync-updates.mjs が数え直すのは index.html の <dl class="stats">
 *    と、まるごと組み直す /apps/・/press/ だけ。見出しの「公開中のアプリ
 *    （◯ 本）」も <meta name="description"> も、自己紹介ページの数字も手で書く。
 *    片方だけ動くと、同じサイトの中で数が食い違ったまま静かに残る。
 *
 *    2026-08-25 に、紹介記事が 32 本になったのに /profile/ だけ 31 本のまま
 *    だったのがそれである。/apps/ は機械が書くので 32 本に変わっていた。
 *    どちらも「本数が書いてある」ようにしか見えないので、目では気づけない。
 * --------------------------------------------------------------- */
console.log('\n■ 総数の表記が、data/ の数と合っている');
const articles = existsSync(new URL('../data/articles.json', import.meta.url))
  ? JSON.parse(readFileSync(new URL('../data/articles.json', import.meta.url), 'utf8')).items
  : [];
/* 数え方は tools/sync-updates.mjs と同じにする。hidden は転送のためだけに
   残してあるもので、サイトには出さない */
const listed = apps.filter((a) => a.hidden !== true);
const nApp = listed.filter((a) => a.kind === 'app').length;
const nTool = listed.filter((a) => a.kind === 'tool').length;
const nArticle = articles.length;

const page = (rel) => {
  const url = new URL(`../${rel}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};

/* [ページ, どこに書いてあるか, 正しい数, 数字を拾う正規表現]
   正規表現が当たらないときは「見つからない」で止める。文言を書き直したときに
   検査だけが静かに素通りするのを防ぐ。 */
const totals = [
  ['index.html', 'ページの説明（description）', nApp, /<meta name="description" content="[^"]*Web アプリを (\d+) 本公開/],
  ['index.html', '共有されたときの説明（og:description）', nApp, /<meta property="og:description" content="[^"]*Web アプリを (\d+) 本公開/],
  ['index.html', '構造化データの numberOfItems', nApp, /"numberOfItems": (\d+)/],
  ['index.html', 'ヒーローの「公開中のアプリ」', nApp, /<dt>公開中のアプリ<\/dt><dd>(\d+)/],
  ['index.html', 'ヒーローの「拡張機能・ツール」', nTool, /<dt>拡張機能・ツール<\/dt><dd>(\d+)/],
  ['index.html', '見出し「公開中のアプリ（◯ 本）」', nApp, /公開中のアプリ（(\d+) 本）/],
  ['index.html', '更新情報のはじめの一文（アプリ）', nApp, /いま公開しているのは Web アプリ (\d+) 本/],
  ['index.html', '更新情報のはじめの一文（ツール）', nTool, /いま公開しているのは Web アプリ \d+ 本と、拡張機能・ツール (\d+) 本/],
  ['index.html', '簡易版の自己紹介「いまは ◯ 本」', nApp + nTool, /2025 年 10 月にはじめて、いまは (\d+) 本/],

  ['profile/index.html', '内訳の「公開中のアプリ」', nApp, /<dt>公開中のアプリ<\/dt><dd>(\d+)/],
  ['profile/index.html', '内訳の「拡張機能・ツール」', nTool, /<dt>拡張機能・ツール<\/dt><dd>(\d+)/],
  ['profile/index.html', '内訳の「紹介の記事」', nArticle, /<dt>紹介の記事<\/dt><dd>(\d+)/],
  ['profile/index.html', '「つくっているもの」の拡張機能とツール', nTool, /ブラウザの拡張機能とツールが (\d+) 本あります/],
  ['profile/index.html', '年表の「いま」の脇の本数', nApp, /<p class="profile-step__when">いま<span class="profile-step__count">(\d+) 本/],
  ['profile/index.html', '年表の「いま」の本文（アプリ）', nApp, /アプリ (\d+) 本、拡張機能・ツール \d+ 本。紹介の記事は \d+ 本/],
  ['profile/index.html', '年表の「いま」の本文（ツール）', nTool, /アプリ \d+ 本、拡張機能・ツール (\d+) 本。紹介の記事は \d+ 本/],
  ['profile/index.html', '年表の「いま」の本文（記事）', nArticle, /アプリ \d+ 本、拡張機能・ツール \d+ 本。紹介の記事は (\d+) 本/],
];

/* 機械が書き出すページも見る。組み直したのに配り忘れた（コミットに入れ忘れた）
   ときは、ここだけが古い数字のまま残る。手で書く場所と同じ形で止める。 */
if (nArticle) {
  totals.push(
    ['apps/index.html', '題「アプリの紹介（◯ 本）」', nArticle, /<title>アプリの紹介（(\d+) 本）/],
    ['apps/index.html', '本文の「記事が ◯ 本あります」', nArticle, /まとめた記事が (\d+) 本あります/],
  );
}
totals.push(
  ['press/index.html', '数字の「公開中のアプリ」', nApp, /<dt>公開中のアプリ<\/dt><dd>(\d+) 本/],
  ['press/index.html', '数字の「Chrome 拡張機能ほか」', nTool, /<dt>Chrome 拡張機能ほか<\/dt><dd>(\d+) 本/],
  ['press/index.html', '数字の「紹介記事」', nArticle, /<dt>紹介記事<\/dt><dd>(\d+) 本/],
);

console.log(`  info アプリ ${nApp} 本 / 拡張機能・ツール ${nTool} 本 / 紹介記事 ${nArticle} 本`);
for (const [rel, where, want, re] of totals) {
  const src = page(rel);
  if (src === null) { ok(false, `${rel}：${where}`, 'ページが無い'); continue; }
  const found = src.match(re)?.[1];
  if (found === undefined) { ok(false, `${rel}：${where} は ${want} 本`, '書いてある場所が見つからない（文言が変わった？）'); continue; }
  ok(Number(found) === want, `${rel}：${where} は ${want} 本`, `${found} と書いてある`);
}

/* -----------------------------------------------------------------
 * 分類の表示名は tools/lib/categories.mjs を正本にして、紹介ページの
 * チップでも使っている。index.html の選択肢は手で書くので、
 * 言い回しを変えたときに片方だけ古くなる。ここで突き合わせておく。
 * --------------------------------------------------------------- */
console.log('\n■ 分類の表示名が、正本（categories.mjs）と同じ');
const optionLabel = (name, id) =>
  selectOf(name).match(new RegExp(`<option value="${id}">([^（<]*)`))?.[1]?.trim();

for (const [id, label] of Object.entries(CATEGORY_LABEL)) {
  ok(optionLabel('cat', id) === label, `教科・分野：${id} は「${label}」`,
     `index.html には「${optionLabel('cat', id)}」と書いてある`);
}
for (const [id, label] of Object.entries(USE_LABEL)) {
  ok(optionLabel('use', id) === label, `つかいかた：${id} は「${label}」`,
     `index.html には「${optionLabel('use', id)}」と書いてある`);
}

/* -----------------------------------------------------------------
 * 対象学年（data/apps.json の grades）。
 *
 * 値そのものの間違い（0 年生、7 年生、文字列）は止める。
 * まだ決めていないアプリがあることは止めない。決まった順に書き足す前提で、
 * どれが残っているかを毎回見えるようにしておく。
 * --------------------------------------------------------------- */
console.log('\n■ 対象学年の値が正しい');
const shown = apps.filter((a) => a.hidden !== true && a.slug);
const badGrade = shown.filter((a) => a.grades !== undefined
  && (!Array.isArray(a.grades)
      || a.grades.some((n) => !Number.isInteger(n) || n < 1 || n > 6)));
ok(badGrade.length === 0, '1〜6 の整数の配列になっている',
   badGrade.map((a) => `${a.slug}:${JSON.stringify(a.grades)}`).join(', '));

const undecided = shown.filter((a) => a.grades === undefined);
const withGrade = shown.filter((a) => Array.isArray(a.grades) && a.grades.length);
console.log(`  info 学年あり ${withGrade.length} 本 / 児童が使わないもの `
  + `${shown.length - withGrade.length - undecided.length} 本 / まだ決めていない ${undecided.length} 本`);
if (undecided.length) console.log(`       → ${undecided.map((a) => a.slug).join(', ')}`);

/* -----------------------------------------------------------------
 * 校内のフィルタリングで許可するアドレス（hosts）
 * -----------------------------------------------------------------
 * ⚠️ ここがずれると、先生が情報担当に出した申請が通ったのにアプリが開かない。
 *    先生からは「サイトの言うとおりにしたのに動かない」と見える。
 *    説明の無いアドレスを黙って素通りさせないよう、知らないものは止める。
 * --------------------------------------------------------------- */
console.log('\n■ 許可するアドレスの一覧が正しい');
/* Chrome の拡張機能（kind: tool）はサブドメインから配られないので、対象にしない */
const webApps = shown.filter((a) => a.kind === 'app');
const noHosts = webApps.filter((a) => !Array.isArray(a.hosts)).map((a) => a.slug);
ok(noHosts.length === 0, `Web アプリ ${webApps.length} 本すべてに hosts がある`, noHosts.join(', '));

const unknownHost = [...new Set(webApps.flatMap((a) => a.hosts ?? []))].filter((h) => !HOST_INFO[h]);
ok(unknownHost.length === 0, '説明の書かれていないアドレスが無い（tools/lib/hosts.mjs）',
   unknownHost.join(', '));

/* 自分のサブドメインは hostsOf() が必ず足す。hosts に書くと一覧に 2 回出る */
const selfDup = webApps.filter((a) => (a.hosts ?? []).some((h) => h.endsWith('giga-school.com')))
  .map((a) => a.slug);
ok(selfDup.length === 0, 'hosts に giga-school.com のアドレスが入っていない', selfDup.join(', '));

const filtering = readFileSync(new URL('../filtering/index.html', import.meta.url), 'utf8');
const missingRow = webApps.filter((a) => !filtering.includes(`${a.slug}.giga-school.com`)).map((a) => a.slug);
ok(missingRow.length === 0, `/filtering/ に ${webApps.length} 本すべての行がある`, missingRow.join(', '));

const missingHost = [...new Set(webApps.flatMap((a) => a.hosts ?? []))].filter((h) => !filtering.includes(h));
ok(missingHost.length === 0, '/filtering/ に、要るアドレスがすべて載っている', missingHost.join(', '));

console.log(`  info 外部が要らないアプリ ${webApps.filter((a) => !(a.hosts ?? []).length).length} 本`
  + ` / アドレスの種類 ${Object.keys(HOST_INFO).length}`);

/* -----------------------------------------------------------------
 * 開発記録（/devlog/）。
 *
 * ここに出るのはプロンプトの原文である。書いた本人には見えなくなっている
 * ものが混ざる。セッションのリンクは本人しか開けないので、載っていても
 * 画面を見て気づけない。**目で気づけないものだけを機械で止める。**
 *
 * ⚠️ 公開が 0 本のときは /devlog/ ごと無い。それは壊れではないので通す。
 *    build-devlog.mjs が「1 本も無ければディレクトリを消す」ようにしてある。
 * --------------------------------------------------------------- */
console.log('\n■ 開発記録が正しい');
const devlogIndexUrl = new URL('../data/devlog.json', import.meta.url);
const devlog = existsSync(devlogIndexUrl)
  ? JSON.parse(readFileSync(devlogIndexUrl, 'utf8')).items ?? []
  : [];

/* フッターは全ページから /devlog/ へ張ってある。0 本のときにディレクトリごと
   消すと、サイト中のフッターが 404 に飛ぶ。ここは本数に関係なく見る */
ok(existsSync(new URL('../devlog/index.html', import.meta.url)),
   '/devlog/index.html がある（フッターの行き先）');

if (!devlog.length) {
  console.log('  info 公開されている開発記録は 0 本');
} else {
  const bySlugAll = new Map(apps.map((a) => [a.slug, a]));
  const noField = devlog.filter((e) => !e.slug || !e.title || !e.date)
    .map((e) => e.name ?? '(名前が無い)');
  ok(noField.length === 0, `記録 ${devlog.length} 本すべてに app / title / date がある`, noField.join(', '));

  /* site はサイト自身の記録の枠。data/apps.json には載せていない
     （載せるとカードにも分類にも出てしまう）。build-devlog.mjs の SITE_APP と対。 */
  const unknownApp = [...new Set(devlog.map((e) => e.slug))]
    .filter((s2) => s2 !== 'site' && !bySlugAll.has(s2));
  ok(unknownApp.length === 0, 'app が data/apps.json に実在する（site を除く）', unknownApp.join(', '));

  /* 出してはいけないもの。組んだあとの HTML を見る。
     Markdown の側で消し忘れても、ここで最後に止まる */
  const pages = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(new URL(`${ent.name}/`, dir));
      else if (ent.name === 'index.html') pages.push(new URL(ent.name, dir));
    }
  };
  const devlogDir = new URL('../devlog/', import.meta.url);
  if (existsSync(devlogDir)) walk(devlogDir);
  ok(pages.length > 0, `/devlog/ のページが ${pages.length} 枚ある`);

  const leaked = pages.filter((u) => /claude\.ai\/code\/session_|\bsession_[0-9A-Za-z]{6,}/
    .test(readFileSync(u, 'utf8'))).map((u) => u.pathname.split('/').slice(-3, -1).join('/'));
  ok(leaked.length === 0, 'セッションのリンクが 1 件も無い', leaked.join(', '));

  const mailed = pages.filter((u) => /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i
    .test(readFileSync(u, 'utf8').replace(/<[^>]+>/g, ' ')))
    .map((u) => u.pathname.split('/').slice(-3, -1).join('/'));
  ok(mailed.length === 0, 'メールアドレスが 1 件も無い', mailed.join(', '));

  const appCount = new Set(devlog.map((e) => e.slug)).size;
  console.log(`  info 記録 ${devlog.length} 本 / アプリ ${appCount} 本`);
}

/* -----------------------------------------------------------------
 * 導入を決めるための項目（account / storage）。
 *
 * 「アカウント不要」は、学校が判断の前提にする言葉である。
 * 知らない値を黙って落とすと、書いたつもりのものが出ないまま気づけない。
 * 値の間違いは止める。まだ書いていないことは止めない。
 * --------------------------------------------------------------- */
console.log('\n■ 導入を決めるための項目が正しい');
const badAccount = shown.filter((a) => a.account !== undefined && !ACCOUNT_LABEL[a.account]);
ok(badAccount.length === 0, `account は ${Object.keys(ACCOUNT_LABEL).join(' / ')} のどれか`,
   badAccount.map((a) => `${a.slug}:${a.account}`).join(', '));
const badStorage = shown.filter((a) => a.storage !== undefined && !STORAGE_LABEL[a.storage]);
ok(badStorage.length === 0, `storage は ${Object.keys(STORAGE_LABEL).join(' / ')} のどれか`,
   badStorage.map((a) => `${a.slug}:${a.storage}`).join(', '));

const noAccount = shown.filter((a) => a.account === undefined);
const noStorage = shown.filter((a) => a.storage === undefined);
console.log(`  info アカウント ${shown.length - noAccount.length} 本 / `
  + `記録の置き場所 ${shown.length - noStorage.length} 本（全 ${shown.length} 本）`);
if (noAccount.length) console.log(`       アカウント未記入 → ${noAccount.map((a) => a.slug).join(', ')}`);

console.log(failed === 0 ? '\n✅ すべて通りました' : `\n❌ ${failed} 件 通りませんでした`);
process.exit(failed === 0 ? 0 : 1);
