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
 * リポジトリの中のファイル 1 本を、文字として取ってくる。無ければ空文字。
 *
 * @param {string} repo
 * @param {string} path リポジトリの中での道（`docs/CHANGELOG.md` など）
 * @param {string} [agent]
 * @returns {Promise<string>}
 */
export async function ghText(repo, path, agent) {
  try {
    const res = await ghApi(`${repo}/contents/${path}`, agent);
    if (!res.ok) return '';
    const json = await res.json();
    if (json.encoding !== 'base64') return '';
    return Buffer.from(json.content, 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
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
