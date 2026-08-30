/**
 * 配布先ごとに埋める字（プレースホルダー）。
 *
 * ── なぜ要るのか ──────────────────────────────────────────────
 *
 * 正本の records-export.html は、アプリの表示名を __APP_NAME__ という
 * プレースホルダーで持っている。埋める役がどこにもいなかったので、
 * 配られた先では、その字がそのまま公開されていた。
 *
 *   このページは、__APP_NAME__の学習記録を GIGA school の集計ページへ…
 *
 * しかも check-drift の 'app-name' は、照合のときに両側をこの形へそろえる。
 * だから「埋めた repo」と「埋めていない repo」が同じに見え、検査は緑のまま
 * になる。2026-08-30 に実測したところ、records-export.html を持つ 9 本の
 * うち 8 本がこの状態だった（埋まっていたのは 1 本だけ）。
 *
 * ── 埋めないもの ──────────────────────────────────────────────
 *
 * ⚠️ __APP_ID__ は、ここでは埋めない。
 *
 * あちらは記録ハブ（まなびクエスト）が突きあわせる識別子で、apps.json の
 * slug とは別物である。同じ日の実測で、9 本のうち 2 本が slug とちがう値を
 * 持っていた（KAKE_Master = kuku-card / online-100square-calculation =
 * square100）。slug から機械で埋めると、その 2 本の学習記録が届かなくなる。
 * 埋まっていないものは、埋めるのではなく知らせる。
 *
 * distribute.mjs は走らせると配布が始まるので、テストできるように
 * ここへ切り出してある。
 */

/** 正本が持っているプレースホルダーのうち、ここで埋めてよいもの */
export const NAME_TOKEN = '__APP_NAME__';

/** 埋めてはいけないもの（見つけたら知らせるだけ） */
export const ID_TOKEN = '__APP_ID__';

/**
 * data/apps.json を読んで、repo 名で引ける形にする。
 * 読めなければ空の Map を返す（配布そのものは止めない）。
 *
 * @param {string} appsJsonPath data/apps.json の場所
 * @param {(p: string, enc: string) => string} readFile
 * @returns {Map<string, object>}
 */
export function loadApps(appsJsonPath, readFile) {
  try {
    const parsed = JSON.parse(readFile(appsJsonPath, 'utf8'));
    const items = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
    return new Map(items.filter((a) => a && a.repo).map((a) => [a.repo, a]));
  } catch {
    return new Map();
  }
}

/**
 * 正本の中身の __APP_NAME__ を、その配布先の表示名で埋める。
 * 名前が分からないときは、そのまま返す（あとで警告する）。
 *
 * @param {string} text 正本の中身
 * @param {{name?: string}} [app] data/apps.json の 1 件
 * @returns {string}
 */
export function fillPlaceholders(text, app) {
  const name = typeof app?.name === 'string' ? app.name.trim() : '';
  if (!name) return String(text);
  return String(text).split(NAME_TOKEN).join(name);
}

/**
 * 配布先の中身が「まだ埋まっていない」か。
 *
 * check-drift の normalize は、埋めた値もプレースホルダーも同じ形へそろえて
 * しまうので、normalize の一致だけでは「配布先が自分で決めた値」と
 * 「配りっぱなしのプレースホルダー」を見分けられない。ここで見分ける。
 *
 * @param {string} text 配布先の中身
 * @returns {boolean}
 */
export const hasUnfilledPlaceholder = (text) => String(text).includes(NAME_TOKEN);

/**
 * 埋めてはいけないプレースホルダーが残っていないか。残っていたら、
 * 人が決めるべき値が抜けている（機械では埋められない）。
 *
 * @param {string} text 配布先の中身
 * @returns {boolean}
 */
export const hasUnfilledAppId = (text) => String(text).includes(ID_TOKEN);
