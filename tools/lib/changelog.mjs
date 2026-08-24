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

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
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
