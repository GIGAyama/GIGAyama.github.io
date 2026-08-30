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

import { mkdir, readFile, readdir, writeFile, rm, rmdir, access } from 'node:fs/promises';
import { renderArticle } from './lib/article-md.mjs';
import { articlePage, headlineOf, relatedOf, summaryOf } from './lib/article-page.mjs';
import { pickImageUrl } from './lib/article-images.mjs';
import { ghApi, ghFindDoc, imageResolvers, reachable, servesFromDocs } from './lib/gh.mjs';

const OWNER = 'GIGAyama';
const ROOT = new URL('..', import.meta.url);
const DATA = new URL('data/apps.json', ROOT);
const INDEX = new URL('data/articles.json', ROOT);
const MIRROR_NEEDS = new URL('data/article-images.json', ROOT);
const MANUALS = new URL('data/manuals.json', ROOT);
const RAW = 'https://raw.githubusercontent.com/';
const PAGE = new URL('index.html', ROOT);
const APPS_DIR = new URL('apps/', ROOT);

/** 記事のファイル名。XXX_automatic の ARTICLE_NAME と同じ見立て。 */
const ARTICLE_NAME = /note[-_]?article|article[-_]?note/i;

const AGENT = 'giga-school-build-articles';

/* GitHub の取り口（トークンで断られたら匿名で試し直す、画像の URL の 3 通り）は
   tools/lib/gh.mjs に出してある。まったく同じものが build-devlog.mjs と
   build-manuals.mjs にも要る。3 つに分けると、片方だけ直したときに
   「記事は取れるのにマニュアルだけ取れない朝」が生まれ、しかも組み立ては
   「置いていないアプリ」と区別がつかないので黙って飛ばす。 */
const api = (path) => ghApi(path, AGENT);

/**
 * 記事 1 本を取ってくる。無ければ null。
 * @returns {{path: string, markdown: string} | null}
 */
const fetchArticle = (repo) => ghFindDoc(repo, 'docs/note', (name) => ARTICLE_NAME.test(name), AGENT);

/**
 * トップページのカードから、slug ごとの「つかいかた」を読み取る。
 * @param {string} page index.html の中身
 * @returns {Map<string, string[]>}
 */
