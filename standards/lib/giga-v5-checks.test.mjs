/**
 * 【正本】品質ゲート（giga-v5-checks.mjs）自身のテスト。
 *
 * なぜ要るか：
 *   「0件でした」だけでは、検査が動いているのか何も見ていないのか区別できない。
 *   わざと壊した木を作って、ちゃんと拾えることを確かめる。
 *   逆に、正しく書いてあるものを誤って拾わないことも確かめる
 *   （実際、コメントの文言・@supports のフォールバック・"install" の
 *   ダブルクォート・ハンドラの並び順で誤検知/見逃しが起きた）。
 *
 * 実リポジトリを壊す自己テスト（各リポジトリの --self-test）とは役割が違う。
 * こちらは**検査器そのもの**を、リポジトリに依存しない合成ツリーで検査する。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runGigaChecks, stripComments, handlerBody } from './giga-v5-checks.mjs';

/** 完全不透明の最小 PNG（colorType 2 = RGB、α なし） */
function opaquePng() {
  // pngHasAlpha は署名と 25 バイト目の colorType だけを見る
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b[25] = 2;
  return b;
}
/** α チャンネルつきの体裁の PNG（colorType 6。IDAT が読めないときは安全側=透明あり） */
function alphaPng() {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b[25] = 6;
  return b;
}

function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giga-v5-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const CONFIG = { repoName: 'Demo_App', sw: 'static' };

function failures(files, config = {}) {
  const dir = makeTree(files);
  return runGigaChecks(dir, { ...CONFIG, ...config }).filter((r) => !r.ok);
}
const ids = (rs) => rs.map((r) => r.id);

// 最低限そろっている木（これを基準に、1つずつ壊す）
const OK_TREE = {
  'LICENSE': 'MIT License\nCopyright (c) 2026 GIGA山\n',
  '.gitignore': 'node_modules/\n.env\n',
  '.github/dependabot.yml': 'version: 2\n',
  '.github/workflows/ci.yml': 'on:\n  pull_request:\n  push:\n    branches: [main]\n',
  'README.md': '# Demo', 'MANUAL.md': '# 手引き', 'AUDIT.md': '# 記録',
  'CNAME': 'demo-app.giga-school.com\n',
  'index.html': `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';">
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">
<script src="./install-hook.js"></script>
</head><body>
<img src="./icons/icon-192.png" width="64" height="64" alt="アイコン">
<script src="./js/app.js"></script>
</body></html>`,
  'offline.html': '<!DOCTYPE html><html><body><p>つながっていません</p><a href="./">もういちどひらく</a></body></html>',
  'install-hook.js': 'window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.deferredPrompt = e; });',
  'manifest.webmanifest': JSON.stringify({
    id: './', scope: './', start_url: './',
    icons: [
      { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: './icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: './icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }),
  'icons/icon-192.png': opaquePng(),
  'icons/icon-512.png': opaquePng(),
  'icons/maskable-192.png': opaquePng(),
  'icons/maskable-512.png': opaquePng(),
  'icons/apple-touch-icon.png': opaquePng(),
  'js/app.js': `// localStorage.clear() とコメントに書いても反応しないこと
addEventListener('pagehide', () => save());
function save() {}
function askUpdate(reg) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
let userAskedUpdate = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!userAskedUpdate) return;
  location.reload();
});
if (document.readyState === 'complete') navigator.serviceWorker.register('./sw.js');
else addEventListener('load', () => { if (document.readyState === 'complete') navigator.serviceWorker.register('./sw.js'); });`,
  'css/style.css': `#app { height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
@supports not (height: 100dvh) { #app { height: 100vh; } }
h1 { font-size: clamp(1.2rem, 4vw, 2rem); }
p { font-size: clamp(1rem, 3vw, 1.4rem); }
small { font-size: clamp(.8rem, 2vw, 1rem); }
@media (prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
@media (forced-colors: active) { button { border: 1px solid ButtonText; } }`,
  'sw.js': `const CACHE_PREFIX = 'demo-';
const APP_VERSION = 'v1a2b3c4d'; /* __APP_VERSION__ */
const PRECACHE_URLS = ['./', './index.html', './offline.html'];
/* localStorage はさわらない、という注意書きに反応しないこと */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_PREFIX + APP_VERSION).then((c) => c.addAll(PRECACHE_URLS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)))));
});
self.addEventListener("message", (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/')) return;
});`,
  'tools/build-sw.mjs': '// 正本 standards/sw/build-sw-static.mjs のコピー（テストでは中身は見ない）\n',
};

test('正しく書けている木では何も落ちない（誤検知していない）', () => {
  assert.deepEqual(failures(OK_TREE), []);
});

// ---------------- 誤検知しないこと（過去に実際に踏んだもの） ----------------

test('コメントの中の localStorage / localStorage.clear() を誤検知しない', () => {
  // OK_TREE の js/app.js と sw.js に注意書きが入っている。上の 0 件で担保されるが、
  // 個別にも見ておく（このケースだけ通って他が落ちる崩れ方を見分けるため）
  const f = ids(failures(OK_TREE));
  assert.ok(!f.includes('C_NO_LS_CLEAR'));
  assert.ok(!f.includes('E_SW_NO_LOCALSTORAGE'));
});

test('@supports のフォールバックの 100vh を誤検知しない', () => {
  assert.ok(!ids(failures(OK_TREE)).includes('D_DVH'));
});

test('カスケード上書き（min-height:100vh; の直後に 100dvh）を誤検知しない', () => {
  // 実際に shiritori_fighter の css がこの形だった
  const tree = {
    ...OK_TREE,
    'css/style.css': OK_TREE['css/style.css']
      + '\n.app { min-height: 100vh; min-height: 100dvh; }',
  };
  assert.ok(!ids(failures(tree)).includes('D_DVH'));
});

test('start_url のクエリ（./?source=pwa）を誤検知しない', () => {
  // 実際に keisan-card の manifest がこの形だった
  const j = JSON.parse(OK_TREE['manifest.webmanifest']);
  j.start_url = './?source=pwa';
  const tree = { ...OK_TREE, 'manifest.webmanifest': JSON.stringify(j) };
  assert.ok(!ids(failures(tree)).includes('E_MANIFEST_ID'));
});

test('@supports not (min-height: 100dvh) のフォールバックも誤検知しない', () => {
  // 実際に omp-lite の offline.html がこの形で、height 決め打ちの検査が誤検知した
  const tree = {
    ...OK_TREE,
    'css/style.css': OK_TREE['css/style.css']
      + '\n@supports not (min-height: 100dvh) { body { min-height: 100vh; } }',
  };
  assert.ok(!ids(failures(tree)).includes('D_DVH'));
});

test('minify された controllerchange の見はり（!H||U|| 形）を誤検知しない', () => {
  // 実際に omp-lite の js/app.js（minify 済み）がこの形だった
  const minified = 'navigator.serviceWorker.addEventListener("controllerchange",()=>{!H||U||(U=!0,location.reload())});';
  const replaced = OK_TREE['js/app.js'].replace(
    /navigator\.serviceWorker\.addEventListener\('controllerchange'[\s\S]*?\}\);/, minified);
  assert.ok(replaced.includes(minified) && !replaced.includes("'controllerchange'"), '置きかえが空振りした');
  const tree = { ...OK_TREE, 'js/app.js': replaced };
  assert.ok(!ids(failures(tree)).includes('E_SW_UPDATE_PROMPT'));
});

test('無条件の controllerchange reload は拾う', () => {
  const minified = 'navigator.serviceWorker.addEventListener("controllerchange",()=>{location.reload()});';
  const replaced = OK_TREE['js/app.js'].replace(
    /navigator\.serviceWorker\.addEventListener\('controllerchange'[\s\S]*?\}\);/, minified);
  assert.ok(!replaced.includes("'controllerchange'"), '置きかえが空振りした');
  const tree = { ...OK_TREE, 'js/app.js': replaced };
  assert.ok(ids(failures(tree)).includes('E_SW_UPDATE_PROMPT'));
});

