/**
 * GitHub から、各アプリのリポジトリの中身を取ってくるところ。
 *
 * ── なぜ 1 本に寄せたのか ────────────────────────
 *
 * まったく同じ「トークンで断られたら匿名でもう一度」の処理が
 * tools/build-articles.mjs と tools/build-devlog.mjs に 2 つあった。
 * マニュアルを足すと 3 つ目になる。
 *
 * 3 つに分かれていると、片方だけ直したときに「記事は取れるのに
 * マニュアルだけ取れない朝」が生まれる。しかも組み立ては
 * 「置いていないアプリ」と区別がつかないので、黙って飛ばす。
 * **誰も気づけない形で 1 本だけ落ちる。**
 *
 * ── 匿名で試し直す理由 ──────────────────────────
 *
 * 手元のトークンが他のリポジトリを読めないことがある。艦隊はどれも公開
 * リポジトリなので、認証を外せば読める。断られたときだけ 1 回やり直す。
 */

import { jstDate } from './dates.mjs';

export const OWNER = 'GIGAyama';
const RAW = 'https://raw.githubusercontent.com/';

const headers = (agent) => {
  const token = process.env.GITHUB_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'user-agent': agent,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
};

/**
 * GitHub API を叩く。断られたら、認証なしでもう一度だけ試す。
 *
 * @param {string} path `<repo>/contents/docs/note` のような、owner から下
 * @param {string} agent user-agent。どの道具が叩いたか分かるようにする
 * @returns {Promise<Response>}
 */
export async function ghApi(path, agent = 'giga-school-build') {
  const url = `https://api.github.com/repos/${OWNER}/${path}`;
  const h = headers(agent);
  let res = await fetch(url, { headers: h });
  if ((res.status === 401 || res.status === 403 || res.status === 404) && h.authorization) {
    const { authorization, ...anon } = h;
    res = await fetch(url, { headers: anon });
  }
  return res;
}

/**
 * リポジトリの中のファイル 1 本を取ってくる。「置いていない」と「取れなかった」を分ける。
 *
 * ⚠️ **この 2 つを混ぜてはいけない。** ghText は両方を空文字で返すので、
 *    42 本ぶんをまとめて集める側から見ると、GitHub が見えない朝と
 *    「まだ誰も書いていない朝」の区別がつかない。区別できないまま台帳を
 *    書き替えると、**見えなかっただけの朝に全部を消してコミットする**。
 *    2026-08-29 に紹介ページ 32 本が消えたのと同じ型
 *    （tools/build-articles.mjs の「1 本も組めなかったら書き替えない」を見ること）。
 *
 * @param {string} repo
 * @param {string} path リポジトリの中での道（`docs/CHANGELOG.md` など）
 * @param {string} [agent]
 * @returns {Promise<{text: string, missing: boolean, failed: boolean}>}
 */
export async function ghDoc(repo, path, agent) {
  try {
    const res = await ghApi(`${repo}/contents/${path}`, agent);
    /* ghApi は 401/403/404 のとき匿名でもう一度試す。それでも 404 なら、
       本当に置いていない（どれも公開リポジトリなので隠れて見えないことはない）。 */
    if (res.status === 404) return { text: '', missing: true, failed: false };
    if (!res.ok) return { text: '', missing: false, failed: true };
    const json = await res.json();
    if (json.encoding !== 'base64') return { text: '', missing: false, failed: true };
    return {
      text: Buffer.from(json.content, 'base64').toString('utf8'),
      missing: false,
      failed: false,
    };
  } catch (e) {
    return { text: '', missing: false, failed: true };
  }
}

/**
 * リポジトリの中のファイル 1 本を、文字として取ってくる。無ければ空文字。
 *
 * 「置いていない」のか「取れなかった」のかを見分けたいときは ghDoc を使う。
 *
 * @param {string} repo
 * @param {string} path リポジトリの中での道（`docs/CHANGELOG.md` など）
 * @param {string} [agent]
 * @returns {Promise<string>}
 */
