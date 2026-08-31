/**
 * アプリの「何が変わったか」を、そのリポジトリの docs/CHANGELOG.md から読む。
 *
 * ── コミットから作るのをやめた理由 ────────────────────
 *
 * はじめはコミットの題（feat: / fix: …）から自動で作るつもりだった。
 * 実際に数えてやめた（2026-08-24 に 3 本を調べた結果）。
 *
 *   Typa            直近 10 件すべてが chore(gate) / chore(drift) / chore(sw)
 *   カベカベ合戦     直近 12 件のうち 9 件が同じ。残る 3 件も scope が
 *                   gate / build で、品質ゲートそのものの直し
 *   デジタル新聞社   ここだけは feat が並ぶ（作り直した直後だったため）
 *
 * 正本を配る仕組みが、同じコミットを 30 本のリポジトリに撒く。
 * これを機械的に出すと、紹介ページに「秘密の直書きの検査を入れる」と並ぶ。
 * 使う先生から見れば、アプリは何も変わっていない。
 *
 * 「何が変わったか」は、使う人から見て何が変わったかであって、
 * リポジトリで何をしたかではない。それを分けられるのは書いた本人だけなので、
 * 自動で拾うのをやめ、本人が書いたものを読む形にした。
 *
 * ── 書き方 ──────────────────────────────────
 *
 * アプリのリポジトリの docs/CHANGELOG.md に、新しい順で置く。
 *
 *   ## 2026-08-23
 *   - 写真の上限をなくしました
 *   - 音が出ない端末があったのを直しました
 *
 *   ## 2026-06-01
 *   - はじめて公開しました
 *
 * 無いアプリには何も出ない。**書いたアプリにだけ出る。**
 * 全部のアプリで書く必要はなく、よく使われているものだけで意味がある。
 */

/** 日付の見出し。`## 2026-08-23` か `## 2026-08-23 何か` */
const DATE_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b/;
/** 箇条書き。`- ` か `* ` */
const ITEM_RE = /^\s*[-*]\s+(.+?)\s*$/;

/** 出す日付のかたまりの数。多く出しても読まれない */
export const DEFAULT_LIMIT = 3;

/**
 * CHANGELOG.md を読む。
 *
 * @param {string} markdown
 * @param {number} limit 出す日付のかたまりの数
 * @returns {{date: string, items: string[]}[]} 新しい順
 */
