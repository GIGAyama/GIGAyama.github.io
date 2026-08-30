#!/usr/bin/env node
/**
 * data/apps.json の日付を GitHub から取り直し、index.html の「更新情報」を書き直す。
 *
 *   node tools/sync-updates.mjs          日付はそのままに、index.html だけ組み直す
 *   node tools/sync-updates.mjs --fetch  GitHub を見に行って日付を更新してから組み直す
 *
 * 依存パッケージはない。Node 20 以降の fetch をそのまま使う。
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { CATEGORY_LABEL, CATEGORY_COLOR } from './lib/categories.mjs';
import { articleIndexPage, linkCards } from './lib/article-page.mjs';
import { CATEGORY_BASE, categoryPage, groupByCategory } from './lib/category-page.mjs';
import { filteringPage } from './lib/filtering-page.mjs';
import { searchIndex } from './lib/search-index.mjs';
import { pressPage } from './lib/press-page.mjs';
import { sitemap } from './lib/sitemap.mjs';
import { feed } from './lib/feed.mjs';
import { todayJst, jstDate } from './lib/dates.mjs';
import {
  normalizeLedger, serializeLedger, siteLastmod, stamp, stampStatic,
} from './lib/lastmod.mjs';
import { ghContentChangedAt } from './lib/gh.mjs';

const OWNER = 'GIGAyama';
const AGENT = 'giga-school-sync-updates';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const LEDGER = new URL('data/lastmod.json', ROOT);
const PROFILE = new URL('profile/index.html', ROOT);
const PAGE = new URL('index.html', ROOT);
const MAP = new URL('sitemap.xml', ROOT);
const ARTICLES = new URL('data/articles.json', ROOT);
const MANUALS = new URL('data/manuals.json', ROOT);
const APPS_INDEX = new URL('apps/index.html', ROOT);
const SEARCH = new URL('data/search-index.json', ROOT);
const PRESS = new URL('press/index.html', ROOT);
const FEED = new URL('feed.xml', ROOT);

/**
 * サイトに載せるものか。
 *
 * data/apps.json は 2 つの役目を持っている。サイトに載せる一覧と、
 * 旧アドレス（gigayama.github.io/<リポジトリ名>/）の転送表である。
 * 載せたくないものを一覧から消すと、配布済みの QR コードやプリントからの
 * 転送も一緒に壊れる。だから消さずに hidden を立てて、載せる側だけで外す。
 *
 * 転送は tools/check-404-redirect.mjs のとおり、hidden でも効かせたままにする。
 */
const shown = (item) => item.hidden !== true;

const NEW_LIMIT = 8;      // 「新しく公開したアプリ」に並べる数
const UPDATED_LIMIT = 6;  // 「最近手を入れたもの」に並べる日付の数

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const jpDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
};
const jpShort = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日`;
};

/** GitHub から公開日（リポジトリ作成日）と最終 push 日を取り直す。 */
async function refresh(items) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'giga-school-sync-updates',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  let changed = 0, failed = 0;

  /* 手元のトークンが他のリポジトリを読めないことがある。
     断られたら、認証なしでもう一度だけ試す（どれも公開リポジトリなので読める）。 */
  const load = async (url) => {
    let res = await fetch(url, { headers });
    if ((res.status === 401 || res.status === 403 || res.status === 404) && headers.authorization) {
      const { authorization, ...anon } = headers;
      res = await fetch(url, { headers: anon });
    }
    return res;
  };

  for (const item of items) {
    const url = `https://api.github.com/repos/${OWNER}/${item.repo}`;
    try {
      const res = await load(url);
      if (!res.ok) {
        if (res.status === 404) {
          console.warn(`  ${item.repo} が見つからない（削除された？）。`
            + 'data/apps.json と index.html から外す必要がある。');
        } else {
          console.warn(`  取得できず ${item.repo}: HTTP ${res.status}`);
        }
        failed++;
        continue;
      }
      const json = await res.json();
      const pushed = jstDate(json.pushed_at);
      const created = jstDate(json.created_at);
      /* publishedAt は最初のコミット日を手で入れてある。空のときだけ補う。 */
      if (!item.publishedAt && created) { item.publishedAt = created; changed++; }
      if (pushed && pushed !== item.updatedAt) { item.updatedAt = pushed; changed++; }

      /* 正本配布を除いた「本当に中身が変わった日」。
         ⚠️ updatedAt（push 日）と別に持つ。updatedAt を作り替えてはいけない
            —— tools/build-articles.mjs と tools/build-manuals.mjs が
            `a.publishedAt && a.updatedAt` の真偽で 42 本を絞っているので、
            意味を変えたり空にしたりすると**紹介ページが全部消える**。
         取れなかったときは空のままにする（sitemap 側が lastmod を出さない）。 */
      const content = await ghContentChangedAt(item.repo, AGENT);
      if (content !== (item.changedAt || '')) { item.changedAt = content; changed++; }
    } catch (e) {
      console.warn(`  取得できず ${item.repo}: ${e.message}`);
      failed++;
    }
  }
  console.log(`GitHub から取得：更新 ${changed} 件 / 失敗 ${failed} 件`);
  return items;
}