test('説明文の中の <style> から本物の </style> までを CSS として読まない', () => {
  // Quarto の index.html にあった形。CSP の注意書きに「<style> を差し込む」と
  // 書いてあり、そこから本物の </style> までの 3,164 文字が CSS として
  // 読まれていた。本物の CSS から指定を消しても、説明文の語で通っていた。
  const tree = { ...OK_TREE };
  // 説明文の中の <style> と、そのあとにある本物の <style> ブロック。
  // 本物の閉じタグまでが1つの塊として読まれてしまうのが、この壊れ方。
  tree['index.html'] = tree['index.html'].replace('<head>',
    "<head>\n  <!-- 注意: ライブラリが <style> を差し込むので prefers-reduced-motion の話はここに書く -->\n"
    + '  <style>.boot { color: #333; }</style>');
  tree['css/style.css'] = tree['css/style.css']
    .replace(/@media \(prefers-reduced-motion: reduce\)/, '@media (nothing-at-all)');
  const failed = ids(failures(tree));
  assert.ok(failed.includes('D_REDUCED_MOTION'), `説明文で満たされました: ${failed.join(', ')}`);
});

test('CNAME を配信の起点に置くリポジトリでも見る（黙って通さない）', () => {
  // SchoolPlan_Editor は docs/CNAME を持つ。直下に決め打ちしていたころは
  // 「独自ドメインをつかっていません」と言って素通りしていた（2026-08-23）。
  const tree = {};
  for (const [k, v] of Object.entries(OK_TREE)) tree[`docs/${k}`] = v;
  tree['docs/CNAME'] = 'example.com\nsecond.example.com\n';   // 2行あるので落ちるはず
  const cfg = {
    entryHtml: 'docs/index.html', siteRoot: 'docs', swSource: 'docs/sw.js',
    manifest: 'docs/manifest.webmanifest', jsDirs: ['docs/js'], cssDirs: ['docs/css'],
    htmlFiles: ['docs/index.html', 'docs/offline.html'], imageDirs: ['docs/icons'],
  };
  assert.ok(ids(failures(tree, cfg)).includes('E_CNAME'));
});

test('CNAME が直下にあるリポジトリも、これまでどおり見る', () => {
  const tree = { ...OK_TREE, 'CNAME': 'example.com\nsecond.example.com\n' };
  assert.ok(ids(failures(tree)).includes('E_CNAME'));
});

test('入口のページを docs/ に置くリポジトリでも、CSP と viewport を見る', () => {
  // SchoolPlan_Editor は GitHub Pages を docs/ から配る。入口が
  // docs/index.html なので、決め打ちのままでは「index.html がありません」で
  // まとめて落ちていた（2026-08-23）。
  const tree = {};
  for (const [k, v] of Object.entries(OK_TREE)) tree[`docs/${k}`] = v;
  const cfg = {
    entryHtml: 'docs/index.html',
    siteRoot: 'docs',
    swSource: 'docs/sw.js',
    manifest: 'docs/manifest.webmanifest',
    jsDirs: ['docs/js'],
    cssDirs: ['docs/css'],
    htmlFiles: ['docs/index.html', 'docs/offline.html'],
    imageDirs: ['docs/icons'],
  };
  const failed = ids(failures(tree, cfg));
  for (const id of ['B_CSP', 'B_NO_INLINE_SCRIPT', 'D_VIEWPORT', 'E_INSTALL_HOOK']) {
    assert.ok(!failed.includes(id), `${id} が落ちました: ${failed.join(', ')}`);
  }
});

