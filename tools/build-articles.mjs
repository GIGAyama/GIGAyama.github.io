#!/usr/bin/env node
/**
 * 各アプリのリポジトリに置いてある note 記事を取ってきて、
 * giga-school.com/apps/<slug>/ の紹介ページとして書き出す。
 *
 *   node tools/build-articles.mjs          GitHub を見に行って組み直す
 *   node tools/build-articles.mjs --dry-run  書かずに結果だけ出す
 *
 * 依存パッケージはない。Node 20 以降の fetch をそのまま使う。
 *
 * ── なぜトップと同じドメインに置くのか ─────────────────
 *
 * giga-school.com は長らくトップ 1 ページだけだった。アプリはすべて
 * 別サブドメインで、しかも画面を JavaScript で描くものが多い。
 * 検索する側から見ると、読むものがどこにも無いサイトである。
 *
 * 記事は 1 本 5,000〜8,000 字あり、教室で使った人にしか書けない中身になっている。
 * これをトップと同じドメインに置くと、サイト全体の厚みになる。
 * サブドメイン側に散らすと、31 の薄いサイトが並ぶだけで、どれも育たない。
 *
 * ── 画像を取り込まない理由 ────────────────────────
 *
 * 記事 1 本で 20 枚前後、31 本ぶんで 717 枚・約 170MB ある。
 * このリポジトリに入れると clone も配信も重くなる。
 *
 * 画像はアプリのリポジトリに置いたまま、そのアプリのサブドメインから読む。
 * GitHub Pages はリポジトリの中身をそのまま配るので、たいていはそこで公開されている。
 *
 * ── ただし「たいてい」であって、いつもではない ──────────────
 *
 * Vite で dist/ を組んで、その dist/ だけを配っているアプリが 11 本ある。
 * こちらは docs/note/images/ が配信物に入らないので、サブドメインからは読めない。
 * ビルドに画像を足す手もあるが、あれらのリポジトリは dist の大きさを
 * 品質ゲートで見張っているので、数 MB の画面写真を入れると今度はそこで止まる。
 *
 * そこで、URL を組み立てたら実際に 1 枚たたいて確かめる。
 * 届かなければ raw.githubusercontent.com に切り替える。
 * 推測で決めると、配信の形が変わったときに黙って画像が消える。
 * 確かめて決めておけば、直したその翌朝から自動で戻る。
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { renderArticle } from './lib/article-md.mjs';
import { articlePage, headlineOf, linkCards, relatedOf, summaryOf } from './lib/article-page.mjs';

const OWNER = 'GIGAyama';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const INDEX = new URL('data/articles.json', ROOT);
const PAGE = new URL('index.html', ROOT);
const APPS_DIR = new URL('apps/', ROOT);

/** 記事のファイル名。XXX_automatic の ARTICLE_NAME と同じ見立て。 */
const ARTICLE_NAME = /note[-_]?article|article[-_]?note/i;

const headers = () => {
  const token = process.env.GITHUB_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'giga-school-build-articles',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
};

/* 手元のトークンが他のリポジトリを読めないことがある。
   断られたら、認証なしでもう一度だけ試す（どれも公開リポジトリなので読める）。
   sync-updates.mjs と同じ作り。 */
async function api(path) {
  const url = `https://api.github.com/repos/${OWNER}/${path}`;
  const h = headers();
  let res = await fetch(url, { headers: h });
  if ((res.status === 401 || res.status === 403 || res.status === 404) && h.authorization) {
    const { authorization, ...anon } = h;
    res = await fetch(url, { headers: anon });
  }
  return res;
}

/** そのリポジトリの Pages が docs/ を配っているか。画像の URL の形が変わる。 */
async function servesFromDocs(repo) {
  const res = await api(`${repo}/contents/docs/CNAME`);
  return res.status === 200;
}

/** その URL が実際に返ってくるか。画像 1 枚で配信の形を見分ける。 */
async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch (e) {
    return false;   // つながらないときは「届かない」側に倒す
  }
}

/**
 * 記事 1 本を取ってくる。無ければ null。
 * @returns {{path: string, markdown: string} | null}
 */
async function fetchArticle(repo) {
  const list = await api(`${repo}/contents/docs/note`);
  if (!list.ok) return null;                       // note を置いていないアプリ
  const entries = await list.json();
  if (!Array.isArray(entries)) return null;

  const hit = entries.find((e) =>
    e.type === 'file' && e.name.endsWith('.md') && ARTICLE_NAME.test(e.name));
  if (!hit) return null;

  const file = await api(`${repo}/contents/${hit.path}`);
  if (!file.ok) return null;
  const json = await file.json();
  if (json.encoding !== 'base64') return null;

  return { path: hit.path, markdown: Buffer.from(json.content, 'base64').toString('utf8') };
}

