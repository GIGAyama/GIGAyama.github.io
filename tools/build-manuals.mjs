#!/usr/bin/env node
/**
 * 各アプリのリポジトリに置いてある使い方マニュアルを取ってきて、
 * giga-school.com/apps/<slug>/manual/ として書き出す。
 *
 *   node tools/build-manuals.mjs            GitHub を見に行って組み直す
 *   node tools/build-manuals.mjs --dry-run  書かずに結果だけ出す
 *   node tools/build-manuals.mjs --repo Qalc  1 本だけ
 *
 * 依存パッケージはない。Node 20 以降の fetch をそのまま使う。
 *
 * ── なぜ紹介記事とは別に要るのか ─────────────────────
 *
 * アプリのフッターにある「使い方を読む」の行き先は、長らく紹介記事だった。
 * あれは先生に向けて「なぜ作ったか」を書いたもので、いま画面の前にいて
 * 「このボタンは何ですか」と困っている人が求めているものではない。
 *
 * ── 置き場と名前 ──────────────────────────────
 *
 * docs/manual/manual.md の決め打ち。記事（docs/note/*note-article*.md）が
 * 正規表現なのは、32 本の repo にすでにある名前を後から拾ったからで、
 * マニュアルはこれから作るので、揺れる前に固定した。
 *
 * ⚠️ ただし「決め打ちにして黙って飛ばす」ことはしない。docs/manual/ が
 *    あるのに manual.md が無いときは、見つかった名前を添えて警告を出す。
 *    書いたのに出ない、がいちばん気づけない。
 *
 * ── 画像を取りこまない理由も、記事と同じ ────────────────
 *
 * アプリのリポジトリに置いたまま、そのアプリのサブドメインから読む。
 * 届かなければ raw.githubusercontent.com に切り替える。推測で決めず、
 * 実際に 1 枚たたいて確かめる（tools/lib/gh.mjs の reachable）。
 *
 * ⚠️ 控えの置き場は /assets/manual/ で、記事の /assets/article/ とは分ける。
 *    どちらも 01-home.png のような名前になるので、同じ入れ物では必ず衝突する。
 *
 * ── 「いつの画面か」で嘘をつかない ───────────────────
 *
 * 更新日はアプリの最終 push ではなく、manual.md 自身が最後に変わった日を使う。
 * マニュアルは印刷して配られるものなので、コードを 1 行直しただけの朝に
 * 「今日現在の画面です」と出るのは嘘になる。
 */

