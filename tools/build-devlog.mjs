/**
 * アプリ側の docs/devlog/*.md を取ってきて、/devlog/ のページに組み直す。
 *
 *   node tools/build-devlog.mjs           GitHub から取って組む
 *   node tools/build-devlog.mjs --local   手元の docs/devlog/ だけで組む（試すとき）
 *
 * ── 紹介記事とまったく同じ道 ──────────────────────
 *
 * tools/build-articles.mjs が docs/note/*-note-article.md を /apps/<slug>/ にする、
 * あの仕組みと同じ。取り方（api ヘルパ）も、描き方（renderArticle）も共通。
 * 別の道を作ると、片方だけ直したときに食いちがう。
 *
 * ── published: true のものだけ出す ────────────────
 *
 * ⚠️ 絞るのはここ 1 か所。devlog-page.mjs 側でも絞ると、
 *    片方を直したときに「出したつもりが出ない」が起きる。
 *
 * プロンプトには生の事情が混ざる。学校名や、そのときの教室の様子。
 * 書いた本人には見えなくなっているので、公開の判断は必ず人が通す。
 * スキル（standards/skills/devlog-article/）は published: false で納品する。
 *
 * ── 出してはいけないものは、ここでも止める ──────────
 *
 * スキルの lint-devlog.mjs が書くときに見ているが、それは書き手の手元の話。
 * 手で書いた記事や、lint を通さずに置いた記事が来ることがある。
 * **公開する直前にもう一度見る。** 落とし漏れは目で気づけない。
 */

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { renderArticle } from './lib/article-md.mjs';
import { withAnchors } from './lib/article-toc.mjs';
import { DEVLOG_BASE, devlogApp, devlogIndex, devlogPost } from './lib/devlog-page.mjs';
import { stripRuby } from './lib/plain-text.mjs';

const OWNER = 'GIGAyama';

/**
 * このサイト自体の記録の置き場。
 *
 * 開発の半分は giga-school.com そのものへの変更で、それは data/apps.json に
 * 載らない（アプリではないので、カードにも一覧にも出ない）。
 * かといって適当なアプリの slug を借りると、そのアプリの「つくり方」に
 * 関係のない記録が混ざる。**専用の枠をここに 1 つだけ置く。**
 *
 * ⚠️ data/apps.json には足さない。足すとカード・分類・フィルタリングの
 *    一覧すべてに出てしまう。ここは開発記録の中だけの名前。
 */
const SITE_APP = { slug: 'site', name: 'giga-school.com', repo: 'GIGAyama.github.io', isSite: true };
const ROOT = new URL('..', import.meta.url);
const APPS = new URL('data/apps.json', ROOT);
const OUT = new URL('data/devlog.json', ROOT);

/* build-articles.mjs と同じ。トークンで断られたら匿名で試す */
const headers = () => {
  const token = process.env.GITHUB_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'giga-school-build-devlog',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
};

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

/** ⚠️ 公開ページに出してはいけないもの。lint と同じ形を見る */
const LEAKS = [
  [/claude\.ai\/code\/session_|\bsession_[0-9A-Za-z]{6,}/, 'セッションのリンク'],
  [/[^\s、。「」]{2,10}(小学校|中学校)/, '学校名らしきもの'],
  [/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i, 'メールアドレス'],
];

