/**
 * 日付を日本時間で切るところ。
 *
 * ⚠️ `new Date().toISOString().slice(0, 10)` を直に書かないこと。
 *    朝の組み直し（.github/workflows/sync-updates.yml）は UTC 21:17 に走る。
 *    日本時間では翌朝 6:17 なので、UTC で切ると**必ず前日の日付**になる。
 *    2026-08-30 の朝に組んだページが「最終更新：2026年8月29日」と出ていた。
 *
 *    しかも GitHub の schedule は遅れる（実測で 21:44〜05:24 UTC とばらついた）。
 *    遅れて日をまたいだ回だけ日本時間と一致するので、**2026-08-26 という日付は
 *    一度もサイトに出ていない**。ずれ方が日によって違うぶん、気づきにくい。
 *
 * 「いま」は必ず引数で受ける。関数の中で `new Date()` を呼ぶと、
 * 同じ入力から同じ出力が返ることを検査できなくなる。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本時間の「今日」。
 *
 * @param {Date} [now] いまの時刻。省略したときだけ現在時刻を読む
 * @returns {string} YYYY-MM-DD
 */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * GitHub API が返す ISO 時刻を、日本時間の日付にする。
 *
 * API は UTC で返すので、`.slice(0, 10)` で切ると UTC 15:00 以降の push が
 * 前日の日付になる。日本の学校で使うものなので、日付は日本時間で合わせる。
 *
 * @param {string} isoTimestamp `2026-08-29T23:21:48Z` のような文字列
 * @returns {string} YYYY-MM-DD。読めなければ空文字
 */
export function jstDate(isoTimestamp) {
  if (!isoTimestamp) return '';
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return '';
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}