export async function ghText(repo, path, agent) {
  return (await ghDoc(repo, path, agent)).text;
}

/**
 * そのファイルが最後に変わった日（日本時間）。取れなければ空文字。
 *
 * ⚠️ アプリの最終 push（app.updatedAt）で代えない。コードを 1 行直しただけの
 *    朝に、マニュアルまで「今日現在の画面です」になる。紙に刷って配るものなので、
 *    そこは嘘をつかない。
 *
 * ⚠️ この「代えない」は、マニュアルだけの話ではなかった。紹介記事のほうは
 *    app.updatedAt をそのまま使っていたので、2026-08-30 の時点で
 *    **sitemap の 90 URL 中 88 が同じ日付**になっていた。正本配布
 *    （.github/workflows/auto-distribute.yml）が 42 本のリポジトリへ毎日
 *    push するため、全部の push 日が同じ日に揃うのが原因。
 *    Google は lastmod が実態と合わないと**まるごと無視する**ので、
 *    本当に更新した 1 本も区別されなくなっていた。
 *
 * @param {string} repo
 * @param {string} path リポジトリの中での道（`docs/note/xxx.md` など）
 * @param {string} [agent]
 * @returns {Promise<string>} YYYY-MM-DD。取れなければ空文字
 */
export async function ghFileChangedAt(repo, path, agent) {
  try {
    const res = await ghApi(
      `${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`, agent);
    if (!res.ok) return '';
    const list = await res.json();
    const when = Array.isArray(list) ? list[0]?.commit?.committer?.date : null;
    return jstDate(when);
  } catch (e) {
    return '';
  }
}

/**
 * 正本配布を除いた、そのリポジトリの最後の更新日（日本時間）。分からなければ空文字。
 *
 * アプリ本体（<slug>.giga-school.com）の更新日には、リポジトリの push 日
 * （pushed_at）を使っていた。ところが正本配布は 42 本すべてへ同じ日に push するので、
 * **41 本ぜんぶが同じ updatedAt** になっていた。
 *
 * 配布のコミットは題で見分けられる（tools/distribute.mjs の BRANCH_NAME と PR_TITLE）。
 * 配布が書き替えるのは、道具（`.claude/` `.agents/` `tools/build-sw.mjs`）と、
 * 艦隊共通の写し（`web/giga-app-links.js`・`records-export.*`）と、それに合わせて
 * 刻み直す sw.js の版（2026-09-02 から）。公開されるファイルにも触れるが、どれも
 * 42 本に同じものが同じ日に入る**艦隊ぜんたいの手入れ**で、そのアプリを直した日では
 * ない。ここで欲しいのは後者なので、除いても取りこぼしは出ない。
 *
 * ⚠️ 落とすのはこの 2 つだけに絞る。`chore(sw)` や `chore(gate)` まで落とすと、
 *    Service Worker の版を刻み直した日＝**実際に配信物が変わった日**を見落とす。
 *    迷ったら残す側に倒す。
 *
 * ⚠️ 30 件ぜんぶが配布のコミットだったときは、嘘の日付を作らず空文字を返す。
 *    sitemap 側は空なら `<lastmod>` を出さない（省略は仕様どおり）。
 *
 * @param {string} repo
 * @param {string} [agent]
 * @returns {Promise<string>} YYYY-MM-DD。分からなければ空文字
 */
export async function ghContentChangedAt(repo, agent) {
  try {
    const res = await ghApi(`${repo}/commits?per_page=30`, agent);
    if (!res.ok) return '';
    const list = await res.json();
    if (!Array.isArray(list)) return '';
    const hit = list.find((c) => !isDistributionCommit(c?.commit?.message || ''));
    return jstDate(hit?.commit?.committer?.date);
  } catch (e) {
    return '';
  }
}

/**
 * 正本配布が作ったコミットか。
 *
 * 題は tools/distribute.mjs が定数で持っている（PR_TITLE / BRANCH_NAME）。
 * squash でマージしても題は残り、merge commit のほうは枝の名前が入る。
 */
