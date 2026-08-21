#!/usr/bin/env node
/**
 * data/apps.json の日付を GitHub から取り直し、index.html の「更新情報」を書き直す。
 *
 *   node tools/sync-updates.mjs          日付はそのままに、index.html だけ組み直す
 *   node tools/sync-updates.mjs --fetch  GitHub を見に行って日付を更新してから組み直す
 *
 * 依存パッケージはない。Node 20 以降の fetch をそのまま使う。
 */

import { readFile, writeFile } from 'node:fs/promises';

const OWNER = 'GIGAyama';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const PAGE = new URL('index.html', ROOT);
const MAP = new URL('sitemap.xml', ROOT);

const NEW_LIMIT = 8;      // 「新しく公開したアプリ」に並べる数
const UPDATED_LIMIT = 6;  // 「最近手を入れたもの」に並べる日付の数

const CATEGORY_LABEL = {
  kokugo: '国語・言葉', sansu: '算数', tankyu: '学習・探究', gakkyu: '学級経営',
  koumu: '授業づくり・校務', seisaku: '表現・制作', game: 'ゲーム・対戦', other: 'そのほか',
};
const CATEGORY_COLOR = {
  kokugo: '#c96a2e', sansu: '#3b82d6', tankyu: '#1d9c9c', gakkyu: '#9a63c9',
  koumu: '#5b7f9e', seisaku: '#cd5a86', game: '#4a9e5c', other: '#8b93a1',
};

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
  const items = data.items.filter((i) => i.publishedAt && i.updatedAt);
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
 */
function sitemap(data) {
  const url = (loc, lastmod, changefreq, priority) =>
    `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

  const entries = [url('https://giga-school.com/', data.generatedAt, 'weekly', '1.0')];

  data.items
    .filter((i) => i.slug && i.updatedAt)
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
    await refresh(data.items);
    data.generatedAt = new Date().toISOString().slice(0, 10);
  }

  let html = await readFile(PAGE, 'utf8');
  html = replaceBlock(html, 'updates', render(data));

  /* 本数と最終更新日も、数え直した値に合わせる */
  const apps = data.items.filter((i) => i.kind === 'app').length;
  const tools = data.items.filter((i) => i.kind === 'tool').length;
  html = html
    .replace(/(<dt>公開中のアプリ<\/dt><dd>)\d+/, `$1${apps}`)
    .replace(/(<dt>拡張機能・ツール<\/dt><dd>)\d+/, `$1${tools}`)
    .replace(/(最終更新：<time datetime=")[\d-]+(">)[^<]+/,
      `$1${data.generatedAt}$2${jpDate(data.generatedAt)}`);

  await writeFile(DATA, JSON.stringify(data, null, 1) + '\n');
  await writeFile(PAGE, html);
  await writeFile(MAP, sitemap(data));
  console.log(`更新情報を書き直した：アプリ ${apps} 本 / ツール ${tools} 本 / ${data.generatedAt} 時点`);
};

await main();
