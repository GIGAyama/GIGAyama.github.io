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

import { CATEGORY_LABEL, CATEGORY_COLOR } from './lib/categories.mjs';
import { articleIndexPage } from './lib/article-page.mjs';
import { CATEGORY_BASE, categoryPage, groupByCategory } from './lib/category-page.mjs';
import { pressPage } from './lib/press-page.mjs';

const OWNER = 'GIGAyama';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const PAGE = new URL('index.html', ROOT);
const MAP = new URL('sitemap.xml', ROOT);
const ARTICLES = new URL('data/articles.json', ROOT);
const APPS_INDEX = new URL('apps/index.html', ROOT);
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
      const pushed = (json.pushed_at || '').slice(0, 10);
      const created = (json.created_at || '').slice(0, 10);
      /* publishedAt は最初のコミット日を手で入れてある。空のときだけ補う。 */
      if (!item.publishedAt && created) { item.publishedAt = created; changed++; }
      if (pushed && pushed !== item.updatedAt) { item.updatedAt = pushed; changed++; }
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

function render(data) {
  const items = data.items.filter((i) => shown(i) && i.publishedAt && i.updatedAt);
  const apps = items.filter((i) => i.kind === 'app');
  const tools = items.filter((i) => i.kind === 'tool');

  const byNew = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const byUpdated = [...items]
    .filter((i) => i.updatedAt !== i.publishedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const first = items.reduce((min, i) => (i.publishedAt < min ? i.publishedAt : min),
    items[0].publishedAt);

  const newRows = byNew.slice(0, NEW_LIMIT).map((i) => row(i, i.publishedAt)).join('\n');

  /* 日付ごとにまとめる。同じ日に何本も触ることが多いため。 */
  const byDate = new Map();
  byUpdated.forEach((i) => {
    if (!byDate.has(i.updatedAt)) byDate.set(i.updatedAt, []);
    byDate.get(i.updatedAt).push(i);
  });
  const updRows = [...byDate.entries()]
    .slice(0, UPDATED_LIMIT)
    .map(([iso, list]) => groupRow(iso, list.sort((a, b) => a.name.localeCompare(b.name, 'ja'))))
    .join('\n');

  return `      <p class="updates__note">
        はじめて公開したのは <time datetime="${first}">${jpDate(first)}</time>。
        いま公開しているのは Web アプリ ${apps.length} 本と、拡張機能・ツール ${tools.length} 本です。
        この節は毎日 GitHub を見て自動で書き直しています（${jpDate(data.generatedAt)}時点）。
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

/**
 * sitemap.xml を組み立てる。
 *
 * トップページのほかに、各アプリのサブドメイン（<slug>.giga-school.com）も載せる。
 * アプリは 1 本ずつ別のホストなので、トップページを見ただけでは Google が
 * すべてを追い切れない。ここに並べておくと取りこぼしが減る。
 *
 * 別ホストの URL を 1 つのサイトマップに書けるのは、Search Console で
 * giga-school.com を「ドメイン プロパティ」として登録し、サブドメインまで
 * 所有権が確認できている場合。URL プレフィックスのプロパティしかないと、
 * サブドメインの行は無視される。
 *
 * lastmod は各リポジトリの最終 push 日（updatedAt）。slug のないものは
 * 公開先が GitHub 側なので、ここには載せない。
 *
 * 紹介ページ（/apps/<slug>/）も載せる。一覧は tools/build-articles.mjs が
 * data/articles.json に書き出す。まだ無いときは、アプリの行だけで組む。
 */
/**
 * 更新を追えるようにする（Atom）。
 *
 * 一度アプリに辿り着いた人が、次に何が出たかを知る手段がサイトに無かった。
 * X と note は続けるかどうかが本人次第だが、フィードは置いておけば勝手に届く。
 *
 * 中身は「読むもの」に絞る。紹介記事と、記事がまだ無い新しいアプリ。
 * 「最近手を入れたもの」は入れない。細かい push が流れ続けるだけで、
 * 購読している側にとっては報せる値打ちが無い。
 *
 * 日付は data/apps.json の YYYY-MM-DD しか持っていないので、
 * その日の始まり（日本時間）として書く。時刻まで正確である必要はない。
 */
function feed(data, articles = []) {
  const SITE = 'https://giga-school.com';
  const stamp = (iso) => `${iso}T00:00:00+09:00`;
  const byslug = new Map(data.items.map((i) => [i.slug, i]));
  const hasArticle = new Set(articles.map((a) => a.slug));

  /* 紹介記事。読むものとしては、これが本体 */
  const fromArticles = articles
    .filter((a) => a.slug && byslug.get(a.slug) && shown(byslug.get(a.slug)))
    .map((a) => {
      const app = byslug.get(a.slug);
      return {
        id: `${SITE}/apps/${a.slug}/`,
        href: `${SITE}/apps/${a.slug}/`,
        title: a.headline || a.title,
        summary: a.summary,
        published: app.publishedAt,
        updated: a.updatedAt || app.updatedAt,
        category: CATEGORY_LABEL[app.category] || CATEGORY_LABEL.other,
      };
    });

  /* 記事がまだ無いアプリ。公開したこと自体は報せる値打ちがある */
  const fromApps = data.items
    .filter((i) => shown(i) && i.slug && i.publishedAt && !hasArticle.has(i.slug))
    .map((i) => ({
      id: `https://${i.slug}.giga-school.com/`,
      href: `https://${i.slug}.giga-school.com/`,
      title: i.name,
      summary: `${i.name} を公開しました。`,
      published: i.publishedAt,
      updated: i.updatedAt || i.publishedAt,
      category: CATEGORY_LABEL[i.category] || CATEGORY_LABEL.other,
    }));

  /* 新しく公開した順。多すぎても読まれないので 20 件で切る */
  const entries = [...fromArticles, ...fromApps]
    .sort((a, b) => (b.published || '').localeCompare(a.published || '')
      || String(a.title).localeCompare(String(b.title), 'ja'))
    .slice(0, 20);

  /* フィード自体の更新日は、いちばん新しい記事に合わせる */
  const latest = entries.reduce((m, e) => (e.updated > m ? e.updated : m), data.generatedAt);

  const body = entries.map((e) => `  <entry>
    <title>${esc(e.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(e.href)}"/>
    <id>${esc(e.id)}</id>
    <published>${stamp(e.published)}</published>
    <updated>${stamp(e.updated)}</updated>
    <category term="${esc(e.category)}"/>
    <summary type="text">${esc(e.summary)}</summary>
  </entry>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- tools/sync-updates.mjs が data/apps.json と data/articles.json から書き出す。手で書き足さない。 -->
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
  <title>GIGA school｜学校で使える Web アプリ</title>
  <subtitle>小学校の教員がつくった Web アプリと、その紹介記事の更新</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${stamp(latest)}</updated>
  <author>
    <name>GIGAyama</name>
    <uri>${SITE}/</uri>
  </author>
  <rights>© GIGAyama</rights>
${body}
</feed>
`;
}

