/**
 * 校内のフィルタリングで許可が要るアドレス。
 *
 * ── なぜ要るのか ────────────────────────────────
 *
 * 31 本の紹介記事のうち 29 本が「校内のフィルタリングで許可を」と書いている。
 * ただし、それぞれの記事の中だけ。一覧はどこにも無かった。
 *
 * 先生が情報担当に申請を出すとき、いまは 38 本の記事を開いて拾い集めることになる。
 * しかもアプリごとに要るものが違う（書体だけのもの、Google のログインが要るもの、
 * 端末どうしをつなぐもの）。ここを 1 枚にまとめる。
 *
 * ── この表の作り方 ──────────────────────────────
 *
 * 記事の文章からは拾っていない。文章は書き換わるし、実際に 31 本のうち
 * 22 本からは何も拾えなかった。**アプリが実際に読み込んでいるもの**を見ている。
 *
 *   1. 配られるファイル（html / js / css）の中の「読み込み」を数える
 *      script src / link rel=stylesheet・preload / img・iframe の src /
 *      CSS の url() と @import / fetch / Worker / import() / STUN・TURN
 *   2. CSP の宣言（frame-src / connect-src / font-src …）も見る
 *
 * 2 つ見るのは、片方では足りないため。GAS のアプリは iframe の行き先を
 * 実行時に決めるので、配られるファイルに script.google.com という文字列が出ない。
 * 逆に「どくしょちょきんばこ」は本の情報を実行時に取りに行くので、
 * CSP を見ないと api.openbd.jp が落ちる。
 *
 * ⚠️ <a href> は数えない。遷移であって、ブラウザは取りに行かない。
 *    og:image と canonical も数えない。SNS のクローラ向けで、教室の端末は見ない。
 *    ここを混ぜると、要らないアドレスまで情報担当に出させることになる。
 *
 * ⚠️ GAS の UrlFetchApp.fetch も数えない。**Google のサーバー側で動く。**
 *    端末からは出て行かないので、学校の許可は要らない。
 *    （これを数えていたときは、道徳ノートに www.google.com が並んでいた）
 */

/**
 * 塞がれたときに何が起きるか。学校は「全部は開けられない」ことが多いので、
 * どれを優先して通せばよいかが分かるようにしておく。
 */
export const LEVEL_LABEL = {
  must: '塞ぐと使えません',
  partial: '塞ぐと一部が使えません',
  look: '塞いでも使えます',
};

/** 何のためのアドレスか。先生がそのまま情報担当に説明できる言い方にする */
export const HOST_INFO = {
  'fonts.googleapis.com':   { level: 'look',    why: '読みやすい書体を読む（無くても字の形が変わるだけ）' },
  'fonts.gstatic.com':      { level: 'look',    why: '読みやすい書体を読む（無くても字の形が変わるだけ）' },
  'cdn-icons-png.flaticon.com': { level: 'look', why: '画面の小さな絵を読む' },
  'raw.githubusercontent.com':  { level: 'look', why: '画面写真を読む' },

  'cdn.jsdelivr.net':       { level: 'must',    why: 'アプリの部品を読む' },
  'cdn.tailwindcss.com':    { level: 'must',    why: 'アプリの見た目の部品を読む' },
  'cdnjs.cloudflare.com':   { level: 'must',    why: 'アプリの部品を読む' },
  'unpkg.com':              { level: 'must',    why: 'アプリの部品を読む' },

  'script.google.com':      { level: 'must',    why: 'アプリ本体が動く場所' },
  'googleusercontent.com':  { level: 'must',    why: 'アプリ本体の中身が表示される場所' },
  'accounts.google.com':    { level: 'must',    why: 'Google アカウントのログイン' },
  'apis.google.com':        { level: 'must',    why: 'Google アカウントのログイン' },
  'oauth2.googleapis.com':  { level: 'must',    why: 'Google アカウントのログイン' },
  'openidconnect.googleapis.com': { level: 'must', why: 'Google アカウントのログイン' },
  'www.googleapis.com':     { level: 'must',    why: 'Google のサービスとのやりとり' },
  'drive.google.com':       { level: 'must',    why: 'Google ドライブへの保存' },

  'generativelanguage.googleapis.com': { level: 'partial', why: 'AI の機能を使うときだけ' },
  '0.peerjs.com':           { level: 'partial', why: 'みんなでやるとき、へやの番号をやりとりする' },
  'stun.l.google.com':      { level: 'partial', why: 'みんなでやるとき、端末どうしをつなぐ' },
  'eu-0.turn.peerjs.com':   { level: 'partial', why: 'みんなでやるとき、端末どうしをつなぐ' },
  'us-0.turn.peerjs.com':   { level: 'partial', why: 'みんなでやるとき、端末どうしをつなぐ' },
  'api.openbd.jp':          { level: 'partial', why: '本の情報を引くときだけ' },
  'ndlsearch.ndl.go.jp':    { level: 'partial', why: '本の情報を引くときだけ（国立国会図書館）' },
};

/** 並べる順。塞いだときの影響が大きいものから */
const ORDER = { must: 0, partial: 1, look: 2 };

/**
 * 表示する順に並べる。同じ重さのものは名前順。
 *
 * @param {string[]} hosts
 * @returns {string[]}
 */
export function sortHosts(hosts) {
  return [...(hosts ?? [])].sort((a, b) => {
    const d = (ORDER[HOST_INFO[a]?.level] ?? 9) - (ORDER[HOST_INFO[b]?.level] ?? 9);
    return d || a.localeCompare(b);
  });
}

/**
 * アプリ 1 本を動かすのに要るアドレス。自分のサブドメインは必ず要る。
 *
 * @param {{slug: string, hosts?: string[]}} app
 * @returns {string[]}
 */
export function hostsOf(app) {
  return [`${app.slug}.giga-school.com`, ...sortHosts(app.hosts)];
}