test('入口のページの指定が効かないと、docs/ 型は落ちる（受け皿の確認）', () => {
  const tree = {};
  for (const [k, v] of Object.entries(OK_TREE)) tree[`docs/${k}`] = v;
  // entryHtml を既定（直下の index.html）のままにすると見つからない
  const failed = ids(failures(tree, { siteRoot: 'docs', swSource: 'docs/sw.js', manifest: 'docs/manifest.webmanifest' }));
  assert.ok(failed.includes('D_VIEWPORT'), failed.join(', '));
});

test('版の目印が値そのものの形（vite-plugin-pwa 型）も自動生成と認める', () => {
  // Quarto の src/sw.js がこの形。build-sw-vite.mjs（正本）は両方に対応して
  // いるのに、ゲートだけが「手書きだ」と落としていた（2026-08-23）。
  const tree = { ...OK_TREE };
  tree['sw.js'] = tree['sw.js'].replace(
    /const APP_VERSION = '[^']*'; \/\* __APP_VERSION__ \*\//,
    "const APP_VERSION = '__APP_VERSION__';");
  assert.ok(tree['sw.js'].includes("'__APP_VERSION__';"), '置きかえが空振りした');
  assert.ok(!ids(failures(tree, { sw: 'vite', swSource: 'sw.js' })).includes('E_SW_VERSION_GENERATED'));
});

test('版の目印がどこにも無ければ、やはり落とす', () => {
  const tree = { ...OK_TREE };
  tree['sw.js'] = tree['sw.js'].replace(/const APP_VERSION = '[^']*'; \/\* __APP_VERSION__ \*\//,
    "const APP_VERSION = 'v9';");
  assert.ok(ids(failures(tree, { sw: 'vite', swSource: 'sw.js' })).includes('E_SW_VERSION_GENERATED'));
});

test('先読みを __WB_MANIFEST に任せる形は、宣言があれば通す', () => {
  const tree = { ...OK_TREE };
  tree['sw.js'] = tree['sw.js'].replace(/const PRECACHE_URLS = \[[^\]]*\];/,
    'const PRECACHE_URLS = (self.__WB_MANIFEST || []).map((e) => e.url);');
  assert.ok(tree['sw.js'].includes('__WB_MANIFEST'), '置きかえが空振りした');
  tree['sw-build.config.json'] = '{ "precacheManagedByPlugin": true }';
  assert.ok(!ids(failures(tree, { sw: 'vite', swSource: 'sw.js' })).includes('E_SW_PRECACHE_OFFLINE'));
});

test('先読みを __WB_MANIFEST に任せているのに宣言が無ければ落とす（黙って素通りさせない）', () => {
  const tree = { ...OK_TREE };
  tree['sw.js'] = tree['sw.js'].replace(/const PRECACHE_URLS = \[[^\]]*\];/,
    'const PRECACHE_URLS = (self.__WB_MANIFEST || []).map((e) => e.url);');
  assert.ok(ids(failures(tree, { sw: 'vite', swSource: 'sw.js' })).includes('E_SW_PRECACHE_OFFLINE'));
});

test('見はりを消した controllerchange を、すぐ下の別の関数の if (!x) で見のがさない', () => {
  // Reversi の移行（2026-08-23）で見つかった見のがし。
  // 見はりの行を丸ごと消しても、90文字ほど下にある
  //   const notify = (worker) => { if (!worker) return; … }
  // が 400 文字の窓に入り、「見はりがある」と読めて緑のままだった。
  const broken = [
    "navigator.serviceWorker.addEventListener('controllerchange', () => {",
    '  reloading = true;',
    '  window.location.reload();',
    '});',
    '',
    'const notify = (worker) => {',
    '  if (!worker) return;',
    "  worker.postMessage({ type: 'SKIP_WAITING' });",
    '};',
  ].join('\n');
  const replaced = OK_TREE['js/app.js'].replace(
    /navigator\.serviceWorker\.addEventListener\('controllerchange'[\s\S]*?\}\);/, broken);
  assert.ok(replaced.includes('const notify'), '置きかえが空振りした');
  const tree = { ...OK_TREE, 'js/app.js': replaced };
  assert.ok(ids(failures(tree)).includes('E_SW_UPDATE_PROMPT'));
});

test('ハンドラ本体は中かっこの対応で切り出す（隣の関数を巻きこまない）', () => {
  const js = "addEventListener('x', () => { a(); }); const next = () => { if (!y) return; };";
  const body = handlerBody(js, js.indexOf("'x'"));
  assert.ok(body.includes('a();'));
  assert.ok(!body.includes('if (!y)'), body);
});

test('ハンドラを名前で渡している形では、これまでどおり窓で見る', () => {
  const js = "addEventListener('x', onChange);\n".padEnd(500, '/* … */');
  const body = handlerBody(js, js.indexOf("'x'"));
  assert.equal(body.length, 400);
});

