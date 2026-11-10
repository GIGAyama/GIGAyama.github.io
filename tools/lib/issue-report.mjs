/**
 * 赤くなった検査を、人に届く形（GitHub の Issue）にする。その計算のところ。
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 2026-09-19 から 11-09 まで、「配布のとりのこし」は **52 日つづけて赤かった**
 * （run 107〜158）。原因は毎回おなじ 1 行で、Hiding-animal が台帳に無いというだけ。
 * 検査は正しく働いていた。足りなかったのは**届ける道**で、Actions の一覧を
 * 開かないかぎり、赤いことはどこにも出てこなかった。
 *
 * 「誰も見ないログに出る警告は、出ていないのと同じ」（check-distribution.yml の
 * コメント）を、赤そのものがやっていた。
 *
 * ── 決まり ────────────────────────────────────────────
 *
 *   ・検査 1 つにつき Issue は 1 本だけ。目印（MARK）を本文に埋めて見分ける
 *   ・赤くなったら立てる。もう立っていれば本文を書き替える（通知は飛ばない）
 *   ・緑に戻ったら、ひとこと残して閉じる
 *
 * ⚠️ 毎朝コメントを足さない。足すのは「中身が変わったとき」と「7 回つづいた
 *    とき」だけ。毎朝とどく通知は 3 日で読まれなくなり、52 日つづいた赤と
 *    同じ場所に戻る。**毎回赤い検査は、赤いことに意味が無くなる**のと同じ型。
 *
 * ⚠️ ここは計算だけ。外へ出ていくのは tools/report-issue.mjs のほう。
 */
import { createHash } from 'node:crypto';

const MARK = 'giga-auto';

/** 本文に埋める目印。人には見えない */
export function marker(key, { first, count, digest }) {
  return `<!-- ${MARK}:${key} first=${first} count=${count} digest=${digest} -->`;
}

/** 目印を読む。無ければ null（＝この道具が立てた Issue ではない） */
export function parseMarker(body, key) {
  const m = new RegExp(`<!-- ${MARK}:${escapeRe(key)} first=(\\S+) count=(\\d+) digest=(\\S+) -->`)
    .exec(String(body ?? ''));
  return m ? { first: m[1], count: Number(m[2]), digest: m[3] } : null;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 「中身が変わったか」を見るための指紋。
 *
 * ⚠️ 日付と URL と実行番号は落としてから数える。落とさないと、同じ赤が
 *    毎朝「変わった」と数えられて、毎朝コメントが足される。
 */
export function digestOf(detail) {
  const stable = String(detail ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return createHash('sha256').update(stable).digest('hex').slice(0, 12);
}

/**
 * Issue に貼る分だけに切る。後ろを残す（検査の結論はたいてい最後に出る）。
 * GitHub の本文は 65,536 字まで。ログをそのまま貼ると、立てること自体が失敗する。
 */
export function clip(detail, maxLines = 80, maxChars = 6000) {
  let lines = String(detail ?? '').replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  let cut = false;
  if (lines.length > maxLines) { lines = lines.slice(-maxLines); cut = true; }
  let text = lines.join('\n');
  if (text.length > maxChars) { text = text.slice(-maxChars); cut = true; }
  /* ``` を含むと囲みが割れる。中のものは字として出す */
  text = text.replace(/```/g, "'''");
  return cut ? `（長いので後ろだけ）\n${text}` : text;
}

/** Issue の本文 */
export function issueBody({ key, detail, runUrl, first, count, today, hint }) {
  const clipped = clip(detail);
  return [
    `${marker(key, { first, count, digest: digestOf(detail) })}\n`
      + `**${first} から赤いままです**（${count} 回つづけて失敗。最後に見たのは ${today}）`,
    hint ? `直し方: ${hint}` : null,
    clipped ? `\`\`\`\n${clipped}\n\`\`\`` : '（検査の出力はありません。実行の記録を見てください）',
    runUrl ? `実行の記録: ${runUrl}` : null,
    '---\n'
      + 'この Issue は `tools/report-issue.mjs` が立てました。緑に戻ると自動で閉じます。\n'
      + '手で閉じても、赤いままなら次の回にもう一度立ちます。',
  ].filter(Boolean).join('\n\n');
}

/**
 * 何をするかを決める。
 *
 * @param {object} p
 * @param {'success'|'failure'|'cancelled'|string} p.status ジョブの結果
 * @param {{number: number, body: string}|null} p.existing いま開いている Issue
 * @returns {Array<{op: 'create'|'update'|'comment'|'close', number?: number, title?: string, body?: string}>}
 */
export function planReport({ status, existing, key, title, detail = '', runUrl = '', today, hint = '', remindEvery = 7 }) {
  /* 取り消された回は、赤でも緑でもない。何も言わない。
     「直った」と閉じてしまうと、次に立つまでのあいだ赤が見えなくなる。 */
  if (status !== 'success' && status !== 'failure') return [];

  const prev = existing ? parseMarker(existing.body, key) : null;

  if (status === 'success') {
    if (!existing) return [];
    const since = prev ? `${prev.first} から ${prev.count} 回つづいた赤が、` : '';
    return [
      { op: 'comment', number: existing.number, body: `✅ ${since}${today} に緑へ戻りました。閉じます。${runUrl ? `\n\n実行の記録: ${runUrl}` : ''}` },
      { op: 'close', number: existing.number },
    ];
  }

  if (!existing) {
    return [{ op: 'create', title, body: issueBody({ key, detail, runUrl, first: today, count: 1, today, hint }) }];
  }

  const first = prev?.first ?? today;
  const count = (prev?.count ?? 0) + 1;
  const body = issueBody({ key, detail, runUrl, first, count, today, hint });
  const actions = [{ op: 'update', number: existing.number, body }];

  const changed = prev && prev.digest !== digestOf(detail);
  if (changed) {
    actions.push({
      op: 'comment', number: existing.number,
      body: `⚠️ 赤いまま、中身が変わりました（${today}）。\n\n\`\`\`\n${clip(detail, 40, 3000)}\n\`\`\``,
    });
  } else if (remindEvery > 0 && count % remindEvery === 0) {
    actions.push({
      op: 'comment', number: existing.number,
      body: `⏰ まだ赤いままです（${first} から ${count} 回つづけて失敗）。`,
    });
  }
  return actions;
}

/** 開いている Issue の一覧から、この検査のものを探す。PR は Issue の一覧に混ざるので除く */
export function findExisting(issues, key) {
  const hit = (Array.isArray(issues) ? issues : [])
    .filter((i) => i && !i.pull_request && parseMarker(i.body, key));
  /* 2 本立っていたら古いほうを使う（番号の小さいほう）。新しく立てない */
  hit.sort((a, b) => a.number - b.number);
  return hit[0] ? { number: hit[0].number, body: hit[0].body } : null;
}
