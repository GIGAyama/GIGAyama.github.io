/**
 * 紹介ページの画面写真を、どこから読むか。
 *
 * 記事の画像はアプリのリポジトリに置いたままにしてある。読む先の候補は3つ。
 *
 *   1. そのアプリのサブドメイン  たいていはここで公開されている
 *   2. 自分のドメインの控え      tools/build-article-images.py が WebP にして移した控え。
 *                                学校が GitHub を塞いでいてもここなら出る
 *   3. raw.githubusercontent.com  控えがまだ無いときの逃げ道
 *
 * 1 が使えないときに 2 と 3 のどちらを指すかを、ここで決める。
 */

/**
 * 控えにあるものは控えを、無いものだけ raw を指す「1 枚ごとの」選び手を返す。
 *
 * ⚠️ ここは以前、記事まるごとで決めていた。1 枚目の控えがあれば
 *    「記事 1 本ぶんはまとめて移すのだから全部ある」とみなす作りだったが、
 *    あとから画像を足したときに崩れる。足した 1 枚だけ控えが無いのに
 *    記事ぜんぶが控えを指し、その 1 枚が黙って消える。
 *    2026-08-25 に qalc で、足した 2 枚が出ず、撮り直した 5 枚が古いまま
 *    残っているのが見つかった。1 枚ずつ見れば、どちらも起きない。
 *
 * @param {Set<string>} inMirror  控えの置き場にあるファイル名（`01-home.webp` など）
 * @param {(target: string) => string} onMirror  控えの URL を組む
 * @param {(target: string) => string} onRaw     raw の URL を組む
 * @returns {(target: string) => string}
 */
export const pickImageUrl = ({ inMirror, onMirror, onRaw }) => (target) => {
  const url = onMirror(target);
  return inMirror.has(url.replace(/^.*\//, '')) ? url : onRaw(target);
};