function row(item, iso) {
  const label = CATEGORY_LABEL[item.category] || '拡張機能・ツール';
  const color = CATEGORY_COLOR[item.category] || CATEGORY_COLOR.other;
  const href = item.slug
    ? `https://${item.slug}.giga-school.com/`
    : `https://github.com/${OWNER}/${item.repo}`;
  const rel = item.slug ? '' : ' rel="noopener"';
  return `            <li class="timeline__row" style="--cat:${color}">
              <time class="timeline__date" datetime="${iso}">${jpShort(iso)}</time>
              <a class="timeline__name" href="${href}"${rel}>${esc(item.name)}</a>
              <span class="timeline__tag">${esc(label)}</span>
            </li>`;
}

/** 同じ日にまとめて手を入れることが多いので、日付ごとに 1 行にまとめる。 */
function groupRow(iso, list) {
  const NAMES = 6;
  const shown = list.slice(0, NAMES).map((i) => {
    const href = i.slug
      ? `https://${i.slug}.giga-school.com/`
      : `https://github.com/${OWNER}/${i.repo}`;
    const rel = i.slug ? '' : ' rel="noopener"';
    return `<a class="timeline__name" href="${href}"${rel}>${esc(i.name)}</a>`;
  }).join('<span class="timeline__sep">・</span>');
  const rest = list.length - Math.min(list.length, NAMES);
  const more = rest > 0 ? `<span class="timeline__more">ほか ${rest} 本</span>` : '';
  return `            <li class="timeline__row timeline__row--group" style="--cat:${CATEGORY_COLOR.other}">
              <time class="timeline__date" datetime="${iso}">${jpShort(iso)}</time>
              <span class="timeline__names">${shown}${more}</span>
            </li>`;
}

/**
 * 「最近手を入れた」日。
 *
 * ⚠️ push 日（updatedAt）をそのまま出さない。正本配布が 42 本へ毎日 push する
 *    ので、41 本ぜんぶが同じ日になり、この節が 1 行に潰れる。changedAt は
 *    配布のコミットを除いた最後の更新日（tools/lib/gh.mjs）。
 *    取れなかったものだけ push 日へ逃がす。
 */
const touchedAt = (i) => i.changedAt || i.updatedAt;