function sitemap(data, articles = []) {
  const url = (loc, lastmod, changefreq, priority) =>
    `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

  const entries = [url('https://giga-school.com/', data.generatedAt, 'weekly', '1.0')];

  /* 紹介ページの一覧。記事が増えるたびに変わる */
  if (articles.length) {
    entries.push(url('https://giga-school.com/apps/', data.generatedAt, 'weekly', '0.9'));
    /* フィードも載せておく。更新の速いページとしてクローラに拾わせる */
    entries.push(url('https://giga-school.com/feed.xml', data.generatedAt, 'daily', '0.5'));
  }
  /* 教科・分野ごとの入口。「国語 アプリ 小学校」で探している人の着地点になる。
     トップページの絞り込み（?cat=）は JavaScript が要るうえ、行き先が
     トップページ 1 枚なので、検索の受け皿にならない */
  Object.keys(CATEGORY_LABEL).forEach((id) => {
    entries.push(url(`https://giga-school.com/${CATEGORY_BASE}/${id}/`,
      data.generatedAt, 'weekly', '0.7'));
  });
  /* 自己紹介。だれがつくっているのかは、学校で使うかどうかの判断材料になる */
  entries.push(url('https://giga-school.com/profile/', data.generatedAt, 'monthly', '0.5'));
  /* 掲載用の資料。めったに変わらないが、媒体の担当者に見つけてほしい */
  entries.push(url('https://giga-school.com/press/', data.generatedAt, 'monthly', '0.4'));

  /* 紹介ページ。アプリ本体より先に置く。中身のある文章はこちらにある */
  articles
    .filter((a) => a.slug && a.updatedAt)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach((a) => {
      entries.push(url(`https://giga-school.com/apps/${a.slug}/`, a.updatedAt, 'monthly', '0.9'));
    });

  data.items
    .filter((i) => shown(i) && i.slug && i.updatedAt)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach((i) => {
      entries.push(url(`https://${i.slug}.giga-school.com/`, i.updatedAt, 'monthly',
        i.kind === 'app' ? '0.8' : '0.6'));
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- tools/sync-updates.mjs が data/apps.json から書き出す。手で書き足さない。 -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

/** index.html の印（marker）で囲まれた部分だけを差し替える。 */
function replaceBlock(html, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = html.indexOf(start), j = html.indexOf(end);
  if (i === -1 || j === -1) throw new Error(`印が見つからない: ${name}`);
  return html.slice(0, i + start.length) + '\n' + body + '\n      ' + html.slice(j);
}

const main = async () => {
  const data = JSON.parse(await readFile(DATA, 'utf8'));

  if (process.argv.includes('--fetch')) {
    /* hidden のものは見に行かない。取り下げたリポジトリが読めなくても、
       毎朝おなじ警告が出続けるだけで、直しようがないため。 */
    await refresh(data.items.filter(shown));
    data.generatedAt = new Date().toISOString().slice(0, 10);
  }

  let html = await readFile(PAGE, 'utf8');
  html = replaceBlock(html, 'updates', render(data));

  /* 本数と最終更新日も、数え直した値に合わせる */
  const apps = data.items.filter((i) => shown(i) && i.kind === 'app').length;
  const tools = data.items.filter((i) => shown(i) && i.kind === 'tool').length;
  html = html
    .replace(/(<dt>公開中のアプリ<\/dt><dd>)\d+/, `$1${apps}`)
    .replace(/(<dt>拡張機能・ツール<\/dt><dd>)\d+/, `$1${tools}`)
    .replace(/(最終更新：<time datetime=")[\d-]+(">)[^<]+/,
      `$1${data.generatedAt}$2${jpDate(data.generatedAt)}`);

  await writeFile(DATA, JSON.stringify(data, null, 1) + '\n');
  await writeFile(PAGE, html);
  /* 紹介ページの一覧。まだ作っていなければ、無いものとして進む */
  let articles = [];
  try {
    articles = JSON.parse(await readFile(ARTICLES, 'utf8')).items ?? [];
  } catch (e) { /* data/articles.json が無い。アプリの行だけで組む */ }

  await writeFile(MAP, sitemap(data, articles));
  await writeFile(FEED, feed(data, articles));

  /* 紹介ページの一覧（/apps/）。記事が 1 本も無いときは作らない。
     作ってしまうと、空のページがサイトマップと食い違う。 */
  if (articles.length) {
    await mkdir(new URL('apps/', ROOT), { recursive: true });
    await writeFile(APPS_INDEX, articleIndexPage({
      articles,
      apps: data.items,
      generatedAt: data.generatedAt,
    }));
  }

  /* 教科・分野ごとの入口（/apps/category/<id>/）。
     8 分野ぶんを毎回書き直す。アプリが 1 本も無い分野は作らない
     （空のページがサイトマップと食い違う）。 */
  const groups = groupByCategory(data.items, articles);
  let cats = 0;
  for (const id of Object.keys(CATEGORY_LABEL)) {
    /* アプリが 1 本も無い分野は作らない。空のページがサイトマップと食い違う。
       前に作ってあれば消す。最後の 1 本を取り下げた分野のページが、
       中身のないまま検索に残り続けるのを避ける。 */
    if (!groups.get(id).apps.length) {
      await rm(new URL(`${CATEGORY_BASE}/${id}/`, ROOT), { recursive: true, force: true });
      continue;
    }
    await mkdir(new URL(`${CATEGORY_BASE}/${id}/`, ROOT), { recursive: true });
    await writeFile(new URL(`${CATEGORY_BASE}/${id}/index.html`, ROOT),
      categoryPage({ id, groups, generatedAt: data.generatedAt }));
    cats++;
  }

  /* 掲載用の資料（/press/）。数字を手で書くと、ここだけ古くなって
     媒体に古い本数が載ることになる。毎回組み直す。 */
  await mkdir(new URL('press/', ROOT), { recursive: true });
  await writeFile(PRESS, pressPage({ apps: data.items, articles, generatedAt: data.generatedAt }));

  console.log(`更新情報を書き直した：アプリ ${apps} 本 / ツール ${tools} 本`
    + ` / 紹介 ${articles.length} 本 / 分類 ${cats} 枚 / ${data.generatedAt} 時点`);
};

await main();
