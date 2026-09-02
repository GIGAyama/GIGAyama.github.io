/**
 * 配ったあとに「配布物から作るもの」を作り直す一覧を決める。
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 正本の写しの中には、配布先で**別のものの材料**になっているものがある。
 *
 *   ・web/giga-app-links.js … 静的 PWA では sw.js の先読み一覧に載っている
 *     （13 本）。中身が 1 バイト変われば sw.js の版も変わらなければならない。
 *     GAS のアプリでは同じものを giga_links.html に焼きこんでいる（7 本）。
 *   ・records-export.js / records-export.html / records-hub-client.js も
 *     先読み一覧に載っている。
 *
 * distribute.mjs は写して `git add .` するだけだったので、2026-08-30 の配布で
 * **材料だけ新しく、作ったものは古いまま**の main が 13 本できた。
 * 6 本が `build-sw.mjs --check` で、7 本が `build-app-links.mjs --check` で
 * 赤くなった。赤いだけならまだよい。sw.js の版が変わらないので、
 * **子どもの端末には新しい中身が一度も届かない**（2026-08-21 と同じ型）。
 *
 * ── 形 ────────────────────────────────────────────────
 *
 * ここは「何を走らせるか」を決めるだけの純関数。distribute.mjs は読みこむと
 * 配布が始まるのでテストできない。判定だけをここに置いて、実行は向こうで行う。
 *
 * ⚠️ 判定表（リポジトリ名の一覧）を自前で持たない。「その道具がそこに在るか」で
 *    決める。リポジトリ側に道具を足せば自動で拾われ、消せば自動で外れる。
 *    名前の表を持つと、13 本目を足したときに表だけ古いまま残る。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} repoDir 配布先リポジトリの直下
 * @param {object} [deps] テスト用の差しかえ口（exists / read）
 * @returns {{ cmd: string, why: string }[]} 走らせる順に並んだ一覧
 */
export function regenerationCommands(repoDir, deps = {}) {
  const { exists = fs.existsSync, read = fs.readFileSync } = deps;
  const has = (p) => exists(path.join(repoDir, p));
  const text = (p) => { try { return String(read(path.join(repoDir, p), 'utf8')); } catch { return ''; } };
  const out = [];

  /* 1. GAS へ焼きこむもの。sw.js より先に走らせる
        （焼きこんだ HTML を先読みに載せる形になっても、順番で壊れないように）。 */
  if (has('tools/build-app-links.mjs')) {
    out.push({
      cmd: 'node tools/build-app-links.mjs',
      why: 'web/giga-app-links.js を giga_links.html へ焼き直す',
    });
  }

  /* 2. SW の版。**静的型だけ**（コミットされている sw.js に刻むもの）。
        Vite 型は dist/sw.js に刻む。dist/ はコミットされず、ビルドのたびに
        刻まれるので、ここで走らせても見るものが無い（ビルド前なら落ちる）。
        見分けは中身で行う。`__PRECACHE_URLS__` の目印は Vite 型にしか無い。 */
  for (const p of ['tools/build-sw.mjs', 'scripts/build-sw.mjs']) {
    if (!has(p)) continue;
    const src = text(p);
    if (!src.includes('__APP_VERSION__') || src.includes('__PRECACHE_URLS__')) continue;
    out.push({ cmd: `node ${p}`, why: '先読み対象が変わっていれば sw.js の版を刻み直す' });
    break;
  }
  return out;
}