function render(data) {
  const items = data.items.filter((i) => shown(i) && i.publishedAt && i.updatedAt);
  const apps = items.filter((i) => i.kind === 'app');
  const tools = items.filter((i) => i.kind === 'tool');

  const byNew = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const byUpdated = [...items]
    .filter((i) => touchedAt(i) && touchedAt(i) !== i.publishedAt)
    /* 同じ日のものは名前で決める。並びが日によって変わると、中身が同じでも
       ハッシュが動いて lastmod が毎日進む（tools/lib/lastmod.mjs の ⚠️ を見ること）。 */
    .sort((a, b) => touchedAt(b).localeCompare(touchedAt(a))
      || String(a.slug || a.repo).localeCompare(String(b.slug || b.repo)));

  const first = items.reduce((min, i) => (i.publishedAt < min ? i.publishedAt : min),
    items[0].publishedAt);

  const newRows = byNew.slice(0, NEW_LIMIT).map((i) => row(i, i.publishedAt)).join('\n');

  /* 日付ごとにまとめる。同じ日に何本も触ることが多いため。 */
  const byDate = new Map();
  byUpdated.forEach((i) => {
    if (!byDate.has(touchedAt(i))) byDate.set(touchedAt(i), []);
    byDate.get(touchedAt(i)).push(i);
  });
  const updRows = [...byDate.entries()]
    .slice(0, UPDATED_LIMIT)
    .map(([iso, list]) => groupRow(iso, list.sort((a, b) => a.name.localeCompare(b.name, 'ja'))))
    .join('\n');

  return `      <p class="updates__note">
        はじめて公開したのは <time datetime="${first}">${jpDate(first)}</time>。
        いま公開しているのは Web アプリ ${apps.length} 本と、拡張機能・ツール ${tools.length} 本です。
        この節は毎朝 GitHub を見て自動で書き直しています。
      </p>
      <div class="updates">
        <section class="updates__col" aria-labelledby="updates-new">
          <h3 class="updates__title" id="updates-new">新しく公開したもの</h3>
          <ol class="timeline">
${newRows}
          </ol>
        </section>
        <section class="updates__col" aria-labelledby="updates-touched">
          <h3 class="updates__title" id="updates-touched">最近手を入れたもの</h3>
          <ol class="timeline">
${updRows}
          </ol>
        </section>
      </div>`;
}


/** index.html の印（marker）で囲まれた部分だけを差し替える。 */
function replaceBlock(html, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = html.indexOf(start), j = html.indexOf(end);
  if (i === -1 || j === -1) throw new Error(`印が見つからない: ${name}`);
  return html.slice(0, i + start.length) + '\n' + body + '\n      ' + html.slice(j);
}

/**
 * index.html を組み直す。
 *
 * ⚠️ 日付（フッタの「最終更新」）を引数で受け取り、**2 回呼べる形**にしてある。
 *    1 回目は日付の場所に SENTINEL を入れて中身のハッシュを測るため、
 *    2 回目は決まった日付で書き出すため（tools/lib/lastmod.mjs の ⚠️ を見ること）。
 *    ここを main() の中に手続きで書き戻すと 2 回呼べなくなり、日付が毎朝動く形に戻る。
 */
function applyIndexEdits(raw, { data, articles, manuals }, lastmod) {
  let html = replaceBlock(raw, 'updates', render(data));

  /* 本数と最終更新日も、数え直した値に合わせる */
  const apps = data.items.filter((i) => shown(i) && i.kind === 'app').length;
  const tools = data.items.filter((i) => shown(i) && i.kind === 'tool').length;
  html = html
    .replace(/(<dt>公開中のアプリ<\/dt><dd>)\d+/, `$1${apps}`)
    .replace(/(<dt>拡張機能・ツール<\/dt><dd>)\d+/, `$1${tools}`)
    .replace(/(最終更新：<time datetime=")[\d-]+(">)[^<]+/,
      `$1${lastmod}$2${jpDate(lastmod)}`);

  /* トップのカードに「紹介を読む」と「使い方を見る」を貼る。
     ⚠️ ここは以前 tools/build-articles.mjs がやっていた。index.html を書くのは
        元々この道具の役目で、書き手が 2 人いること自体が順番の罠になっていた。
        しかも紹介とマニュアルは card__actions を丸ごと入れ替える作りなので、
        別々に貼ると、あとから貼ったほうが前のを消す。1 回でまとめて貼る。 */
  return linkCards(html, {
    articles: new Set(articles.map((a) => a.slug).filter(Boolean)),
    manuals: new Set(manuals.map((m) => m.slug).filter(Boolean)),
  }).html;
}

/** JSON を読む。無ければ（壊れていれば）既定値で進む。 */
async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