test('message ハンドラの中の（正しい）skipWaiting を install のものと誤判定しない', () => {
  // OK_TREE の sw.js は install → activate → message の順。並びを変えても通ること
  const reordered = {
    ...OK_TREE,
    'sw.js': OK_TREE['sw.js'].replace(
      /self\.addEventListener\("message"[\s\S]*?\}\);\n/, '')
      .replace("self.addEventListener('install'",
        `self.addEventListener("message", (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });\nself.addEventListener('install'`),
  };
  assert.ok(!ids(failures(reordered)).includes('E_SW_NO_SKIP_WAITING_ON_INSTALL'));
});

test('records-hub-client.js の pagehide はアプリ自身の確定保存と数えない', () => {
  const tree = {
    ...OK_TREE,
    'js/app.js': OK_TREE['js/app.js'].replace("addEventListener('pagehide', () => save());\n", ''),
    'js/records-hub-client.js': "window.addEventListener('pagehide', () => sync());",
  };
  assert.ok(ids(failures(tree)).includes('C_PAGEHIDE'));
});

test('許可した宛先（allowedRemoteScripts）は拾わない', () => {
  const tree = {
    ...OK_TREE,
    'index.html': OK_TREE['index.html'].replace('</head>',
      '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"></head>'),
  };
  assert.ok(ids(failures(tree)).includes('B_NO_CDN_CODE'));
  const allowed = failures(tree, { allowedRemoteScripts: ['^https://fonts\\.googleapis\\.com/'] });
  assert.ok(!ids(allowed).includes('B_NO_CDN_CODE'));
});

test('相対パス（./）の manifest はどちらの配信でも拾わない', () => {
  assert.ok(!ids(failures(OK_TREE)).includes('E_MANIFEST_ID'));
});

// ---------------- 壊したら拾うこと（1検査ずつ） ----------------

const MUTATIONS = [
  ['A_LICENSE', (t) => { delete t.LICENSE; }],
  ['A_GITIGNORE', (t) => { t['.gitignore'] = 'dist/\n'; }],
  ['A_DEPENDABOT', (t) => { delete t['.github/dependabot.yml']; }],
  ['A_CI_ON_PR', (t) => { t['.github/workflows/ci.yml'] = 'on:\n  push:\n    branches: [main]\n'; }],
  ['A_DOCS', (t) => { delete t['AUDIT.md']; }],
  ['B_NO_CDN_CODE', (t) => {
    t['index.html'] = t['index.html'].replace('</head>', '<script src="https://unpkg.com/x/x.js"></script></head>');
  }],
  ['B_NO_SECRETS', (t) => { t['js/app.js'] += '\nconst KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv";'; }],
  ['B_CSP', (t) => { t['index.html'] = t['index.html'].replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''); }],
  ['B_NO_INLINE_SCRIPT', (t) => { t['index.html'] = t['index.html'].replace('<body>', '<body><button onclick="go()">x</button>'); }],
  ['C_NO_LS_CLEAR', (t) => { t['js/app.js'] += '\nfunction wipe() { localStorage.clear(); }'; }],
  ['C_PAGEHIDE', (t) => { t['js/app.js'] = t['js/app.js'].replace("addEventListener('pagehide', () => save());\n", ''); }],
  ['C_NO_POSTMESSAGE_STAR', (t) => { t['js/app.js'] += "\nparent.postMessage({ a: 1 }, '*');"; }],
  ['D_VIEWPORT', (t) => {
    t['index.html'] = t['index.html'].replace('viewport-fit=cover', 'viewport-fit=cover, user-scalable=no');
  }],
  ['D_DVH', (t) => { t['css/style.css'] += '\n.shell { height: 100vh; }'; }],
  ['D_SAFE_AREA', (t) => { t['css/style.css'] = t['css/style.css'].replace(/env\(safe-area-inset-bottom\)/g, '0'); }],
  ['D_FLUID_TYPE', (t) => { t['css/style.css'] = t['css/style.css'].replace(/clamp\([^)]*\)/g, '1rem'); }],
  ['D_CANVAS_DPR', (t) => { t['js/app.js'] += "\nconst g = c.getContext('2d');"; }],
  ['D_REDUCED_MOTION', (t) => {
    t['css/style.css'] = t['css/style.css'].replace('animation-duration: .01ms', 'animation-duration: 0s');
  }],
  ['D_FORCED_COLORS', (t) => { t['css/style.css'] = t['css/style.css'].replace('forced-colors: active', 'x: y'); }],
  ['D_RT_COLOR', (t) => { t['css/style.css'] += '\nrt { color: #666; }'; }],
  ['F_LABEL_FOR_TABBABLE', (t) => {
    t['index.html'] = t['index.html'].replace('<body>',
      '<body><label for="pick">えらぶ</label><input type="file" id="pick" hidden>');
  }],
  ['E_MANIFEST_ID', (t) => {
    // CNAME があるのに旧リポジトリ名の絶対パスのまま
    const j = JSON.parse(t['manifest.webmanifest']);
    j.id = j.scope = j.start_url = '/Demo_App/';
    t['manifest.webmanifest'] = JSON.stringify(j);
  }],
  ['E_CNAME', (t) => { t.CNAME = '﻿demo-app.giga-school.com\n'; }],
  ['E_STALE_REPO_PATH', (t) => { t['sw.js'] = t['sw.js'].replace("'./index.html'", "'/Demo_App/index.html'"); }],
  ['E_ICONS', (t) => { t['icons/apple-touch-icon.png'] = alphaPng(); }],
  ['E_INSTALL_HOOK', (t) => { t['index.html'] = t['index.html'].replace('<script src="./install-hook.js"></script>', ''); }],
  ['E_SW_CACHE_SCOPE', (t) => {
    t['sw.js'] = t['sw.js'].replace('keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))',
      'keys.map((k) => caches.delete(k))');
  }],
  ['E_SW_NO_LOCALSTORAGE', (t) => { t['sw.js'] += "\nlocalStorage.setItem('x', '1');"; }],
  // ⚠️ ダブルクォートの "install" で壊す。引用符の違いで見逃さないことも同時に確かめる
  ['E_SW_NO_SKIP_WAITING_ON_INSTALL', (t) => {
    t['sw.js'] = t['sw.js'].replace("self.addEventListener('install', (e) => {",
      'self.addEventListener("install", (e) => {\n  self.skipWaiting();');
  }],
  ['E_SW_UPDATE_PROMPT', (t) => { t['js/app.js'] = t['js/app.js'].replace(/SKIP_WAITING/g, 'XXX'); }],
  ['E_SW_REGISTER_READYSTATE', (t) => {
    t['js/app.js'] = t['js/app.js'].replace(
      "else addEventListener('load', () => { if (document.readyState === 'complete') navigator.serviceWorker.register('./sw.js'); });",
      "addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));")
      .replace("if (document.readyState === 'complete') navigator.serviceWorker.register('./sw.js');\n", '');
  }],
  ['E_SW_VERSION_GENERATED', (t) => {
    t['sw.js'] = t['sw.js'].replace(" /* __APP_VERSION__ */", '');
  }],
  ['E_OFFLINE_HTML', (t) => { delete t['offline.html']; }],
  ['E_SW_PRECACHE_OFFLINE', (t) => {
    // 先読みから外し、fetch の逃げ道にだけ書く（全体検索だと見逃す形）
    t['sw.js'] = t['sw.js'].replace(", './offline.html'", '')
      + "\nself.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request).catch(() => caches.match('./offline.html'))); });";
  }],
  ['E_MASKABLE_SAFE_ZONE', (t) => { t['icons/maskable-512.png'] = alphaPng(); }],
  ['F_FILE_SIZE', (t) => { t['js/big.js'] = 'x\n'.repeat(5001); }],
  ['F_IMG_DIMENSIONS', (t) => {
    t['index.html'] = t['index.html'].replace('<img src="./icons/icon-192.png" width="64" height="64" alt="アイコン">',
      '<img src="./icons/icon-192.png">');
  }],
];

