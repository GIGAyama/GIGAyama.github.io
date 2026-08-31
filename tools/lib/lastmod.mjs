/**
 * 「そのページの中身が最後に変わった日」を覚えておくところ。
 *
 * ── なぜ要るのか ────────────────────────────────
 *
 * 朝の組み直しは、日付を `new Date()` で入れていた。中身が 1 文字も変わって
 * いない朝でも sitemap の lastmod が今日になるので、2026-08-30 の時点で
 * **90 URL 中 88 が同じ日付**、feed.xml は 21 個すべてが同じ値になっていた。
 *
 * Google は lastmod が実態と合っていないサイトでは lastmod を**まるごと無視する**。
 * 本当に更新した 1 本を出しても、ほかの 87 本と同じ日付なので区別がつかない。
 * 正直に申告していれば効いたはずのクロールの誘導を、毎朝自分で捨てていた。
 *
 * ── どう決めるか ────────────────────────────────
 *
 * 組み上がった中身の sha256 を台帳（data/lastmod.json）と突き合わせ、
 * **変わっていなければ前の日付を据え置く**。変わった日だけ今日にする。
 *
 * ⚠️ 日付を入れてからハッシュを取ってはいけない。ページの本文には
 *    「2026年8月29日 時点」のような日付そのものが載っている（press-page.mjs）。
 *    日付を入れた状態で測ると、日付が変わる→ハッシュが変わる→日付が変わる、で
 *    自分自身を追いかけて毎日動く。**日付の場所に SENTINEL を置いて 1 回組み、
 *    それを測る。** 決まった日付で、もう 1 回組んで書き出す。
 *
 * ⚠️ 文字列の置換で済ませないこと。`jpDate('0000-00-00')` は `0年0月0日` に
 *    化けるので、置換したい先が本文の中で見つからなくなる。**組み立ての関数を
 *    2 回呼ぶ。** 組み立ては純粋な文字列処理なので、2 回の費用はほぼゼロ。
 *
 * ⚠️ 組み立てが決定論でないと、この仕組みは静かに効かなくなる。
 *    並び順が日によって変わると、ハッシュが毎日変わり、日付が毎日動き、
 *    **しかも「直したはず」なので誰も見に行かない**。各ページの検査に
 *    「同じ入力を 2 回組むとバイトまで同じ」を入れてあるのは、そのため。
 *
 * ── git のコミット日を使わない理由 ──────────────────
 *
 * `git log -1 -- <path>` は使えない。朝の流れの `actions/checkout@v4` は
 * fetch-depth を指定していない（既定の 1）ので、履歴が 1 コミットしか無く、
 * **どの道を渡しても HEAD が返る**。つまり毎朝「今日」になる。
 * それらしい日付が返るぶん、いちばん気づけない形の間違いになる。
 */

import { createHash } from 'node:crypto';

/**
 * 日付の場所に置いておく仮の値。
 *
 * 実在しない日付にしてある。取りこぼして表に出てしまったとき、
 * それらしい日付だと気づけないため。
 */
export const SENTINEL = '0000-00-00';

const COMMENT = 'そのページの中身が最後に変わった日。tools/sync-updates.mjs が書く。'
  + '手で直さない。hash は日付の場所に 0000-00-00 を置いて組んだときの sha256 なので、'
  + '日付が動いてもハッシュは動かない。⚠️ この台帳が消えると、翌朝すべてのページが'
  + '「今日」に揃う（直したはずの症状がそのまま戻る）。'
  + '.github/workflows/sync-updates.yml の PATHS から外さないこと。';

/** 中身のハッシュ。長さは台帳の読みやすさで決めてあり、衝突を競う用途ではない。 */
export function hashOf(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

/** 台帳が無いとき・壊れているときの、空の台帳。 */
export function emptyLedger() {
  return { _comment: COMMENT, pages: {} };
}

/**
 * 台帳を読める形に均す。壊れていても落とさず、空として扱う。
 *
 * ここで落とすと、朝の組み直しが 1 本の JSON で止まる。台帳が無いときの
 * 振る舞い（全部が今日になる）は tools/check-sitemap.mjs が同じ朝に拾う。
 */
export function normalizeLedger(raw) {
  const led = emptyLedger();
  if (raw && typeof raw === 'object' && raw.pages && typeof raw.pages === 'object') {
    for (const [key, v] of Object.entries(raw.pages)) {
      if (v && typeof v.hash === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.lastmod || '')) {
        led.pages[key] = { hash: v.hash, lastmod: v.lastmod };
      }
    }
  }
  return led;
}

/**
 * その中身の日付を決める。台帳は書き替えない（決めるだけ）。
 *
 * @param {object} ledger normalizeLedger を通した台帳
 * @param {string} key ページの道（`/apps/` など）
 * @param {string} hash SENTINEL 入りで組んだ中身のハッシュ
 * @param {string} today 日本時間の今日。**ここだけが「今日」を知る**
 * @returns {{lastmod: string, changed: boolean}}
 */
export function resolveLastmod(ledger, key, hash, today) {
  const prev = ledger.pages[key];
  if (prev && prev.hash === hash) return { lastmod: prev.lastmod, changed: false };
  return { lastmod: today, changed: true };
}

/**
 * 中身から日付を決め、台帳を更新し、決まった日付で組み直したものを返す。
 *
 * @param {object} ledger 書き替えられる台帳
 * @param {string} key ページの道
 * @param {(lastmod: string) => string} build 日付を受け取って中身を返す関数。2 回呼ばれる
 * @param {string} today 日本時間の今日
 * @returns {{text: string, lastmod: string, changed: boolean}}
 */
export function stamp(ledger, key, build, today) {
  const hash = hashOf(build(SENTINEL));
  const { lastmod, changed } = resolveLastmod(ledger, key, hash, today);
  ledger.pages[key] = { hash, lastmod };
  return { text: build(lastmod), lastmod, changed };
}

/**
 * 日付を持たない中身（組み立てていない静的なページ）を台帳に載せる。
 *
 * /profile/ はどの道具も書き出していないので、これでしか本当の日付にならない。
 */
export function stampStatic(ledger, key, text, today) {
  const hash = hashOf(text);
  const { lastmod, changed } = resolveLastmod(ledger, key, hash, today);
  ledger.pages[key] = { hash, lastmod };
  return { lastmod, changed };
}

/** 台帳のうち、いちばん新しい日付。サイト全体の「最後に変わった日」。 */
export function siteLastmod(ledger, fallback = '') {
  return Object.values(ledger.pages)
    .reduce((max, p) => (p.lastmod > max ? p.lastmod : max), fallback);
}

/** 台帳を書き出す形。道の順に並べて、差分が読めるようにする。 */
export function serializeLedger(ledger) {
  const pages = {};
  for (const key of Object.keys(ledger.pages).sort()) pages[key] = ledger.pages[key];
  return JSON.stringify({ _comment: COMMENT, pages }, null, 1) + '\n';
}