function usesOf(page) {
  const out = new Map();
  for (const card of page.match(/<li class="card"[^>]*>/g) ?? []) {
    const slug = card.match(/data-slug="([^"]+)"/)?.[1];
    if (!slug) continue;
    out.set(slug, (card.match(/data-use="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean));
  }
  return out;
}

/**
 * そのリポジトリの docs/CHANGELOG.md。書いていなければ空文字。
 *
 * 「何が変わったか」はコミットからは作らない（理由は tools/lib/changelog.mjs）。
 * 本人が書いたものだけを読む。
 */
async function fetchChangelog(repo) {
  try {
    const res = await api(`${repo}/contents/docs/CHANGELOG.md`);
    if (!res.ok) return '';
    const json = await res.json();
    if (json.encoding !== 'base64') return '';
    return Buffer.from(json.content, 'base64').toString('utf8');
  } catch (e) {
    return '';           // 取れなくてもページは組む。節が出ないだけ
  }
}

const main = async () => {
  const dry = process.argv.includes('--dry-run');
  /* ⚠️ indexOf は見つからないと -1 を返す。そのまま +1 すると argv[0] を
     repo 名として読んでしまう。build-manuals.mjs と同じ書き方にそろえる。 */
  const at = process.argv.indexOf('--repo');
  const only = at === -1 ? '' : (process.argv[at + 1] ?? '');
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  /* hidden は載せない。すでに作ってある紹介ページは、下の後始末で消える。 */
  const apps = data.items.filter((a) =>
    a.hidden !== true && a.slug && a.publishedAt && a.updatedAt
    && (!only || a.repo === only || a.slug === only));

  /* 前回の台帳。--repo で 1 本だけ組んだときに、ほかの行を残すために読む。 */
  let before = [];
  let beforeMirror = {};
  try {
    before = JSON.parse(await readFile(INDEX, 'utf8')).items ?? [];
  } catch (e) { /* まだ 1 本も無い */ }
  try {
    beforeMirror = JSON.parse(await readFile(MIRROR_NEEDS, 'utf8')).apps ?? {};
  } catch (e) { /* まだ 1 本も無い */ }

  /* 使い方マニュアルのあるアプリ。記事から入口を出すかどうかに使う。
     まだ組んでいなければ「無い」として進む（明日の朝には入る）。 */
  let manualSlugs = new Set();
  try {
    const list = JSON.parse(await readFile(MANUALS, 'utf8')).items ?? [];
    manualSlugs = new Set(list.map((m) => m.slug).filter(Boolean));
  } catch (e) { /* data/manuals.json がまだ無い */ }

  const built = [];
  const pages = [];     // 2 周目で書き出すための材料
  const mirrorNeeds = {};   // 控えが要る記事と、その元の URL（build-article-images.py が読む）
  let missing = 0;
  let failed = 0;
  /* 取れなかったアプリ。後始末で「記事が無くなった」と取り違えないために持つ */
  const failedSlugs = new Set();

  for (const app of apps) {
    let got;
    try {
      got = await fetchArticle(app.repo);
    } catch (e) {
      console.warn(`  取得できず ${app.repo}: ${e.message}`);
      failed++;
      failedSlugs.add(app.slug);
      continue;
    }
    if (!got) { missing++; continue; }

    /* 記事は docs/note/ にあり、画像は docs/note/images/ を相対で指している。
       配信元が docs/ なら note/ から、リポジトリ全体なら docs/note/ から見える。 */
    const docsIsRoot = await servesFromDocs(app.repo, AGENT);
    const dir = got.path.replace(/\/[^/]*$/, '');                 // docs/note

    /* 3 通りの読み先の組み立ては tools/lib/gh.mjs に出してある。
       マニュアル（tools/build-manuals.mjs）でもそっくり同じものが要るため。
         onSubdomain  自分のドメイン。読み手にとってはこれが本筋
         onMirror     tools/build-article-images.py が WebP にして移した控え。
                      ここにあれば、学校が GitHub を塞いでいても画面写真が出る
         onRaw        逃げ道。控えを作っていないアプリでも記事が壊れないように残す */
    const { onSubdomain, onMirror, onRaw } = imageResolvers({
      repo: app.repo, slug: app.slug, dir, docsIsRoot, mirrorDir: '/assets/article',
    });

    let article = renderArticle(got.markdown, { imageUrl: onSubdomain });
    let imageHost = 'subdomain';
    let needMirror = null;
    const first = article.images[0]?.src;
    if (first && !(await reachable(first))) {
      /* 控えがあるかは 1 枚ずつ見る。理由は pickImageUrl のところに書いてある。 */
      const inMirror = new Set(
        await readdir(new URL(`assets/article/${app.slug}/`, ROOT)).catch(() => []));
      const pick = pickImageUrl({ inMirror, onMirror, onRaw });
      const seen = [];                       // 出てきた順に、記事の中での指し先
      article = renderArticle(got.markdown,
        { imageUrl: (target) => { seen.push(target); return pick(target); } });
      imageHost = inMirror.size ? 'mirror' : 'raw';
      /* 控えを作る側（build-article-images.py）に渡す一覧。
         ページから raw の URL を拾う作りだと、いちど控えに載った記事は
         raw が 1 つも出なくなり、足した画像も撮り直した画像も対象に入らない。 */
      needMirror = seen.map(onRaw);
      const onRawCount = article.images.filter((i) => i.src.startsWith(RAW)).length;
      console.warn(`  画像はサブドメインから読めない ${app.repo} → `
        + (inMirror.size ? '自分のドメインの控えを使う' : 'raw に切り替えた（控えが無い）')
        + (onRawCount ? `。うち ${onRawCount} 枚は控えが無く raw` : ''));
    }
    if (!article.title || article.charCount < 1200) {
      console.warn(`  中身が足りない ${app.repo}（題:${article.title ? 'あり' : 'なし'} / ${article.charCount}字）`);
      failed++;
      failedSlugs.add(app.slug);
      continue;
    }

    /* ここでは書き出さない。「ほかの紹介」を出すには 31 本ぶんの題が要るので、
       全部そろってから 2 周目で書き出す（下の「ページを書き出す」）。 */
    pages.push({ app, article });
    if (needMirror) mirrorNeeds[app.slug] = { repo: app.repo, images: needMirror };

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
  /* ⚠️ 「ほかの紹介」と前後の行き先は、組んだぶんではなく **公開されている
     ぜんぶ** から選ぶこと。--repo で 1 本だけ組むと built は 1 本なので、
     ここを built のままにすると、そのページから「ほかの紹介」3 本と
     前後の行き先がまるごと消える（2026-08-30 に実際に消えた）。
     台帳に無い名前は byslug で補えないので、前回ぶんは name/headline を
     そのまま使う。 */
  const forRelated = only
    ? [...new Map([...before, ...built].map((x) => [x.slug, x])).values()]
    : built;
  const all = forRelated
    .map((b) => ({
      slug: b.slug,
      name: b.name,
      headline: b.headline,
      category: byslug.get(b.slug)?.category || 'other',
      publishedAt: byslug.get(b.slug)?.publishedAt || '1970-01-01',
    }))
    .sort((x, y) => (y.publishedAt || '').localeCompare(x.publishedAt || '')
      || String(x.name).localeCompare(String(y.name), 'ja'));

  /* 「つかいかた」はトップページのカードにしか無い（data-use）。
     data/apps.json には教科・分野しか持たせていないので、ここで読み取って渡す。
     正本を増やさないための読み取りなので、見つからなければチップを出さないだけ。 */
  const uses = usesOf(await readFile(PAGE, 'utf8'));

  /* 開発記録の本数。記事の末尾に「このアプリのつくり方」を出すかの判断に使う。
     ⚠️ data/devlog.json は tools/build-devlog.mjs が書く。朝の流れでは
        こちらより先に走らせてある。まだ無くても記事は組める（入口が出ないだけ）。 */
  const devlogCounts = new Map();
  try {
    for (const e of JSON.parse(await readFile(new URL('data/devlog.json', ROOT), 'utf8')).items ?? []) {
      devlogCounts.set(e.slug, (devlogCounts.get(e.slug) ?? 0) + 1);
    }
  } catch { /* まだ 1 本も公開していない */ }

  for (const { app, article } of pages) {
    const { related, prev, next } = relatedOf(app.slug, all);
    /* 記事の画面写真がサブドメインから読めないアプリのために、
       カードのサムネイルから作った絵を置いてある（tools/build-og.py）。
       あれば使う。無ければサイト共通の絵に落ちる（これまでどおり）。 */
    const card = new URL(`assets/og/${app.slug}.jpg`, ROOT);
    let ogCard = '';
    try { await access(card); ogCard = `https://giga-school.com/assets/og/${app.slug}.jpg`; }
    catch (e) { /* まだ作っていない */ }
    const html = articlePage({ app, article, related, prev, next,
      use: uses.get(app.slug) ?? [], ogCard, changelog: await fetchChangelog(app.repo),
      devlogCount: devlogCounts.get(app.slug) ?? 0,
      /* ⚠️ tools/build-manuals.mjs より「あと」に走らせること。先に走ると、
         マニュアルを公開した当日だけ、記事から入口が出ない
         （build-devlog.mjs を先に置いてあるのと同じ理由）。 */
      hasManual: manualSlugs.has(app.slug) });
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

    /* ⚠️ 1 本も組めなかったときは、1 枚も消さない。

       ここは以前、組めた本数に関わらず後始末をしていた。GitHub が見えない朝
       （API の不調、トークンの失効）には全部が「記事なし」になるので、
       **32 本の紹介ページを削除して、その削除をそのままコミットしていた。**
       実際、手元で GitHub API に届かない状態で 1 回走らせただけで、
       32 本が消えた（2026-08-29）。朝の流れは push まで自動なので、
       本番でこれが起きると、誰も見ていない時間に全部消える。

       「取り下げた 1 本」と「全部が取れなかった朝」は、結果だけ見ると
       同じ形をしている。区別できるのは本数しかない。 */
    if (only) {
      /* ⚠️ --repo で 1 本だけ組んだときは、そもそも後始末をしない。
         見ていない 31 本を「記事が無くなった」と決めつけることになる。
         build-manuals.mjs と同じ扱い。 */
      console.log('  （--repo が付いているので、後始末はしない）');
    } else if (!built.length) {
      console.warn('  ⚠️ 記事が 1 本も取れなかった。後始末をせず、いまあるページを残す');
      console.warn('     （GitHub が見えていない可能性が高い。全部消してしまわないため）');
      process.exitCode = 1;
    } else {
      /* apps ではなく data.items 全部を見る。hidden を立てた直後は apps から
         外れているので、apps だけを見ると、前に作ったページが消し残る。 */
      for (const item of data.items) {
        if (!item.slug || keep.has(item.slug)) continue;
        /* ⚠️ 取れなかったアプリのページは消さない。取れなかったことは
           「記事が無い」ことの証拠にならない。 */
        if (failedSlugs.has(item.slug)) {
          console.warn(`  取れなかったので、いまあるページを残す: ${item.slug}`);
          continue;
        }
        /* ⚠️ ディレクトリごと消さない。apps/<slug>/manual/ は
           tools/build-manuals.mjs の持ち物で、記事の有無とは関係が無い。
           記事を取り下げただけでマニュアルまで消えると、そのアプリは
           トップのカードからしか辿れなくなる。 */
        await rm(new URL(`${item.slug}/index.html`, APPS_DIR), { force: true });
        await rmdir(new URL(`${item.slug}/`, APPS_DIR)).catch(() => {
          /* manual/ が残っていれば空でないので消えない。それでよい */
        });
      }
    }
    /* ⚠️ --repo で 1 本だけ組んだときに built でそのまま上書きすると、
       **前から載っていた 31 本が台帳から消える。** 後始末は止めてあるので
       ページは残り、台帳だけが欠ける。トップの導線と検索の索引が台帳を見て
       いるので、ページは在るのにどこからも辿れない形になる。
       同じ罠が build-manuals.mjs にもあり、そちらでは実際に踏んだ
       （週案エディタが 1 本消えた・2026-08-30）。前回のぶんに重ねる。 */
    const items = only
      ? [...new Map([...before, ...built].map((x) => [x.slug, x])).values()]
        .sort((a, b) => a.slug.localeCompare(b.slug))
      : built;

    await writeFile(INDEX, JSON.stringify({
      _comment: 'tools/build-articles.mjs が書き出す。手で書き足さない。',
      generatedAt: data.generatedAt,
      items,
    }, null, 1) + '\n');

    /* 控えが要る記事の一覧。tools/build-article-images.py がこれを読んで作る。
       書き出したページから raw の URL を拾う作りだと、いちど控えに載った記事は
       raw が 1 つも出なくなり、足した画像も撮り直した画像も対象から外れる。 */
    await writeFile(MIRROR_NEEDS, JSON.stringify({
      _comment: 'tools/build-articles.mjs が書き出す。手で書き足さない。'
        + ' サブドメインから画像が読めない記事と、その元の URL。',
      generatedAt: data.generatedAt,
      apps: Object.fromEntries(
        Object.entries(only ? { ...beforeMirror, ...mirrorNeeds } : mirrorNeeds)
          .sort(([a], [b]) => a.localeCompare(b))),
    }, null, 1) + '\n');

    /* ⚠️ トップのカードへのリンク貼りは tools/sync-updates.mjs へ移した。
       index.html を書くのは元々あちらの役目で、書き手が 2 人いること自体が
       順番の罠になっていた。しかも紹介とマニュアルは card__actions を
       丸ごと入れ替える作りなので、別々に貼ると、あとから貼ったほうが
       前のを消す。1 回でまとめて貼る（2026-08-29）。 */
  }

  console.log(`\n紹介ページ ${built.length} 本 / 記事なし ${missing} 本 / 作れず ${failed} 本`
    + (dry ? '（--dry-run のため書いていない）' : ''));
  if (failed) process.exitCode = 1;
};

/* ⚠️ 取りこんだだけで走らせない。ここは書き出しも削除もする道具なので、
   別のファイルから import した拍子に本番の生成物を書き替えてしまう。 */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