for (const [id, mutate] of MUTATIONS) {
  test(`${id}: 壊したら拾う`, () => {
    const tree = { ...OK_TREE };
    mutate(tree);
    assert.ok(ids(failures(tree)).includes(id), `${id} が反応しませんでした`);
  });
}

test('F_IMG_SIZE: 大きすぎる画像を拾う', () => {
  const tree = { ...OK_TREE, 'img/photo.png': Buffer.concat([opaquePng(), Buffer.alloc(200 * 1024)]) };
  assert.ok(ids(failures(tree)).includes('F_IMG_SIZE'));
});

// ---------------- sw の型（config.sw）ごとのふるまい ----------------

test('sw: "vite" は原本（public/sw.js）の dev マーカーを正とする', () => {
  const tree = { ...OK_TREE };
  delete tree['sw.js'];
  tree['public/sw.js'] = OK_TREE['sw.js'].replace("const APP_VERSION = 'v1a2b3c4d';", "const APP_VERSION = 'dev';");
  const f = ids(failures(tree, { sw: 'vite' }));
  assert.ok(!f.includes('E_SW_VERSION_GENERATED'), 'vite の dev 原本を誤検知した');
  assert.ok(!f.includes('E_SW_CACHE_SCOPE'));
});

test('sw: "static" は v0/dev のままだと拾う', () => {
  const tree = { ...OK_TREE, 'sw.js': OK_TREE['sw.js'].replace("'v1a2b3c4d'", "'dev'") };
  assert.ok(ids(failures(tree)).includes('E_SW_VERSION_GENERATED'));
});

// ---- manifest が指すアイコンの実体 ----
//
// 「並んでいる」と「在る」は別である。maskable の実体は E_MASKABLE_SAFE_ZONE が
// 読むので消えれば落ちるが、any のほうは誰も読んでいなかった。
// xxx_automatic で icons/icon-192.png を消しても 38 件すべて通った（2026-08-23）。
// 192 が取れないと Chrome はインストールの合図を出さない。画面は普通に出るので、
// 誰も気づかないまま「入れられないアプリ」になる。

test('manifest が指す any のアイコンが無ければ拾う', () => {
  const tree = { ...OK_TREE };
  delete tree['icons/icon-192.png'];
  // ⚠️ 入口の <img> も一緒に外す。外さないと F_IMG_DIMENSIONS の
  //    「画像が無い」で落ち、E_ICONS が見ているのか分からなくなる。
  tree['index.html'] = tree['index.html']
    .replace('<img src="./icons/icon-192.png" width="64" height="64" alt="アイコン">', '');
  const rs = runGigaChecks(makeTree(tree), CONFIG);
  const icons = rs.find((r) => r.id === 'E_ICONS');
  assert.equal(icons.ok, false);
  assert.match(icons.detail.join(' '), /icon-192\.png/);
});

test('src の無いアイコンが並んでいたら拾う', () => {
  const tree = { ...OK_TREE };
  const j = JSON.parse(tree['manifest.webmanifest']);
  j.icons.push({ sizes: '48x48', type: 'image/png' });
  tree['manifest.webmanifest'] = JSON.stringify(j);
  const rs = runGigaChecks(makeTree(tree), CONFIG);
  assert.equal(rs.find((r) => r.id === 'E_ICONS').ok, false);
});

