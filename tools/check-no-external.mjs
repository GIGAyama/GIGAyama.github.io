#!/usr/bin/env node
/* =====================================================================
 * tools/check-no-external.mjs — 配信するページが外から読み込んでいないか
 * =====================================================================
 * 使い方: リポジトリのルートで `node tools/check-no-external.mjs`
 *
 * ── なぜ要るのか ──────────────────────────────────
 *
 * 2026-08-31、社内の PC から giga-school.com が
 * **「カテゴリ：マルウェア」でブロックされた**。
 *
 * 原因は /apps/qalc/manual/ だった。画面写真 56 枚を
 * raw.githubusercontent.com から読んでいた。あのホストは世界中で
 * 実行ファイルの置き場に使われているので、学校や会社のフィルタリングでは
 * **既定でマルウェア扱いのことがある**。1 ページが外から読んだだけで、
 * ドメインごと危険なものとして扱われる形になる。
 *
 * ここがいちばん効く事実だが、**ポータルの配信物を見る検査は 1 つも無かった**。
 *
 *   ・giga-reviewer（静的検査）は、各アプリのリポジトリを見る道具
 *   ・standards/web/verify-no-external.mjs は実ブラウザで測る道具。週 1 回で、
 *     しかも回るのはトップなど数ページ。マニュアルまでは回っていなかった
 *   ・tools/check-cards.mjs / check-outputs.mjs は、並びと書き出し先の話
 *
 * つまり Zero-CDN は「配る側」にだけ掛かっていて、**ポータル自身が組み立てた
 * ページには掛かっていなかった**。しかも組み立てているのは毎朝の自動処理なので、
 * 誰も目で見ない。今回も 6 日ぶん、そのまま公開されていた。
 *
 * ── 何を数えるか ──────────────────────────────────
 *
 * ブラウザが**勝手に取りに行くもの**だけを数える。/filtering/ の一覧を
 * 作ったときと同じ線引きにしてある（docs/devlog/2026-08-24-filtering-list.md）。
 *
 *   数える     src / srcset / <link> の読み込み / CSS の url() / @import /
 *              importScripts()
 *   数えない   <a href>            … 押したときに動くだけ。読み込みではない
 *              og:image, canonical … SNS のクローラと検索向けの申告
 *              JSON-LD の中の URL  … 同じく申告であって読み込みではない
 *
 * 数えないものを外さないと、共有ボタン（x.com / facebook / はてな / LINE）で
 * 毎回赤くなる。**いつも赤い検査は、そのうち誰も読まなくなる。**
 *
 * ⚠️ **これは静的検査なので「0 件」は合格ではない。**
 *    実行時に組み立てた URL は、原理的にここには映らない。出ていく通信の
 *    ほんとうのところは standards/web/verify-no-external.mjs が実ブラウザで測る。
 *    こちらは「毎朝の組み直しが外を向いた瞬間に止める」ための、速い側の網。
 * ===================================================================== */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 自分のドメイン。サブドメイン（<アプリ名>.giga-school.com）も自分の側 */
const OWN = 'giga-school.com';

/* 見に行かない場所。配信されないものを混ぜると、検査が通らない理由が
   「公開ページの事故」なのか「道具の中の文字列」なのか分からなくなる。 */
const SKIP = ['standards/', 'tools/', 'docs/', '.github/', '.claude/', '.agents/'];

/* <link> のうち、読み込みではないもの。ここは「読み込む rel」を並べるのではなく
   「読み込まない rel」を並べる。前者だと、知らない rel が増えたときに
   黙って見逃す側へ倒れる。後者なら、知らない rel は数える側へ倒れる。 */
const NOT_A_LOAD = new Set(['canonical', 'alternate', 'author', 'license', 'me', 'help', 'search']);

/**
 * 読み込みの URL を 1 つずつ返す。
 *
 * @param {string} text  ファイルの中身
 * @returns {{url: string, how: string}[]}
 */
export function loadsIn(text) {
  const out = [];
  const push = (url, how) => { if (url) out.push({ url: url.trim(), how }); };

  for (const m of text.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1], 'src');

  /* srcset は「URL 幅, URL 幅」と並ぶので、1 つずつに割る */
  for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi))
    for (const one of m[1].split(',')) push(one.trim().split(/\s+/)[0], 'srcset');

  for (const m of text.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (m[1].match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    if (rel.split(/\s+/).some((r) => NOT_A_LOAD.has(r))) continue;
    push(m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1], `link rel=${rel || '(なし)'}`);
  }

  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) push(m[1], 'url()');
  /* url() 付きの @import は、すぐ上の url() が拾っている。
     ここで両方に掛けると、同じ 1 件が 2 行になって報告が読みにくい。
     ここが見るのは `@import "..."` の形だけ。 */
  for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) push(m[1], '@import');
  for (const m of text.matchAll(/importScripts\(\s*["']([^"']+)["']/gi)) push(m[1], 'importScripts');

  return out;
}

/**
 * その URL が自分の側か。
 *
 * ⚠️ スキームを省いた `//cdn…` を通さないこと。2026-08-28 に、これが
 *    静的検査を素通りしている。`http` で始まらないので「相対の道」に見える。
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isOwn(url) {
  if (/^(data:|blob:|#|mailto:|tel:)/i.test(url)) return true;
  if (/^(https?:)?\/\//i.test(url)) {
    const host = url.replace(/^(https?:)?\/\//i, '').split(/[/?#]/)[0].toLowerCase();
    return host === OWN || host.endsWith(`.${OWN}`);
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);   // 相対・絶対パスは自分の側
}

/** 配信される html / css / js を git から拾う（追跡していないものは配られない） */
export function servedFiles(root = new URL('..', import.meta.url)) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(html|css|js|mjs)$/.test(f) && !SKIP.some((s) => f.startsWith(s)));
}

function main() {
  const root = new URL('..', import.meta.url);
  const files = servedFiles(root);
  const bad = [];

  for (const f of files)
    for (const { url, how } of loadsIn(readFileSync(new URL(f, root), 'utf8')))
      if (!isOwn(url)) bad.push({ f, url, how });

  console.log(`■ 配信する ${files.length} ファイルが、外から読み込んでいないか`);
  if (bad.length === 0) {
    console.log(`  ok   外からの読み込みは 0 件（${OWN} と、その下だけ）`);
    console.log('\n✅ すべて通りました');
    console.log('※ 静的検査なので、実行時に組み立てた URL はここに映りません。');
    console.log('  出ていく通信は standards/web/verify-no-external.mjs が実ブラウザで測ります。');
    return 0;
  }

  for (const { f, url, how } of bad) console.log(`  FAIL ${f}\n       ${how} → ${url}`);
  console.log(`\n❌ 外からの読み込みが ${bad.length} 件あります`);
  console.log('学校や会社のフィルタリングは、外のホストの分類でページごと止めます。');
  console.log('2026-08-31 は raw.githubusercontent.com が「マルウェア」に当たり、');
  console.log('giga-school.com ごとブロックされました。自分のドメインへ控えを移してください。');
  console.log('  画面写真: python3 tools/build-article-images.py → /assets/article/ と /assets/manual/');
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
