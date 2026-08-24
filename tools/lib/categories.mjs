/**
 * カテゴリと「つかいかた」の表。
 *
 * 表示名と色は index.html のカード（class="tag" と style="--cat:…"）と
 * そろえてある。更新情報と紹介ページの一覧の両方で使うので、
 * 2 か所に同じ表を置かず、ここを正本にする。
 *
 * 「つかいかた」の表示名は、これまで index.html の選択肢の中にしか無かった。
 * 紹介ページでも使うので、こちらに移した。ずれていないかは
 * tools/check-cards.mjs が index.html の選択肢と突き合わせて見ている。
 */

export const CATEGORY_LABEL = {
  kokugo: '国語・言葉', sansu: '算数', tankyu: '学習・探究', gakkyu: '学級経営',
  koumu: '授業づくり・校務', seisaku: '表現・制作', game: 'ゲーム・対戦', other: 'そのほか',
};

export const CATEGORY_COLOR = {
  kokugo: '#c96a2e', sansu: '#3b82d6', tankyu: '#1d9c9c', gakkyu: '#9a63c9',
  koumu: '#5b7f9e', seisaku: '#cd5a86', game: '#4a9e5c', other: '#8b93a1',
};

export const USE_LABEL = {
  susumu: '自分で進める', renshu: '練習する', shiraberu: '調べる', tsukuru: 'つくる',
  furikaeru: 'ふりかえる', minna: 'みんなでやる', sensei: '先生の仕事', hoka: 'そのほか',
};

/**
 * 対象学年の書きかた。data/apps.json の grades をそのまま渡す。
 *
 * 続きの学年はまとめて「1〜6年生」、飛んでいれば「1・3年生」、
 * 1 つだけなら「2年生」。「低学年」「中学年」と言い換えないのは、
 * 指す範囲が地域や学校で違うことがあるため。数字なら取り違えようがない。
 *
 * 空の配列は「児童が使うものではない（先生の道具など）」の意味なので、
 * ラベルは作らない。項目そのものが無いもの（まだ決めていない）も同じ。
 *
 * @param {number[] | undefined} grades
 * @returns {string} 出さないときは空文字
 */
export function gradeLabel(grades) {
  const g = [...new Set((Array.isArray(grades) ? grades : [])
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6))].sort((a, b) => a - b);
  if (!g.length) return '';
  if (g.length === 1) return `${g[0]}年生`;

  const runs = [[g[0]]];
  for (const n of g.slice(1)) {
    const last = runs[runs.length - 1];
    if (n === last[last.length - 1] + 1) last.push(n);
    else runs.push([n]);
  }
  return runs
    .map((r) => (r.length >= 2 ? `${r[0]}〜${r[r.length - 1]}` : `${r[0]}`))
    .join('・') + '年生';
}