const main = async () => {
  const dry = process.argv.includes('--dry-run');
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  /* hidden は載せない。すでに作ってある紹介ページは、下の後始末で消える。 */
  const apps = data.items.filter((a) =>
    a.hidden !== true && a.slug && a.publishedAt && a.updatedAt);

  const built = [];
  const pages = [];     // 2 周目で書き出すための材料
  let missing = 0;
  let failed = 0;

  for (const app of apps) {
    let got;
    try {
      got = await fetchArticle(app.repo);
    } catch (e) {
      console.warn(`  取得できず ${app.repo}: ${e.message}`);
      failed++;
      continue;
    }
    if (!got) { missing++; continue; }

    /* 記事は docs/note/ にあり、画像は docs/note/images/ を相対で指している。
       配信元が docs/ なら note/ から、リポジトリ全体なら docs/note/ から見える。 */
    const docsIsRoot = await servesFromDocs(app.repo);
    const dir = got.path.replace(/\/[^/]*$/, '');                 // docs/note
    const resolve = (target) => `${dir}/${String(target).replace(/^\.\//, '')}`;

    const under = (prefix) => (target) =>
      /^[a-z][a-z0-9+.-]*:/i.test(target)          // すでに絶対 URL のものは触らない
        ? target
        : prefix(resolve(target));

    /* まずは自分のドメインで組む。読み手にとってはこちらが本筋 */
    const onSubdomain = under((path) =>
      `https://${app.slug}.giga-school.com/${docsIsRoot ? path.replace(/^docs\//, '') : path}`);
    /* 届かなかったときの逃げ道。HEAD は既定のブランチを指す */
    const onRaw = under((path) => `https://raw.githubusercontent.com/${OWNER}/${app.repo}/HEAD/${path}`);

    let article = renderArticle(got.markdown, { imageUrl: onSubdomain });
    let imageHost = 'subdomain';
    const first = article.images[0]?.src;
    if (first && !(await reachable(first))) {
      article = renderArticle(got.markdown, { imageUrl: onRaw });
      imageHost = 'raw';
      console.warn(`  画像はサブドメインから読めない ${app.repo} → raw に切り替えた`);
    }
    if (!article.title || article.charCount < 1200) {
      console.warn(`  中身が足りない ${app.repo}（題:${article.title ? 'あり' : 'なし'} / ${article.charCount}字）`);
      failed++;
      continue;
    }

    /* ここでは書き出さない。「ほかの紹介」を出すには 31 本ぶんの題が要るので、
       全部そろってから 2 周目で書き出す（下の「ページを書き出す」）。 */
    pages.push({ app, article });

    built.push({
      slug: app.slug,
      repo: app.repo,
      name: app.name,
      title: article.title,
      headline: headlineOf(article.title),
      summary: summaryOf(article.lead),
      source: got.path,
      images: article.images.length,
      imageHost,
      charCount: article.charCount,
      updatedAt: app.updatedAt,
    });
    console.log(`  ✅ ${app.name}（${article.charCount}字 / 画像 ${article.images.length}枚 / ${imageHost}）`);
  }

  built.sort((a, b) => a.slug.localeCompare(b.slug));

  /* ---------- ページを書き出す（2 周目） ----------
     記事どうしをつなぐには、31 本ぶんの題と公開日がそろっている必要がある。
     並びは /apps/ の一覧と同じ「新しく公開した順」にして、前後の記事が
     一覧の並びと食い違わないようにする。 */
  const byslug = new Map(data.items.map((i) => [i.slug, i]));
  const all = built
    .map((b) => ({
      slug: b.slug,
      name: b.name,
      headline: b.headline,
      category: byslug.get(b.slug)?.category || 'other',
      publishedAt: byslug.get(b.slug)?.publishedAt || '1970-01-01',
    }))
    .sort((x, y) => (y.publishedAt || '').localeCompare(x.publishedAt || '')
      || String(x.name).localeCompare(String(y.name), 'ja'));

  for (const { app, article } of pages) {
    const { related, prev, next } = relatedOf(app.slug, all);
    const html = articlePage({ app, article, related, prev, next });
    if (!dry) {
      const dir = new URL(`${app.slug}/`, APPS_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(new URL('index.html', dir), html);
    }
  }

  if (!dry) {
    /* 前回あって今回消えた紹介ページを残さない。
       記事を取り下げたのにページだけ生き続けると、サイトマップと食い違う。 */
    const keep = new Set(built.map((b) => b.slug));
    /* apps ではなく data.items 全部を見る。hidden を立てた直後は apps から
       外れているので、apps だけを見ると、前に作ったページが消し残る。 */
    for (const item of data.items) {
      if (!item.slug || keep.has(item.slug)) continue;
      await rm(new URL(`${item.slug}/`, APPS_DIR), { recursive: true, force: true });
    }
    await writeFile(INDEX, JSON.stringify({
      _comment: 'tools/build-articles.mjs が書き出す。手で書き足さない。',
      generatedAt: data.generatedAt,
      items: built,
    }, null, 1) + '\n');

    const page = await readFile(PAGE, 'utf8');
    const { html: linked, added } = linkCards(page, keep);
    await writeFile(PAGE, linked);
    console.log(`  カードに貼ったリンク: ${added} 本`);
  }

  console.log(`\n紹介ページ ${built.length} 本 / 記事なし ${missing} 本 / 作れず ${failed} 本`
    + (dry ? '（--dry-run のため書いていない）' : ''));
  if (failed) process.exitCode = 1;
};

await main();
