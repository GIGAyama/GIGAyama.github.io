/**
 * 記事を伝えるための入口。
 *
 * ── なぜ要るのか ────────────────────────────
 *
 * このサイトの記事は、読んだ先生が同僚に渡してはじめて意味が出る。
 * ところが記事のどこにも、渡すための入口が無かった。読み終えた人は
 * アドレス欄から自分でコピーするしかなく、題も自分で書くしかない。
 *
 * 広い画面では目次の下（右の柱）に、狭い画面では本文の前に出る。
 * どれも押したときだけ動く。読み込むだけで外へ何かを送るものは無い。
 * 外部の共有ボタン（各社が配っているもの）を貼らないのはこのためで、
 * あれは置いただけで利用者の閲覧が相手先に伝わる。
 *
 * ── 送り先の選び方 ──────────────────────────
 *
 * 読み手は学校の先生である。X と Facebook のほか、LINE を入れてある。
 * 職員室で「これ見て」と渡す道具として、いちばん使われているため。
 * はてなブックマークは、あとで読むために溜める人がいるので入れてある。
 *
 * リンクのコピーは、どこにも送らずに済ませたい人のためのもの。
 * 既にある [data-copy]（assets/app.js）をそのまま使う。
 */

/** 属性の中に入れる文字。&, <, >, " を落とす。 */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 投稿の文。題のうしろにサイトの名を足す。app.js の [data-share] と同じ形にそろえる。 */
export const shareTextOf = (title) => `${String(title).trim()}｜学校で使える Web アプリ`;

/**
 * 送り先の一覧。label は画面に出る字、href は押したときに開く先。
 * どれも「文＋アドレス」か「アドレス＋題」しか渡さない。
 */
export function shareLinks({ url, title }) {
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(shareTextOf(title));
  const t = encodeURIComponent(String(title).trim());
  return [
    { key: 'x', label: 'X', href: `https://x.com/intent/post?text=${text}&url=${u}` },
    { key: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'line', label: 'LINE', href: `https://social-plugins.line.me/lineit/share?url=${u}` },
    { key: 'hatena', label: 'はてブ', href: `https://b.hatena.ne.jp/entry/panel/?url=${u}&title=${t}` },
  ];
}

/**
 * 伝えるための枠を組む。
 * インデントは、記事の雛形の中に置いたときにそろう深さにしてある。
 */
export function shareOf({ url, title }) {
  if (!url || !title) return '';
  const links = shareLinks({ url, title })
    .map(({ key, label, href }) =>
      `        <a class="share__btn share__btn--${key}" href="${esc(href)}"`
      + ` target="_blank" rel="noopener noreferrer">${esc(label)}</a>`)
    .join('\n');
  return `      <div class="share">
        <p class="share__label">この記事を伝える</p>
${links}
        <button class="share__btn share__btn--copy" type="button"
          data-copy="${esc(url)}" data-copy-label="この記事のリンク">リンクをコピー</button>
      </div>
`;
}