import { mkdir, readFile, readdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { renderArticle } from './lib/article-md.mjs';
import { pickImageUrl } from './lib/article-images.mjs';
import { manualPage } from './lib/manual-page.mjs';
import { summaryOf } from './lib/article-page.mjs';
import {
  ghFileChangedAt, ghFindDoc, ghListMarkdown, ghText, imageResolvers, reachable,
  servesFromDocs, RAW,
} from './lib/gh.mjs';

const AGENT = 'giga-school-build-manuals';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const INDEX = new URL('data/manuals.json', ROOT);
const MIRROR_NEEDS = new URL('data/manual-images.json', ROOT);
const ARTICLES = new URL('data/articles.json', ROOT);
const APPS_DIR = new URL('apps/', ROOT);

/** マニュアルの置き場と名前。giga-manual スキルと同じ約束。 */
const MANUAL_DIR = 'docs/manual';
const MANUAL_NAME = 'manual.md';

/**
 * マニュアル 1 本を取ってくる。無ければ null。
 * 置き場はあるのに名前が違うときは、理由を言ってから null を返す。
 */
async function fetchManual(repo) {
  const got = await ghFindDoc(repo, MANUAL_DIR, (name) => name === MANUAL_NAME, AGENT);
  if (got) return got;

  /* 置き場ごと無いのか、名前が違うだけなのかを分ける。
     後者は「書いたのに出ない」なので、黙って飛ばさない。 */
  const names = await ghListMarkdown(repo, MANUAL_DIR, AGENT);
  if (names.length) {
    console.warn(`  ⚠️ ${repo}: ${MANUAL_DIR}/ はあるが ${MANUAL_NAME} が無い`
      + `（見つかったのは ${names.join(', ')}）`);
  }
  return null;
}

/**
 * manual.md が最後に変わった日。取れなければ空文字。
 *
 * 中身は tools/lib/gh.mjs の ghFileChangedAt に移した。同じ考え方が紹介記事にも
 * 要ったため（あちらは app.updatedAt を使っていて、sitemap の 90 URL 中 88 が
 * 同じ日付になる原因になっていた）。⚠️ の理由書きも向こうに移してある。
 */
const manualChangedAt = (repo) =>
  ghFileChangedAt(repo, `${MANUAL_DIR}/${MANUAL_NAME}`, AGENT);

/**
 * 利用規約とプライバシーポリシーが、実際に届くか。
 *
 * ⚠️ 推測で出さない。37 本は持っているが、全部ではない。
 *    押した先が 404 になるくらいなら、リンクを出さないほうがいい。
 *    確かめて台帳に残しておけば、置いたその翌朝から自動で出る。
 */
async function legalUrls(slug) {
  const of = (name) => `https://${slug}.giga-school.com/${name}`;
  const [terms, privacy] = await Promise.all([
    reachable(of('terms.html')), reachable(of('privacy.html')),
  ]);
  return { termsUrl: terms ? of('terms.html') : '', privacyUrl: privacy ? of('privacy.html') : '' };
}

const main = async () => {
  const dry = process.argv.includes('--dry-run');
  /* ⚠️ indexOf は見つからないと -1 を返す。そのまま +1 すると argv[0]
     （node 自身の道）を拾い、どのアプリにも当たらないので「0 本」になる。
     しかも後始末まで止まるので、静かに何もしない道具になる。実際そうなっていた。 */
  const at = process.argv.indexOf('--repo');
  const only = at === -1 ? '' : (process.argv[at + 1] ?? '');
  const data = JSON.parse(await readFile(DATA, 'utf8'));

  /* 紹介記事のあるアプリ。パンくずと導線を出すかどうかに使う。
     まだ組んでいなければ「無い」として進む（明日の朝には入る）。 */
  let hasArticle = new Set();
  try {
    const list = JSON.parse(await readFile(ARTICLES, 'utf8')).items ?? [];
    hasArticle = new Set(list.map((a) => a.slug).filter(Boolean));
  } catch (e) { /* data/articles.json がまだ無い */ }

  const apps = data.items.filter((a) =>
    a.hidden !== true && a.slug && a.publishedAt && a.updatedAt
    && (!only || a.repo === only || a.slug === only));

  /* 前回の台帳。「まだ 1 本も無い」と「在ったのに取れなかった」を分けるために読む。
     この 2 つは結果だけ見ると同じ形をしていて、区別できるのは前回の本数しかない。 */
  let before = [];
  try {
    before = JSON.parse(await readFile(INDEX, 'utf8')).items ?? [];
  } catch (e) { /* data/manuals.json がまだ無い。初めての朝 */ }

  /* 控えが要る一覧も、--repo のときに他のアプリを落とさないよう前回ぶんを読む */
  let beforeMirror = {};
  try {
    beforeMirror = JSON.parse(await readFile(MIRROR_NEEDS, 'utf8')).apps ?? {};
  } catch (e) { /* data/manual-images.json がまだ無い */ }

  const built = [];
  const pages = [];
  const mirrorNeeds = {};
  /* 取れなかったアプリ。後始末で「マニュアルが無くなった」と取り違えないために持つ */
  const failedSlugs = new Set();
  let missing = 0;
  let failed = 0;

  for (const app of apps) {
    let got;
    try {
      got = await fetchManual(app.repo);
    } catch (e) {
      console.warn(`  取得できず ${app.repo}: ${e.message}`);
      failed++;
      failedSlugs.add(app.slug);
      continue;
    }
    if (!got) { missing++; continue; }

    const docsIsRoot = await servesFromDocs(app.repo, AGENT);
    const dir = got.path.replace(/\/[^/]*$/, '');                 // docs/manual
    const { onSubdomain, onMirror, onRaw } = imageResolvers({
      repo: app.repo, slug: app.slug, dir, docsIsRoot, mirrorDir: '/assets/manual',
    });

    let manual = renderArticle(got.markdown, { imageUrl: onSubdomain });
    let imageHost = 'subdomain';
    let needMirror = null;
    const first = manual.images[0]?.src;
    if (first && !(await reachable(first))) {
      /* 控えがあるかは 1 枚ずつ見る。理由は tools/lib/article-images.mjs にある */
      const inMirror = new Set(
        await readdir(new URL(`assets/manual/${app.slug}/`, ROOT)).catch(() => []));
      const pick = pickImageUrl({ inMirror, onMirror, onRaw });
      const seen = [];
      manual = renderArticle(got.markdown,
        { imageUrl: (target) => { seen.push(target); return pick(target); } });
      imageHost = inMirror.size ? 'mirror' : 'raw';
      needMirror = seen.map(onRaw);
      console.warn(`  画像はサブドメインから読めない ${app.repo} → `
        + (inMirror.size ? '自分のドメインの控えを使う' : 'raw に切り替えた（控えが無い）'));
    }

    /* 出せる中身かを見る。ここは書き手の手元の lint（giga-manual スキル）を
       通していないものが来ることを前提にしている。tools/build-devlog.mjs と同じ考え。
       ⚠️ 画面写真 0 枚を落とすのは、「どのボタンを押せば何ができるか」を
          伝えるのがマニュアルだから。文章だけのものは公開しない。 */
    const chapters = manual.headings.filter((h) => h.level === 2).length;
    if (!manual.title || chapters < 2 || !manual.images.length || manual.charCount < 400) {
      console.warn(`  マニュアルとして足りない ${app.repo}`
        + `（題:${manual.title ? 'あり' : 'なし'} / 章 ${chapters}`
        + ` / 画面写真 ${manual.images.length}枚 / ${manual.charCount}字）`);
      failed++;
      failedSlugs.add(app.slug);
      continue;
    }

    const updatedAt = (await manualChangedAt(app.repo)) || app.updatedAt;
    const legal = await legalUrls(app.slug);

    built.push({
      slug: app.slug,
      repo: app.repo,
      name: app.name,
      title: manual.title,
      summary: summaryOf(manual.lead),
      source: got.path,
      chapters,
      images: manual.images.length,
      imageHost,
      charCount: manual.charCount,
      updatedAt,
      ...legal,
    });
    if (needMirror) mirrorNeeds[app.slug] = { repo: app.repo, images: needMirror };
    pages.push({ app, manual, updatedAt, legal });
  }

  for (const { app, manual, updatedAt, legal } of pages) {
    const html = manualPage({
      app, manual, updatedAt,
      hasArticle: hasArticle.has(app.slug),
      changelog: await ghText(app.repo, 'docs/CHANGELOG.md', AGENT),
      ...legal,
    });
    if (!dry) {
      const dir = new URL(`${app.slug}/${'manual'}/`, APPS_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(new URL('index.html', dir), html);
    }
    console.log(`  ${app.slug}  ${manual.headings.filter((h) => h.level === 2).length} 章`
      + ` / 画面写真 ${manual.images.length} 枚 / ${manual.charCount} 字`);
  }

  if (!dry) {
    const keep = new Set(built.map((b) => b.slug));

    /* ⚠️ 1 本も組めなかったときは、1 枚も消さない。
       GitHub が見えない朝には全部が「マニュアルなし」になるので、そのまま
       後始末をすると、公開済みのマニュアルを全部消してコミットしてしまう。
       build-articles.mjs で実際に踏んだのと同じ形（2026-08-29）。

       ⚠️ ただし --repo で 1 本だけ組んだときは、そもそも後始末をしない。
          見ていないアプリを「無くなった」と決めつけることになる。 */
    if (only) {
      console.log('  （--repo が付いているので、後始末はしない）');
    } else if (!built.length) {
      /* まだ 1 本も置かれていないのは、ふつうのこと（当面 38 本がそう）。
         前は在ったのに今回 0 本になったときだけ、声を上げる。 */
      const had = before.length;
      if (had) {
        console.warn(`  ⚠️ 前は ${had} 本あったのに 1 本も取れなかった。`
          + '後始末をせず、いまあるページを残す');
        console.warn('     （GitHub が見えていない可能性が高い。全部消してしまわないため）');
      } else {
        console.log('  まだどのアプリにも docs/manual/ が無い');
      }
    } else {
      for (const item of data.items) {
        if (!item.slug || keep.has(item.slug)) continue;
        if (failedSlugs.has(item.slug)) {
          console.warn(`  取れなかったので、いまあるページを残す: ${item.slug}`);
          continue;
        }
        /* マニュアルだけを消す。紹介ページ（apps/<slug>/index.html）は
           build-articles.mjs の持ち物なので触らない。 */
        await rm(new URL(`${item.slug}/manual/index.html`, APPS_DIR), { force: true });
        await rmdir(new URL(`${item.slug}/manual/`, APPS_DIR)).catch(() => {});
        await rmdir(new URL(`${item.slug}/`, APPS_DIR)).catch(() => {});
      }
    }

    /* ⚠️ --repo で 1 本だけ組んだときに built でそのまま上書きすると、
       **前から載っていた行が台帳から消える。** 後始末は止めてあるので
       ページは残り、台帳だけが欠ける。トップの導線も検索の索引も台帳を
       見ているので、ページは在るのにどこからも辿れない形になる。
       2026-08-30 に実際に踏んだ（週案エディタが 1 本消えた）。
       前回のぶんに重ねる。 */
    const items = only
      ? [...new Map([...before, ...built].map((x) => [x.slug, x])).values()]
        .sort((a, b) => a.slug.localeCompare(b.slug))
      : built.sort((a, b) => a.slug.localeCompare(b.slug));

    await writeFile(INDEX, JSON.stringify({
      _comment: 'tools/build-manuals.mjs が書き出す。手で書き足さない。',
      generatedAt: data.generatedAt,
      items,
    }, null, 1) + '\n');

    await writeFile(MIRROR_NEEDS, JSON.stringify({
      _comment: 'tools/build-manuals.mjs が書き出す。手で書き足さない。'
        + ' サブドメインから画像が読めないマニュアルと、その元の URL。',
      generatedAt: data.generatedAt,
      apps: Object.fromEntries(
        Object.entries(only ? { ...beforeMirror, ...mirrorNeeds } : mirrorNeeds)
          .sort(([a], [b]) => a.localeCompare(b))),
    }, null, 1) + '\n');
  }

  console.log(`\n使い方マニュアル ${built.length} 本 / マニュアルなし ${missing} 本`
    + ` / 作れず ${failed} 本` + (dry ? '（--dry-run のため書いていない）' : ''));

  /* ⚠️ ここで異常終了しない。この道具は朝の流れのいちばん先に走るので、
     止めると、その日の紹介ページも一覧も検索の索引も、まるごと組み直されない。
     マニュアル 1 本の書式ミスで、サイト全体の組み直しを捨てるのは割に合わない。

     声は上に出してある。食い違いは、コミットの「あと」に走る
     tools/check-cards.mjs が拾う（ワークフローが「赤はやり残しの一覧として
     読む」形にしてあるのと同じ考え方）。 */
};

/* ⚠️ 取りこんだだけで走らせない。書き出しも削除もする道具なので、
   import した拍子に本番の生成物を書き替えてしまう。 */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