export function isDistributionCommit(message) {
  const first = String(message).split('\n')[0];
  return first.startsWith('chore(standards): Sync with latest standards')
    || /^Merge pull request #\d+ from [\w.-]+\/chore\/sync-standards$/.test(first);
}

/**
 * 置き場の中から Markdown を 1 本拾う。無ければ null。
 *
 * @param {string} repo
 * @param {string} dir `docs/note` や `docs/manual`
 * @param {(name: string) => boolean} pick 名前で選ぶ
 * @param {string} [agent]
 * @returns {Promise<{path: string, markdown: string} | null>}
 */
export async function ghFindDoc(repo, dir, pick, agent) {
  const list = await ghApi(`${repo}/contents/${dir}`, agent);
  if (!list.ok) return null;                       // その置き場を持たないアプリ
  const entries = await list.json();
  if (!Array.isArray(entries)) return null;

  const hit = entries.find((e) => e.type === 'file' && e.name.endsWith('.md') && pick(e.name));
  if (!hit) return null;

  const markdown = await ghText(repo, hit.path, agent);
  return markdown ? { path: hit.path, markdown } : null;
}

/** その置き場にある Markdown の名前をぜんぶ。取れなければ空の配列。 */
export async function ghListMarkdown(repo, dir, agent) {
  const list = await ghApi(`${repo}/contents/${dir}`, agent);
  if (!list.ok) return [];
  const entries = await list.json();
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e.type === 'file' && e.name.endsWith('.md')).map((e) => e.name);
}

/** そのリポジトリの Pages が docs/ を配っているか。画像の URL の形が変わる。 */
export async function servesFromDocs(repo, agent) {
  const res = await ghApi(`${repo}/contents/docs/CNAME`, agent);
  return res.status === 200;
}

/** その URL が実際に返ってくるか。画像 1 枚で配信の形を見分ける。 */
export async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch (e) {
    return false;   // つながらないときは「届かない」側に倒す
  }
}

/**
 * 文書の中の相対パスを、実際に出す URL に変える 3 通りを組む。
 *
 * 記事もマニュアルも、画像はアプリのリポジトリに置いたままにしてある。
 * 読む先の候補は 3 つで、どれを指すかは呼ぶ側が pickImageUrl で決める。
 *
 * @param {object} o
 * @param {string} o.repo
 * @param {string} o.slug
 * @param {string} o.dir        文書のある置き場（`docs/note`）
 * @param {boolean} o.docsIsRoot Pages が docs/ を配っているか
 * @param {string} o.mirrorDir  自分のドメインの控えの置き場（`/assets/article`）
 * @returns {{onSubdomain: Function, onMirror: Function, onRaw: Function}}
 */
export function imageResolvers({ repo, slug, dir, docsIsRoot, mirrorDir }) {
  const resolve = (target) => `${dir}/${String(target).replace(/^\.\//, '')}`;
  const under = (prefix) => (target) =>
    /^[a-z][a-z0-9+.-]*:/i.test(target)          // すでに絶対 URL のものは触らない
      ? target
      : prefix(resolve(target));

  return {
    /* まずは自分のドメインで組む。読み手にとってはこちらが本筋 */
    onSubdomain: under((path) =>
      `https://${slug}.giga-school.com/${docsIsRoot ? path.replace(/^docs\//, '') : path}`),
    /* サブドメインから読めないときの置き場。WebP にして自分のドメインへ移してある。
       ここにあれば、学校が GitHub を塞いでいても画面写真が出る。 */
    onMirror: under((path) => {
      const name = path.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '.webp');
      return `${mirrorDir}/${slug}/${name}`;
    }),
    /* それも無いときの逃げ道。HEAD は既定のブランチを指す。 */
    onRaw: under((path) => `${RAW}${OWNER}/${repo}/HEAD/${path}`),
  };
}

export { RAW };
