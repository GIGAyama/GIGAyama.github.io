#!/usr/bin/env node
/**
 * 【正本】standards/web/verify-no-external.mjs
 *
 * 実ブラウザでページを開き、**出ていった通信をぜんぶ記録して**、
 * 宣言していない外部ホストがあれば落とす。
 *
 *   node verify-no-external.mjs --dist dist --base /Typa/      手元のビルド成果物
 *   node verify-no-external.mjs --url https://typa.giga-school.com/   公開中の画面
 *   node verify-no-external.mjs --url … --json                 実測ホストを JSON で出す
 *
 * ── なぜ要るのか ──────────────────────────────────────
 *
 * 2026-08-28、Zero-CDN の静的検査が「0 件」と言っているのに、ブラウザは
 * 外を読んでいた。3 件あって、**どれも静的検査を素通りしていた。**
 *
 *   ① スキームを省いた //cdn.jsdelivr.net/…（`https?://` でしか見ていなかった）
 *   ② <img src> で外部 CDN から絵を取っていた（script/link/iframe しか見ていなかった）
 *   ③ 印刷ウィンドウの中から @import していた（別ウィンドウなので誰も見ていない）
 *
 * 見つけたのは、実ブラウザに読ませて通信を記録したときである。
 * それ以来 CLAUDE.md には「静的検査が 0 件でも信じるな」と書いてあるが、
 * **その手順は自動化されていなかった。** 次に同じ型が入っても、また人が
 * 手で見つけるしかない。ここはその手順を機械にするためのもの。
 *
 * ── 何を見るか ────────────────────────────────────────
 *
 * ブラウザの文脈（BrowserContext）ごと記録する。ページ単位ではない。
 *   ・別ウィンドウ（印刷プレビューなど）も同じ文脈に出るので ③ が捕まる
 *   ・CSS の @import も img も、ブラウザから見れば同じ「要求」なので ①② も捕まる
 *   ・Service Worker が代わりに取りにいくものも文脈の要求として出る
 *
 * ── 許した外部ホストの読み方 ──────────────────────────
 *
 * 新しい宣言の形は作らない。各リポジトリは既に quality.config.json の
 * securityExceptions で理由つきに許している（2026-08-28 時点で 13 本）。
 * 宣言の場所を 2 つにすると、片方だけ直したときに食い違う。
 *
 * ── 「0 件でした」を信じない ──────────────────────────
 *
 * ⚠️ 画面を開けていないときは、**合格ではなく失敗**にする。
 *    「外を読んでいない」の証拠にはならないため。ここを合格にすると、
 *    この検査そのものが「何も見ずに緑を出す道具」になる。
 *    2026-08-28 に giga-reviewer が実際にそうなっていた（入口判定の誤りで
 *    何も検査せず exit 0）。
 *
 *    ⚠️⚠️ **数えるのは「成功した応答」であって、要求の数ではない。**
 *    最初は要求の数で見ていたが、実測で穴が出た。接続できない URL
 *    （`--url http://127.0.0.1:9/…`）に対して
 *
 *        ✅ 宣言していない外部への通信はありません（2 件の要求を記録）  exit=0
 *
 *    と返した。開けなかった navigation の要求そのものが記録されるためで、
 *    「0 件を信じない」の守りが 1 つずれていた。防ごうとした当の形に
 *    自分がはまっていたので、応答（status < 400）を数える形に直してある。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/* ⚠️ note-article スキルの capture.mjs / serve.mjs にも同じような処理がある。
      あちらは .claude/skills/ へ配られる自己完結のスキルで、配布先に
      standards/ は無いので import できない。だから小さく写してある。
      直すときは両方を見ること（片方だけ直すと、撮影と検査で挙動が変わる）。 */