/** front matter を読む。無ければ null */
function frontMatter(md) {
  const lines = String(md ?? '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const data = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(l.trim());
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/** 一覧に出す 1〜2 文。最初の段落から取る */
function summaryOf(body) {
  const para = body.split(/\n\s*\n/).find((p) => p.trim() && !/^#/.test(p.trim()) && !/^```/.test(p.trim()));
  if (!para) return '';
  /* ⚠️ 空白をまとめて消さない。「31 本」が「31本」になる。
     このサイトは日本語と数字・英字のあいだに空白を入れる書き方でそろえてある。
     改行だけを畳みたいので、日本語どうしに挟まれた空白だけを取る。 */
  /* ⚠️ ふりがなを外してから切る。開発記録はふりがなの話を書くことがあり
     （この一件の記録がまさにそう）、外さないと素の 20 字が 90 字を超えて、
     切れ目がタグの途中に落ちる（`<ruby>計算<rt>けい…` の形で止まる）。 */
  const t = stripRuby(para).replace(/\s+/g, ' ')
    .replace(/([^\x00-\x7F]) (?=[^\x00-\x7F])/g, '$1')
    .replace(/`/g, '')
    .trim();
  return t.length > 90 ? `${t.slice(0, 88)}…` : t;
}

/** そのリポジトリの docs/devlog/*.md を並べる */
async function listDevlog(repo) {
  const res = await api(`${repo}/contents/docs/devlog`);
  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  return items.filter((f) => f.type === 'file' && f.name.endsWith('.md') && f.name !== 'README.md');
}

async function fetchText(repo, path) {
  const res = await api(`${repo}/contents/${path}`);
  if (!res.ok) return null;
  const j = await res.json();
  return Buffer.from(j.content ?? '', j.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

/** PR の日付と差分の規模。無くても記事は出せる */
async function prStat(repo, pr) {
  const res = await api(`${repo}/pulls/${pr}`);
  if (!res.ok) return null;
  const j = await res.json();
  return { additions: j.additions ?? 0, deletions: j.deletions ?? 0, files: j.changed_files ?? 0 };
}

async function main() {
  const local = process.argv.includes('--local');
  const apps = JSON.parse(await readFile(APPS, 'utf8')).items
    .filter((a) => a.slug && a.hidden !== true);
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  bySlug.set(SITE_APP.slug, SITE_APP);

  /* 紹介記事があるかどうか。記事ページへのリンクを出すかの判断に使う */
  let withArticle = new Set();
  try {
    withArticle = new Set(JSON.parse(await readFile(new URL('data/articles.json', ROOT), 'utf8'))
      .items.map((x) => x.slug));
  } catch { /* まだ無くても動く */ }

  const entries = [];
  let skipped = 0;
  let blocked = 0;

  /* 手元で試すとき。GitHub を見に行かず、このリポジトリの docs/devlog/ だけ読む */
  const sources = [];
  if (local) {
    let names = [];
    try { names = (await readdir(new URL('docs/devlog/', ROOT))).filter((n) => n.endsWith('.md') && n !== 'README.md'); }
    catch { names = []; }
    for (const n of names) {
      sources.push({ repo: '(local)', file: n, md: await readFile(new URL(`docs/devlog/${n}`, ROOT), 'utf8') });
    }
  } else {
    /* このサイト自身の docs/devlog/ も見る。開発の半分はここへの変更なので、
       アプリのリポジトリだけ見ていると記録の置き場が無くなる */
    for (const a of [...apps, SITE_APP]) {
      for (const f of await listDevlog(a.repo)) {
        const md = await fetchText(a.repo, f.path);
        if (md) sources.push({ repo: a.repo, file: f.name, md });
      }
    }
  }

  for (const { repo, file, md } of sources) {
    const fm = frontMatter(md);
    if (!fm) { console.warn(`  front matter が無い ${repo}/${file}`); skipped++; continue; }
    const { data, body } = fm;

    if (String(data.published).toLowerCase() !== 'true') { skipped++; continue; }
    for (const key of ['app', 'title', 'date']) {
      if (!data[key]) { console.warn(`  ${key} が無い ${repo}/${file}`); skipped++; }
    }
    if (!data.app || !data.title || !data.date) continue;

    const app = bySlug.get(data.app);
    if (!app) { console.warn(`  data/apps.json にも site にも無い slug ${data.app}（${repo}/${file}）`); skipped++; continue; }

    /* ⚠️ 公開する直前にもう一度見る。lint は書き手の手元の話で、
       通していない記事が来ることがある */
    const hit = LEAKS.find(([re]) => re.test(body));
    if (hit) {
      console.warn(`  ❌ 出せないものが入っている ${repo}/${file}: ${hit[1]}`);
      blocked++;
      continue;
    }

    const article = renderArticle(body, { imageUrl: (t) => t });
    const { html, headings } = withAnchors(article.html);

    entries.push({
      repo: repo === '(local)' ? app.repo : repo,
      slug: data.app,
      appName: app.name,
      name: file.replace(/\.md$/, ''),
      title: data.title,
      date: data.date,
      pr: data.pr ? Number(data.pr) : null,
      summary: summaryOf(body),
      hasArticle: withArticle.has(data.app),
      isSite: app.isSite === true,
      stat: null,
      html,
      headings,
    });
  }

  /* PR の差分の規模を添える。記事の数だけ叩くので、書いてあるものだけ */
  if (!local) {
    for (const e of entries.filter((x) => x.pr)) e.stat = await prStat(e.repo, e.pr);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));

  /* 書き出す。1 本も無ければ /devlog/ ごと消す。
     空のページがサイトマップと食いちがうのを避ける（分類ページと同じ考え方） */
  const dir = new URL(`${DEVLOG_BASE}/`, ROOT);
  await rm(dir, { recursive: true, force: true });

  if (!entries.length) {
    /* ⚠️ 0 本でも /devlog/ は書く。全ページのフッターがここへ張ってあるので、
       ディレクトリごと消すと、サイト中のフッターから 404 に飛ぶことになる。
       アプリごとのページと記事のページだけ消える（上の rm でもう消えている）。 */
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('index.html', dir), devlogIndex({ entries: [], byApp: [] }));
    console.log(`開発記録：公開 0 本（下書き ${skipped} 本${blocked ? ` / 止めた ${blocked} 本` : ''}）`);
    await writeFile(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), items: [] }, null, 1)}\n`);
    return 0;
  }

  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.slug)) groups.set(e.slug, { slug: e.slug, appName: e.appName, hasArticle: e.hasArticle, isSite: e.isSite, entries: [] });
    groups.get(e.slug).entries.push(e);
  }
  const byApp = [...groups.values()].sort((a, b) => a.appName.localeCompare(b.appName, 'ja'));

  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), devlogIndex({ entries, byApp }));

  for (const g of byApp) {
    await mkdir(new URL(`${g.slug}/`, dir), { recursive: true });
    await writeFile(new URL(`${g.slug}/index.html`, dir), devlogApp(g));

    /* 前後の記録。古い順にたどれるようにする */
    const asc = [...g.entries].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < asc.length; i++) {
      const e = asc[i];
      await mkdir(new URL(`${g.slug}/${e.name}/`, dir), { recursive: true });
      await writeFile(new URL(`${g.slug}/${e.name}/index.html`, dir),
        devlogPost({ entry: e, html: e.html, headings: e.headings, prev: asc[i - 1], next: asc[i + 1] }));
    }
  }

  /* 索引。sitemap と検査がこれを読む。html は重いので落とす */
  const index = entries.map(({ html, headings, ...rest }) => rest);
  await writeFile(OUT, `${JSON.stringify({
    _comment: 'tools/build-devlog.mjs が書き出す。手で直さない。',
    generatedAt: new Date().toISOString().slice(0, 10),
    items: index,
  }, null, 1)}\n`);

  console.log(`開発記録：公開 ${entries.length} 本 / アプリ ${byApp.length} 本`
    + `（下書き ${skipped} 本${blocked ? ` / 止めた ${blocked} 本` : ''}）`);
  return blocked ? 1 : 0;
}

process.exit(await main());