export function changesOf(markdown, limit = DEFAULT_LIMIT) {
  const out = [];
  let now = null;
  /* 囲み（```）の中は項目ではない。書き方の例を CHANGELOG に貼れるようにしておく。
     ⚠️ 2026-08-31 まで飛ばしていなかったので、囲みの中の `- 行` を項目として拾い、
        公開ページに「これはコード枠の中の行」がそのまま出ていた。
        lint-manual.mjs:96-102 と同じ飛ばし方。 */
  let inFence = false;

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const head = DATE_RE.exec(raw);
    if (head) {
      now = { date: head[1], items: [] };
      out.push(now);
      continue;
    }
    if (!now) continue;                     // 最初の日付より前にある前書きは読み飛ばす
    const item = ITEM_RE.exec(raw);
    if (item) now.items.push(item[1]);
  }

  /* 中身の無い日付は出さない。見出しだけ書いて中身を忘れることがある */
  return out
    .filter((e) => e.items.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/**
 * 紹介ページに出す HTML。書いていないアプリでは空文字。
 *
 * @param {{date: string, items: string[]}[]} entries
 * @param {(s: string) => string} esc
 * @returns {string}
 */
export function changelogSection(entries, esc) {
  if (!entries?.length) return '';

  const blocks = entries.map((e) => `        <div class="changes__at">
          <p class="changes__date"><time datetime="${e.date}">${e.date.replace(/-/g, '/')}</time></p>
          <ul class="changes__list">
${e.items.map((i) => `            <li>${esc(i)}</li>`).join('\n')}
          </ul>
        </div>`).join('\n');

  /* ⚠️ 前後の改行まで含めて返す。書いていないアプリでは空文字なので、
     テンプレート側は `${changelogSection(...)}    <!-- 次の要素` と続けて書く。
     テンプレート側で改行を足すと、書いていない 31 本に空行が 1 つ増える。 */
  return `    <section class="changes" aria-labelledby="changes-title">
      <h2 class="changes__title" id="changes-title">最近の更新</h2>
${blocks}
    </section>

`;
}

/* ── トップページの「更新したこと」 ──────────────────────
 *
 * 紹介ページは 1 アプリぶんを出すが、トップは**全アプリを横断**して
 * 「どのアプリの何が良くなったか」を新しい順に並べる。
 *
 * ⚠️ 掛け算になるので 3 段で切る。切った先に行き場（一覧ページ）が無いので、
 *    「ほか N 件」は出さず黙って切る。切られることは giga-changelog スキルの
 *    references/format.md で書き手に予告してある。
 */

export const CHANGE_DAYS = 4;    // 並べる日付のかたまり
export const CHANGE_ITEMS = 12;  // 全体の項目数（左の「新しく公開したもの」8 行と釣り合う）
export const PER_APP_DAY = 3;    // 1 アプリ 1 日あたり。1 本が 10 項目書いても占領しない

/**
 * 全アプリの CHANGELOG を、日付ごとにまとめて新しい順に並べる。
 *
 * ⚠️ **並びを完全に決めること。** 日によって揺れると index.html のハッシュが動き、
 *    lastmod が毎朝進む（tools/lib/lastmod.mjs の ⚠️）。しかも「直したはず」なので
 *    誰も見に行かない。日付 desc → repo asc → CHANGELOG の記述順、で固定する。
 *
 * @param {Record<string,string>} changelogs repo → docs/CHANGELOG.md の中身
 * @param {(repo: string) => ({name: string, href: string} | null)} appOf
 *   そのリポジトリのアプリ。載せないものには null を返す
 * @returns {{date: string, apps: {repo: string, name: string, href: string, items: string[]}[]}[]}
 */
export function latestChanges(changelogs, appOf, {
  days = CHANGE_DAYS, maxItems = CHANGE_ITEMS, perApp = PER_APP_DAY,
} = {}) {
  const byDate = new Map();
  /* JSON のキー順に頼らない。将来の書き手が並べ替えても同じ HTML になるように */
  for (const repo of Object.keys(changelogs).sort()) {
    const app = appOf(repo);
    if (!app) continue;
    for (const e of changesOf(changelogs[repo], days)) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push({ repo, ...app, items: e.items.slice(0, perApp) });
    }
  }

  const out = [];
  let count = 0;
  for (const date of [...byDate.keys()].sort().reverse().slice(0, days)) {
    const kept = [];
    for (const app of byDate.get(date)) {          // repo 昇順で入っている
      if (count >= maxItems) break;
      const items = app.items.slice(0, maxItems - count);
      if (!items.length) break;
      kept.push({ ...app, items });
      count += items.length;
    }
    if (kept.length) out.push({ date, apps: kept });
    if (count >= maxItems) break;
  }
  return out;
}

/**
 * トップページに出す HTML。1 本も書かれていなければ空文字。
 *
 * ⚠️ `.changes`（紹介ページの囲み）を流用しない。あちらは本文幅の囲み箱で、
 *    2 カラムの中に置くと囲みの中に囲みが入る。`.timeline` も作り替えない
 *    ——「新しく公開したもの」と共通のクラスにすると、片方を直したときに
 *    もう片方が崩れる。
 *
 * @param {ReturnType<typeof latestChanges>} groups
 * @param {(s: string) => string} esc
 * @param {(iso: string) => string} fmt 日付の見せ方（`8月23日` など）
 * @returns {string}
 */
export function changesFeed(groups, esc, fmt) {
  if (!groups?.length) return '';

  const blocks = groups.map((g) => {
    const apps = g.apps.map((a) => `                <li class="changelog__item">
                  <a class="changelog__app" href="${esc(a.href)}">${esc(a.name)}</a>
${a.items.map((i) => `                  <span class="changelog__what">${esc(i)}</span>`).join('\n')}
                </li>`).join('\n');
    return `            <li class="changelog__at">
              <p class="changelog__date"><time datetime="${g.date}">${esc(fmt(g.date))}</time></p>
              <ul class="changelog__list">
${apps}
              </ul>
            </li>`;
  }).join('\n');

  return `          <ol class="changelog">
${blocks}
          </ol>`;
}