// ---- 版を刻む道具の置き場 ----
//
// 道具を scripts/ にまとめているリポジトリがある（xxx_automatic）。
// tools/build-sw.mjs と決め打ちしていたころは、版を正しく自動生成しているのに
// 「自動生成が外れています」と落ちていた。entryHtml・E_CNAME と同じ形の決め打ちで、
// 見つかったのはこれで3件目である。

test('swBuilder で道具の置き場を変えられる', () => {
  const tree = { ...OK_TREE };
  delete tree['tools/build-sw.mjs'];
  tree['scripts/build-sw.mjs'] = '// 正本のコピー\n';
  const f = ids(failures(tree, { swBuilder: 'scripts/build-sw.mjs' }));
  assert.ok(!f.includes('E_SW_VERSION_GENERATED'), `落ちてはいけない: ${f}`);
});

test('swBuilder で指したところに道具が無ければ拾う', () => {
  const tree = { ...OK_TREE };
  delete tree['tools/build-sw.mjs'];
  const rs = runGigaChecks(makeTree(tree), { ...CONFIG, swBuilder: 'scripts/build-sw.mjs' });
  const gen = rs.find((r) => r.id === 'E_SW_VERSION_GENERATED');
  assert.equal(gen.ok, false);
  // 「tools/」ではなく、指したところの名前で知らせる
  assert.match(gen.detail.join(' '), /scripts\/build-sw\.mjs/);
});

test('swBuilder を書かなければ tools/build-sw.mjs を見る（これまでどおり）', () => {
  const tree = { ...OK_TREE };
  delete tree['tools/build-sw.mjs'];
  const rs = runGigaChecks(makeTree(tree), CONFIG);
  const gen = rs.find((r) => r.id === 'E_SW_VERSION_GENERATED');
  assert.equal(gen.ok, false);
  assert.match(gen.detail.join(' '), /tools\/build-sw\.mjs/);
});

test('sw: "workbox" は SW 原文の検査を理由つきで飛ばす', () => {
  const tree = { ...OK_TREE };
  delete tree['sw.js'];
  delete tree['tools/build-sw.mjs'];
  const rs = runGigaChecks(makeTree(tree), { ...CONFIG, sw: 'workbox', swSource: 'src/sw.js' });
  const gen = rs.find((r) => r.id === 'E_SW_VERSION_GENERATED');
  assert.equal(gen.ok, true);
  assert.match(gen.title, /workbox/);
});

test('sw: "none" は SW 系をすべて飛ばし、SW が無くても落ちない', () => {
  const tree = { ...OK_TREE };
  delete tree['sw.js'];
  delete tree['offline.html'];
  delete tree['tools/build-sw.mjs'];
  tree['js/app.js'] = "addEventListener('pagehide', () => save()); function save() {}";
  const f = ids(failures(tree, { sw: 'none' }));
  assert.ok(!f.some((id) => id.startsWith('E_SW') || id === 'E_OFFLINE_HTML'), `SW 系が落ちた: ${f}`);
});

// ---------------- skips（理由つきの明示的な免除） ----------------

test('skips は理由が無いと受け付けない', () => {
  const rs = runGigaChecks(makeTree(OK_TREE), { ...CONFIG, skips: [{ id: 'D_SAFE_AREA' }] });
  assert.equal(rs.length, 1);
  assert.equal(rs[0].ok, false);
});

test('skips に載せた検査は理由つきで飛ぶ', () => {
  const tree = { ...OK_TREE };
  tree['css/style.css'] = tree['css/style.css'].replace(/env\(safe-area-inset-bottom\)/g, '0');
  const rs = runGigaChecks(makeTree(tree), { ...CONFIG, skips: [{ id: 'D_SAFE_AREA', reason: '全画面固定レイアウトではない' }] });
  const r = rs.find((x) => x.id === 'D_SAFE_AREA');
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.match(r.title, /全画面固定レイアウトではない/);
});

test('head で読む別名のスクリプト（pwa-early.js 等）が合図を受けていれば E_INSTALL_HOOK は通る', () => {
  // 実際に reading-books が js/pwa-early.js という名前でこの形だった
  const tree = {
    ...OK_TREE,
    'index.html': OK_TREE['index.html'].replace('<script src="./install-hook.js"></script>',
      '<script src="js/pwa-early.js"></script>'),
    'js/pwa-early.js': "window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); });",
  };
  assert.ok(!ids(failures(tree)).includes('E_INSTALL_HOOK'));
});