const main = async () => {
  const data = JSON.parse(await readFile(DATA, 'utf8'));

  /* ⚠️ 「今日」を知ってよいのは、ここと tools/lib/lastmod.mjs の resolveLastmod だけ。
        ページを組む関数へ渡さない。渡せるようにすると、いつか誰かが
        「日付が無いから今日でいいか」と書いて、元の壊れ方に戻る。 */
  const today = todayJst();

  /* 日付の台帳。無ければ空から始める（初回だけ、すべてのページが今日になる）。 */
  const ledger = normalizeLedger(await readJson(LEDGER, null));

  if (process.argv.includes('--fetch')) {
    /* hidden のものは見に行かない。取り下げたリポジトリが読めなくても、
       毎朝おなじ警告が出続けるだけで、直しようがないため。 */
    await refresh(data.items.filter(shown));
  }

  /* 紹介ページの一覧。まだ作っていなければ、無いものとして進む */
  const articles = (await readJson(ARTICLES, {})).items ?? [];
  /* 使い方マニュアル。tools/build-manuals.mjs が書き出す。0 本のこともある */
  const manuals = (await readJson(MANUALS, {})).items ?? [];
  /* 開発記録。tools/build-devlog.mjs が書き出す。公開 0 本のこともある */
  const devlog = (await readJson(new URL('data/devlog.json', ROOT), {})).items ?? [];

  /* ---------- トップページ ---------- */
  const rawIndex = await readFile(PAGE, 'utf8');
  const index = stamp(ledger, '/',
    (lm) => applyIndexEdits(rawIndex, { data, articles, manuals }, lm), today);
  await writeFile(PAGE, index.text);

  /* ---------- 紹介ページの一覧（/apps/）----------
     記事が 1 本も無いときは作らない。作ってしまうと、空のページがサイトマップと食い違う。 */
  if (articles.length) {
    await mkdir(new URL('apps/', ROOT), { recursive: true });
    const page = stamp(ledger, '/apps/',
      (lm) => articleIndexPage({ articles, apps: data.items, lastmod: lm }), today);
    await writeFile(APPS_INDEX, page.text);
  } else {
    delete ledger.pages['/apps/'];
  }

  /* ---------- 教科・分野ごとの入口（/apps/category/<id>/）----------
     8 分野ぶんを毎回書き直す。アプリが 1 本も無い分野は作らない。 */
  const groups = groupByCategory(data.items, articles);
  let cats = 0;
  for (const id of Object.keys(CATEGORY_LABEL)) {
    const key = `/${CATEGORY_BASE}/${id}/`;
    /* アプリが 1 本も無い分野は作らない。空のページがサイトマップと食い違う。
       前に作ってあれば消す。最後の 1 本を取り下げた分野のページが、
       中身のないまま検索に残り続けるのを避ける。
       ⚠️ 台帳からも消す。残すと、消したページの行がサイトマップに並び続ける。 */
    if (!groups.get(id).apps.length) {
      await rm(new URL(`${CATEGORY_BASE}/${id}/`, ROOT), { recursive: true, force: true });
      delete ledger.pages[key];
      continue;
    }
    await mkdir(new URL(`${CATEGORY_BASE}/${id}/`, ROOT), { recursive: true });
    const page = stamp(ledger, key, (lm) => categoryPage({ id, groups, lastmod: lm }), today);
    await writeFile(new URL(`${CATEGORY_BASE}/${id}/index.html`, ROOT), page.text);
    cats++;
  }

  /* ---------- 校内のフィルタリングに出す「許可するアドレス」の一覧 ----------
     29 本の記事がそれぞれ書いていたものを 1 枚にまとめる。
     data/apps.json の hosts から組み立てるので、アプリが増えても書き忘れない。
     ⚠️ Web アプリだけ。Chrome の拡張機能（kind: tool）は
        サブドメインから配られないので、許可するアドレスという話にならない。 */
  const webApps = data.items.filter((a) => a.slug && a.kind === 'app' && a.hidden !== true);
  await mkdir(new URL('filtering/', ROOT), { recursive: true });
  const filtering = stamp(ledger, '/filtering/',
    (lm) => filteringPage({ apps: webApps, lastmod: lm }), today);
  await writeFile(new URL('filtering/index.html', ROOT), filtering.text);

  /* ---------- 掲載用の資料（/press/）----------
     数字を手で書くと、ここだけ古くなって媒体に古い本数が載ることになる。毎回組み直す。 */
  await mkdir(new URL('press/', ROOT), { recursive: true });
  const press = stamp(ledger, '/press/',
    (lm) => pressPage({ apps: data.items, articles, lastmod: lm }), today);
  await writeFile(PRESS, press.text);

  /* ---------- 自己紹介（/profile/）----------
     どの道具も書き出していない静的なページなので、ファイルの中身を直に測る。
     これを入れるまで、ここだけ実行日が貼られていて、本当の日付が出ていなかった。 */
  try {
    stampStatic(ledger, '/profile/', await readFile(PROFILE, 'utf8'), today);
  } catch (e) {
    delete ledger.pages['/profile/'];         // ページごと無くなった
  }

  /* ---------- feed.xml と sitemap.xml ----------
     ⚠️ どちらの組み立てにも「今日」を渡さない。日付は上で台帳が決めたものと、
        記事・マニュアル・アプリがそれぞれ持っている「中身が変わった日」だけを使う。 */
  const stamps = Object.fromEntries(
    Object.entries(ledger.pages).map(([key, v]) => [key, v.lastmod]));
  const atom = feed({ data, articles, fallback: siteLastmod(ledger) });
  await writeFile(FEED, atom.xml);
  await writeFile(MAP,
    sitemap({ data, articles, devlog, manuals, stamps, feedUpdated: atom.updated }));

  /* generatedAt は「サイトの中身が最後に変わった日」。実行日ではない。
     ⚠️ 名前は変えない。tools/lib/search-index.test.mjs が見ているほか、
        build-articles / build-manuals もこの名前で読む。意味だけを直してある。 */
  /* ⚠️ 前の値を reduce の初期値に渡さない。台帳より新しい値がいちど入ると、
        以後どのページが変わっても**その値が最大のまま居座り続ける**。
        台帳が空のときだけ、前の値を残す。 */
  data.generatedAt = siteLastmod(ledger) || data.generatedAt || '';

  /* ---------- 紹介記事の中を探すための索引 ----------
     書き出し済みのページから作るので、GitHub を見に行かなくても作り直せる。
     検索の欄に触れるまで読み込まれない。 */
  if (articles.length) {
    const pages = [];
    for (const a of articles) {
      if (!a.slug) continue;
      try {
        pages.push({
          slug: a.slug,
          name: a.name,
          html: await readFile(new URL(`apps/${a.slug}/index.html`, ROOT), 'utf8'),
        });
      } catch (e) { /* まだ書き出されていない。次の朝には入る */ }
    }
    /* 使い方マニュアルも同じ索引に入れる。「印刷」「振り返り」のような、
       操作の言葉で探す人がいちばん困っているため。
       ⚠️ 行き先が /apps/<slug>/ ではないので、項目に u を持たせる。
          持たせないと、当たった節を押しても紹介ページの先頭へ飛ぶ。 */
    for (const m of manuals) {
      if (!m.slug) continue;
      try {
        pages.push({
          slug: m.slug,
          name: `${m.name}（使い方）`,
          url: `/apps/${m.slug}/manual/`,
          html: await readFile(new URL(`apps/${m.slug}/manual/index.html`, ROOT), 'utf8'),
        });
      } catch (e) { /* まだ書き出されていない。次の朝には入る */ }
    }
    await writeFile(SEARCH, searchIndex(pages, data.generatedAt));
  }

  await writeFile(DATA, JSON.stringify(data, null, 1) + '\n');
  await writeFile(LEDGER, serializeLedger(ledger));

  const apps = data.items.filter((i) => shown(i) && i.kind === 'app').length;
  const tools = data.items.filter((i) => shown(i) && i.kind === 'tool').length;
  const moved = Object.entries(ledger.pages).filter(([, v]) => v.lastmod === today).length;
  console.log(`更新情報を書き直した：アプリ ${apps} 本 / ツール ${tools} 本`
    + ` / 紹介 ${articles.length} 本 / 分類 ${cats} 枚`
    + ` / 中身が変わったページ ${moved} 枚（サイト全体の最終更新 ${data.generatedAt}）`);
};

/* ⚠️ import されたときは走らせない。以前はここが `await main();` だったので、
      読みこんだ瞬間に GitHub を叩いてファイルを書き出していた。
      tools/lib/sitemap.test.mjs のような検査が書けなかったのは、
      書き忘れではなく**この形のせい**だった（tools/check-lessons.mjs と同じ作法）。 */
const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) await main();

export { applyIndexEdits, render, main };