/** Chromium のありか。見つからなければ playwright に任せる */
export function findChromium(env = process.env, deps = {}) {
  const { exists = fs.existsSync, readdir = fs.readdirSync } = deps;
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const root = env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !exists(root)) return undefined;
  const dirs = readdir(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const dir of dirs) {
    for (const rel of [
      'chrome-linux/chrome', 'chrome-linux64/chrome',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe',
    ]) {
      const p = path.join(root, dir, rel);
      if (exists(p)) return p;
    }
  }
  return undefined;
}

/**
 * リポジトリが宣言している「許した外部ホスト」。
 * giga-reviewer の allowedHosts と同じところを、同じ形で読む。
 */
export function declaredHosts(targetDir, readFile = fs.readFileSync) {
  let cfg;
  try { cfg = JSON.parse(readFile(path.join(targetDir, 'quality.config.json'), 'utf-8')); }
  catch { return []; }
  const rows = Array.isArray(cfg.securityExceptions) ? cfg.securityExceptions : [];
  return rows
    .filter((r) => r && r.rule === 'external-runtime-host' && typeof r.value === 'string')
    .map((r) => r.value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 記録した要求のうち、宣言していない外部ホストを返す。
 *
 * @param {string[]} urls 記録した要求の URL
 * @param {string} pageOrigin ページ自身のオリジン（ここは外部ではない）
 * @param {string[]} allowed 宣言済みホスト
 */
export function undeclared(urls, pageOrigin, allowed) {
  const ok = new Set(allowed.map((h) => h.toLowerCase()));
  const self = (() => { try { return new URL(pageOrigin).host.toLowerCase(); } catch { return ''; } })();
  const found = new Map();   // host → 最初に見つかった URL
  for (const u of urls) {
    let host;
    try {
      const parsed = new URL(u);
      // data: blob: about: chrome-extension: は外に出ない
      if (!/^https?:$/.test(parsed.protocol)) continue;
      host = parsed.host.toLowerCase();
    } catch { continue; }
    if (host === self) continue;
    // 宣言は「そのホスト」か「その親ドメイン」で許す
    if (ok.has(host)) continue;
    if ([...ok].some((a) => host === a || host.endsWith(`.${a}`))) continue;
    if (!found.has(host)) found.set(host, u);
  }
  return [...found].map(([host, url]) => ({ host, url }));
}

/** dist/ を本番と同じサブパスの下で配る。外への口はいっさい開けない */
export function serveDist(root, base, port = 0) {
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json',
  };
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (prefix !== '/' && rel.startsWith(prefix)) rel = rel.slice(prefix.length - 1);
    if (rel.endsWith('/')) rel += 'index.html';
    /* ⚠️ .. を含む要求は外へ出さない。検査の道具が、検査している当のものより
          広い権限で動いてはいけない。 */
    const abs = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!abs.startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
    fs.readFile(abs, (err, body) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

async function main() {
  const distDir = arg('dist');
  const liveUrl = arg('url');
  const base = arg('base', '/');
  const asJson = process.argv.includes('--json');
  const repoDir = arg('config', process.cwd());
  const extraAllow = (arg('allow', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  /* 画面を歩く。押す文字をカンマ区切りで渡す。印刷など、開かないと
     出てこない通信があるため（2026-08-28 の ③ がまさにこれ）。 */
  const visit = (arg('visit', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!distDir && !liveUrl) {
    console.error('使い方: node verify-no-external.mjs (--dist <dir> --base <path> | --url <URL>) [--visit "文字,文字"] [--allow host,host] [--json]');
    process.exit(2);
  }

  const chromium = await (async () => {
    try { return createRequire(path.join(process.cwd(), 'x.js'))('playwright').chromium; }
    catch {
      try { return (await import('playwright')).chromium; }
      catch {
        console.error('playwright が見つかりません。リポジトリの中で次を実行してから、もう一度:');
        console.error('  npm i --no-save playwright');
        process.exit(2);
      }
    }
  })();

  let stop = null;
  let target = liveUrl;
  if (distDir) {
    const { server, port } = await serveDist(distDir, base);
    stop = () => new Promise((r) => server.close(r));
    target = `http://127.0.0.1:${port}${base.endsWith('/') ? base : `${base}/`}`;
  }

  const allowed = [...declaredHosts(repoDir), ...extraAllow];
  const seen = [];
  /* ⚠️ 要求の数だけでは「開けた」ことにならない。
        開けなかった URL でも、失敗した navigation の要求そのものは記録される。
        実測で `--url http://127.0.0.1:9/…`（接続できない）が
        「2 件の要求を記録」→ 合格になった。数えるのは**成功した応答**にする。 */
  let okResponses = 0;
  const browser = await chromium.launch({ executablePath: findChromium() });
  /* Service Worker が代わりに取りにいくものも記録したいので許可する */
  const context = await browser.newContext({ serviceWorkers: 'allow' });

  /* ⚠️ page ではなく context で受ける。別ウィンドウ（印刷プレビュー）も
        同じ文脈に出るので、ここで受ければ ③ の型が捕まる。 */
  context.on('request', (r) => seen.push(r.url()));
  context.on('response', (r) => { if (r.status() < 400) okResponses += 1; });

  let openError = null;
  try {
    const page = await context.newPage();
    /* ⚠️ 開けなかったことを例外のまま投げない。下の「0 件を信じない」で
          理由つきに落としたい。stack trace だけを見せると、
          「検査が壊れた」のか「画面が開けない」のかが読み手に分からない。 */
    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) { openError = e; }
    for (const label of visit) {
      try {
        await page.getByText(label, { exact: false }).first().click({ timeout: 5000 });
        await page.waitForTimeout(1500);
      } catch { console.error(`（「${label}」は押せませんでした。歩けた範囲だけで見ています）`); }
    }
    await page.waitForTimeout(1500);   // 遅れて出る要求を拾う
  } finally {
    await context.close();
    await browser.close();
    if (stop) await stop();
  }

  const origin = (() => { try { return new URL(target).origin; } catch { return ''; } })();
  const problems = undeclared(seen, origin, allowed);

  if (asJson) {
    const hosts = [...new Set(undeclared(seen, origin, []).map((p) => p.host))].sort();
    console.log(JSON.stringify({ target, requests: seen.length, hosts, undeclared: problems }, null, 2));
  }

  /* 「0 件でした」を信じない。何も記録できていないなら、それは合格ではない */
  if (okResponses === 0) {
    console.error('❌ 画面を開けていません（成功した応答が 1 つもありません）。');
    console.error(`   ${target} … 要求 ${seen.length} 件、成功した応答 0 件`);
    if (openError) console.error(`   理由: ${String(openError.message).split('\n')[0]}`);
    console.error('');
    console.error('   ⚠️ 要求の数では「開けた」ことになりません。開けなかった URL でも、');
    console.error('      失敗した navigation の要求そのものは記録されるためです。');
    console.error('   「外を読んでいない」の証拠にはならないので、合格にはしません。');
    return 1;
  }

  if (problems.length === 0) {
    if (!asJson) console.log(`✅ 宣言していない外部への通信はありません（要求 ${seen.length} 件・成功した応答 ${okResponses} 件を実ブラウザで記録）`);
    return 0;
  }

  console.error(`❌ 宣言していない外部ホストへ ${problems.length} 件、実際に通信しました:`);
  for (const { host, url } of problems) console.error(`  - ${host}   ${url.slice(0, 120)}`);
  console.error('');
  console.error('直し方:');
  console.error('  ・書体      → standards/fonts/build-fonts.mjs で自己ホスト化');
  console.error('  ・ライブラリ → standards/vendor/build-vendor.mjs で取りこむ');
  console.error('  ・意図して外を読むなら quality.config.json の securityExceptions に');
  console.error('    { "rule": "external-runtime-host", "value": "<host>", "reason": "…" } を書く');
  return 1;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main().then((code) => process.exit(code));