test('DOMContentLoaded 方式（readyState !== loading）の登録も E_SW_REGISTER_READYSTATE は通す', () => {
  // 実際に reading-books がこの形だった
  const tree = {
    ...OK_TREE,
    'js/app.js': OK_TREE['js/app.js'].replace(
      /if \(document\.readyState === 'complete'\) navigator\.serviceWorker\.register\('\.\/sw\.js'\);\nelse addEventListener\('load', .*\n?/,
      "function boot() { navigator.serviceWorker.register('./sw.js'); }\n"
      + "if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);\n"
      + "addEventListener('load', () => {});\n"),
  };
  assert.ok(tree['js/app.js'].includes('DOMContentLoaded'), '置きかえが空振りした');
  assert.ok(!ids(failures(tree)).includes('E_SW_REGISTER_READYSTATE'));
});

test('正規表現リテラルの中の引用符で状態がずれても、後続のコメントを見のがさない', () => {
  // 実際に reading-books の app.js で、コメント内の localStorage.clear() を誤検知した
  const tree = {
    ...OK_TREE,
    'js/app.js': OK_TREE['js/app.js']
      + "\nconst re = /don't/;\n/* localStorage.clear() はつかわない、という注意書き */\n",
  };
  assert.ok(!ids(failures(tree)).includes('C_NO_LS_CLEAR'));
});

test('単一 HTML 型（<style> にスタイルを書く）でも CSS 系の検査が中身を見る', () => {
  // 実際に ice_slide-puzzle が css/ を持たず index.html の <style> に書いていた
  const tree = { ...OK_TREE };
  const css = tree['css/style.css'];
  delete tree['css/style.css'];
  tree['index.html'] = tree['index.html'].replace('</head>', `<style>${css}</style></head>`);
  const f = ids(failures(tree));
  for (const id of ['D_SAFE_AREA', 'D_FLUID_TYPE', 'D_REDUCED_MOTION', 'D_FORCED_COLORS']) {
    assert.ok(!f.includes(id), `${id} が <style> の中身を見ていない`);
  }
});

test('offline.html の <style> を、アプリ本体の対応とみなさない', () => {
  // typa の self-test が D_SAFE_AREA / D_FLUID_TYPE / D_FORCED_COLORS を
  // 「こわしたのに 通りました」と報告し続けていた形。
  // offline.html は圏外のときだけ出る小さな一枚で、そこに
  // env(safe-area-inset) や clamp() や forced-colors が入っていると、
  // 本体 CSS から全部消しても検査が緑のままになっていた。
  const tree = { ...OK_TREE };
  const css = tree['css/style.css'];
  tree['css/style.css'] = '/* 本体のスタイルは空にする */';
  // OK_TREE の offline.html には <head> が無いので、<body> の頭に差し込む
  tree['offline.html'] = tree['offline.html'].replace('<body>', `<body><style>${css}</style>`);
  assert.ok(tree['offline.html'].includes('<style>'), '差し込みが空振りした');
  const f = ids(failures(tree));
  for (const id of ['D_SAFE_AREA', 'D_FLUID_TYPE', 'D_REDUCED_MOTION', 'D_FORCED_COLORS']) {
    assert.ok(f.includes(id), `${id} が offline.html の <style> を身代わりにしている`);
  }
});

test('index.html の <style> は、これまでどおりアプリ本体として数える', () => {
  // 上の除外は offline.html だけ。単一 HTML 型のアプリを巻き添えにしない
  const tree = { ...OK_TREE };
  const css = tree['css/style.css'];
  delete tree['css/style.css'];
  tree['index.html'] = tree['index.html'].replace('</head>', `<style>${css}</style></head>`);
  const f = ids(failures(tree));
  for (const id of ['D_SAFE_AREA', 'D_FLUID_TYPE', 'D_REDUCED_MOTION', 'D_FORCED_COLORS']) {
    assert.ok(!f.includes(id), `${id} が index.html の <style> を見ていない`);
  }
});

test('登録から遠い readyState は身代わりにならない', () => {
  // typa の js/app.js には SW と関係のない
  //   if (document.readyState === 'loading') …DOMContentLoaded…
  // が別の場所にあり、登録の手前のガードを消してもそれが身代わりになって
  // 検査が通っていた。
  const tree = {
    ...OK_TREE,
    'js/app.js': [
      "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);",
      // 埋め草はコメントではなく実コードにする。stripComments が先に走るので、
      // コメントで離しても距離は縮まってしまう
      "const filler = '" + 'x'.repeat(400) + "';",
      "addEventListener('load', () => { navigator.serviceWorker.register('./sw.js'); });",
    ].join('\n'),
  };
  assert.ok(ids(failures(tree)).includes('E_SW_REGISTER_READYSTATE'),
    '登録から 400 文字はなれた readyState を身代わりにしている');
});

test('登録の手前にガードがあれば通す', () => {
  const tree = {
    ...OK_TREE,
    'js/app.js': [
      "function boot() { navigator.serviceWorker.register('./sw.js'); }",
      "if (document.readyState === 'complete') boot();",
      "else addEventListener('load', boot);",
    ].join('\n'),
  };
  assert.ok(!ids(failures(tree)).includes('E_SW_REGISTER_READYSTATE'));
});

test('行き先リンク（<a href="https://…">）は CDN 読み込みと数えない', () => {
  // 実際に ice_slide-puzzle のフッターの giga-school.com リンクを誤検知した
  const tree = {
    ...OK_TREE,
    'index.html': OK_TREE['index.html'].replace('<body>',
      '<body><footer><a href="https://giga-school.com/">GIGA school</a></footer>'),
  };
  assert.ok(!ids(failures(tree)).includes('B_NO_CDN_CODE'));
});

test('JS からの動的な読み込み（script.src = https）は拾う', () => {
  const tree = { ...OK_TREE, 'js/app.js': OK_TREE['js/app.js'] + "\nconst s = document.createElement('script'); s.src = 'https://evil.example/x.js';" };
  assert.ok(ids(failures(tree)).includes('B_NO_CDN_CODE'));
});

// ---------------- stripComments ----------------

test('stripComments はコメントだけを落とす', () => {
  assert.match(stripComments('/* localStorage */ const a = 1;'), /const a = 1;/);
  assert.doesNotMatch(stripComments('/* localStorage */ const a = 1;'), /localStorage/);
  assert.doesNotMatch(stripComments('// localStorage\nconst b = 2;'), /localStorage/);
  // URL の // を壊さない
  assert.match(stripComments('const u = "https://example.com/x";'), /https:\/\/example\.com/);
  // 文字列の中の /* は落とさない
  assert.match(stripComments('const s = "/* keep me */";'), /keep me/);
});

/* ── 配信の起点と、ソースの見つけ方 ────────────────────────────────
 * どちらも「見ていないのに緑」「見なくていいものを見て赤」を左右する。
 * 2026-08-22 に digitalcloset と ice_slide-puzzle で実際に両方が起きた。
 * ================================================================= */

test('siteRoot: Vite 型の public/ を配信の起点として見る', () => {
  // offline.html もアイコンも public/ の中にあり、配信されたときだけ
  // 直下に来る。siteRoot を見ないと「ありません」と誤検知する。
  const vite = { ...OK_TREE };
  for (const rel of Object.keys(vite)) {
    if (rel === 'offline.html' || rel.startsWith('icons/') || rel === 'manifest.webmanifest') {
      vite['public/' + rel] = vite[rel];
      delete vite[rel];
    }
  }
  const withRoot = ids(failures(vite, { siteRoot: 'public', manifest: 'public/manifest.webmanifest' }));
  assert.equal(withRoot.includes('E_OFFLINE_HTML'), false);
  assert.equal(withRoot.includes('E_MASKABLE_SAFE_ZONE'), false);
});

test('siteRoot: 既定は "." のまま（静的にコミットするアプリは変わらない）', () => {
  assert.deepEqual(ids(failures(OK_TREE)), []);
});

test('jsDirs: .jsx も JavaScript として読む', () => {
  // React で書いたアプリの本体は .jsx。'.js' だけを見ていたころは
  // ここに何を書いても検査が反応しなかった。
  const t = { ...OK_TREE, 'js/App.jsx': 'localStorage.clear();\n' };
  assert.equal(ids(failures(t)).includes('C_NO_LS_CLEAR'), true);
});

test('jsDirs: 下の階層まで見る', () => {
  const t = { ...OK_TREE, 'js/lib/deep.js': 'localStorage.clear();\n' };
  assert.equal(ids(failures(t)).includes('C_NO_LS_CLEAR'), true);
});

test('jsDirs: vendor/ の同梱物は読まない（直せないものを数えても意味がない）', () => {
  const t = { ...OK_TREE, 'js/vendor/thirdparty.min.js': 'localStorage.clear();\n' };
  assert.equal(ids(failures(t)).includes('C_NO_LS_CLEAR'), false);
});

test('jsDirs: scripts/ と tools/ は読まない（ゲート自身を違反に数えない）', () => {
  // jsDirs が ["."] のリポジトリでは、ここを外さないとゲート自身の
  // 説明文（<img> や localStorage.clear()）を違反として数える。
  const t = {
    ...OK_TREE,
    'scripts/lib/gate.mjs': 'localStorage.clear();\n',
    'tools/build.mjs': 'localStorage.clear();\n',
  };
  assert.equal(ids(failures(t, { jsDirs: ['.'] })).includes('C_NO_LS_CLEAR'), false);
});

test('jsDirs: node_modules は読まない', () => {
  const t = { ...OK_TREE, 'js/node_modules/pkg/index.js': 'localStorage.clear();\n' };
  assert.equal(ids(failures(t)).includes('C_NO_LS_CLEAR'), false);
});

/* ── 先読みの一覧をビルドで注入する型 ────────────────────────────────
 * 原文の配列は置き場でしかないので、そこを見ても真偽が決まらない。
 * 2026-08-22 に digitalcloset（種の一覧あり）は偶然通り、
 * quoridor（空の []）は正しく先読みしているのに落ちていた。
 * ================================================================= */

const VITE_SW = `const APP_VERSION = 'dev';
const PRECACHE_URLS = []; /* __PRECACHE_URLS__ */
self.addEventListener('install', () => {});
`;

test('注入型: sw-build.config.json の precache に offline.html があれば通る', () => {
  const t = {
    ...OK_TREE,
    'public/sw.js': VITE_SW,
    'sw-build.config.json': JSON.stringify({ precache: ['index.html', 'offline.html'] }),
  };
  const got = ids(failures(t, { sw: 'vite', swSource: 'public/sw.js' }));
  assert.equal(got.includes('E_SW_PRECACHE_OFFLINE'), false);
});

test('注入型: precache に offline.html が無ければ落ちる', () => {
  const t = {
    ...OK_TREE,
    'public/sw.js': VITE_SW,
    'sw-build.config.json': JSON.stringify({ precache: ['index.html'] }),
  };
  assert.equal(ids(failures(t, { sw: 'vite', swSource: 'public/sw.js' })).includes('E_SW_PRECACHE_OFFLINE'), true);
});

test('注入型: sw-build.config.json が無ければ落ちる（見に行く先が無い）', () => {
  const t = { ...OK_TREE, 'public/sw.js': VITE_SW };
  assert.equal(ids(failures(t, { sw: 'vite', swSource: 'public/sw.js' })).includes('E_SW_PRECACHE_OFFLINE'), true);
});

test('注入型でない sw は、これまでどおり原文の配列を見る', () => {
  const t = { ...OK_TREE, 'sw.js': "const PRECACHE_URLS = ['./index.html'];\n" };
  assert.equal(ids(failures(t)).includes('E_SW_PRECACHE_OFFLINE'), true);
});

test('注入型でない sw に sw-build.config.json があっても、原文の配列で判定する', () => {
  // ここを取りちがえると、原文が offline.html を先読みしていないのに
  // 設定ファイルのほうを見て通してしまう。目印の有無で分けること。
  const t = {
    ...OK_TREE,
    'sw.js': "const PRECACHE_URLS = ['./index.html'];\n",
    'sw-build.config.json': JSON.stringify({ precache: ['index.html', 'offline.html'] }),
  };
  assert.equal(ids(failures(t)).includes('E_SW_PRECACHE_OFFLINE'), true);
});
