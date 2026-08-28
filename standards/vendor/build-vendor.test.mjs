// ==========================================================================
// build-vendor.mjs / verify-generated.mjs の試験。
//
// ⚠️ 「0 件でした」を信じない。わざと壊して落ちることまで書く。
//    とくに大事なのは 2 つ:
//      ・走査から 1 ファイル外すと、そのアイコンが CSS から消えること
//        （MIRAI-Compass で実際に起きた。ビルドは通り、その画面だけ絵が消える）
//      ・生成物を 1 バイト変えると verify-generated が落ちること
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  ICON_PACKS,
  banner,
  buildVendor,
  collectIconNames,
  loadConfig,
  outputs,
  readDep,
  renderIconCss,
  svgToDataUri,
  wrapCss,
  wrapJs,
} from './build-vendor.mjs';
import { verifyGenerated } from './verify-generated.mjs';

// --- 使い捨てのリポジトリを作る --------------------------------------------

const SVG = (d) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" fill="#000"><path d="${d}"/></svg>`;

/**
 * node_modules ごと偽物を組み立てる。本物の npm は要らない。
 * files は { 相対パス: 中身 } の形。
 */
function makeRepo({ config, files = {}, deps = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-'));
  const put = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  put('vendor.config.json', JSON.stringify(config));
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  for (const [rel, body] of Object.entries(deps)) put(path.join('node_modules', rel), body);
  return dir;
}

// --- 設定 ------------------------------------------------------------------

test('targets が空の設定は落ちる', () => {
  assert.throws(() => loadConfig('/x', () => JSON.stringify({ targets: [] })), /targets が空/);
});

test('out の無い target は落ちる', () => {
  assert.throws(
    () => loadConfig('/x', () => JSON.stringify({ targets: [{ js: ['a.js'] }] })),
    /out がない/,
  );
});

test('css も js も icons も無い target は落ちる', () => {
  assert.throws(
    () => loadConfig('/x', () => JSON.stringify({ targets: [{ out: 'v.html' }] })),
    /css \/ js \/ icons/,
  );
});

test('vendor.config.json が無ければ、どこを探したか言って落ちる', () => {
  assert.throws(
    () =>
      loadConfig('/r', () => {
        throw new Error('ENOENT');
      }),
    /\/r\/vendor\.config\.json/,
  );
});

test('outputs は targets の並びをそのまま返す（検査の一覧を決め打ちにしないため）', () => {
  const cfg = loadConfig('/x', () =>
    JSON.stringify({ targets: [{ out: 'a.html', js: ['a'] }, { out: 'b.html', css: ['b'] }] }),
  );
  assert.deepEqual(outputs(cfg), ['a.html', 'b.html']);
});

// --- 走査（いちばん事故が起きるところ）--------------------------------------

test('既定の走査対象はリポジトリ全体（取りこぼしより重いほうがまし）', () => {
  assert.deepEqual(DEFAULT_CONFIG.scan, ['.']);
});

test('アイコン名は .html でも .js でも拾う', () => {
  const repo = makeRepo({
    config: { targets: [{ out: 'x', icons: 'bootstrap-icons' }] },
    files: {
      'index.html': '<i class="bi bi-house-fill"></i>',
      'js/app.js': "el.className = 'bi bi-gear'",
      'README.md': 'bi-this-should-not-count',
    },
  });
  assert.deepEqual(collectIconNames(repo, DEFAULT_CONFIG, 'bi'), ['gear', 'house-fill']);
});

test('⚠️ 走査から 1 ファイル外すと、その画面のアイコンが CSS から消える', () => {
  // MIRAI-Compass で実際に起きた事故。ビルドは通り、他の画面は正しく出るので、
  // 開いて見るまで気づけない。狭めた設定を配ると 13 本ぶん同じ事故を仕込むことになる。
  const repo = makeRepo({
    config: { targets: [{ out: 'x', icons: 'bootstrap-icons' }] },
    files: {
      'index.html': '<i class="bi bi-house"></i>',
      'js_worksheet.html': '<i class="bi bi-pencil"></i>',
    },
  });
  assert.deepEqual(collectIconNames(repo, DEFAULT_CONFIG, 'bi'), ['house', 'pencil']);

  const narrowed = { ...DEFAULT_CONFIG, scan: ['index.html'] };
  assert.deepEqual(
    collectIconNames(repo, narrowed, 'bi'),
    ['house'],
    'scan を狭めても pencil が拾えてしまうなら、この試験は何も見ていない',
  );
});

test('走査は配信しない置き場に入らない', () => {
  const repo = makeRepo({
    config: { targets: [{ out: 'x', icons: 'bootstrap-icons' }] },
    files: {
      'index.html': '<i class="bi bi-house"></i>',
      'node_modules/pkg/a.js': 'bi-should-not-count',
      'vendor/lib.js': 'bi-neither',
      'dist/out.html': 'bi-nor-this',
    },
  });
  assert.deepEqual(collectIconNames(repo, DEFAULT_CONFIG, 'bi'), ['house']);
});

// --- アイコンの CSS --------------------------------------------------------

test('SVG は data: URI になり、色指定は currentColor に統一される', () => {
  const uri = svgToDataUri(SVG('M0 0h1v1H0z'));
  assert.match(uri, /^data:image\/svg\+xml,/);
  assert.match(uri, /fill='currentColor'/);
  // ⚠️ /#000/ で見ても捕まらない。# は %23 に逃がされるので、元の色は
  //    `fill='%23000'` という形で生き残る。fill が 1 つだけであることを見る。
  assert.equal((uri.match(/fill=/g) || []).length, 1, '元の色指定が残っている');
  assert.doesNotMatch(uri, /%23000/, '元の色指定が逃がされた形で残っている');
  assert.doesNotMatch(uri, /<\?xml/, 'XML 宣言が残っている');
  // CSS の url("…") に入れるので、この 2 つは必ず逃がす
  assert.doesNotMatch(uri, /"/);
  assert.doesNotMatch(uri, /[<>#]/);
});

test('使っているアイコンの数だけ規則が出る', () => {
  const { css, count, missing } = renderIconCss(['gear', 'house'], {
    prefix: 'bi',
    baseClass: 'bi',
    resolve: () => SVG('M0 0'),
  });
  assert.equal(count, 2);
  assert.deepEqual(missing, []);
  assert.match(css, /\.bi-gear\{--bi-i:url\("data:image\/svg\+xml,/);
  assert.match(css, /\.bi-house\{/);
  // 高コントラストモードで絵が消えることへの手当て
  assert.match(css, /forced-colors: active/);
});

test('SVG が無い名前は落とさず、missing で返す（名前の打ち間違いで配れなくならないよう）', () => {
  const { count, missing } = renderIconCss(['gear', 'no-such-icon'], {
    prefix: 'bi',
    baseClass: 'bi',
    resolve: (n) => (n === 'gear' ? SVG('M0 0') : null),
  });
  assert.equal(count, 1);
  assert.deepEqual(missing, ['no-such-icon']);
});

test('アイコンの出どころには読み替えの表がある（存在しない名前が実際に書かれている）', () => {
  assert.equal(ICON_PACKS['bootstrap-icons'].alias['pencil-ruler'], 'rulers');
  assert.equal(ICON_PACKS['bootstrap-icons'].prefix, 'bi');
  assert.equal(ICON_PACKS['@mdi/svg'].prefix, 'mdi');
});

// --- 包み方 ----------------------------------------------------------------

test('JavaScript の中の </script> は逃がす（そこで script が閉じてしまう）', () => {
  const js = `const s = "</script>";`;
  const out = wrapJs(js);
  assert.doesNotMatch(out, /<\/script>/);
  assert.match(out, /<\\\/script>/);
});

test('sourceMappingURL は落とす（開発者ツールが取りに行って 404 を出す）', () => {
  assert.doesNotMatch(wrapJs('a=1\n//# sourceMappingURL=a.map'), /sourceMappingURL/);
  assert.doesNotMatch(wrapCss('a{}\n/*# sourceMappingURL=a.map */'), /sourceMappingURL/);
});

test('生成物の頭には「手で編集しない」と書く', () => {
  const b = banner('bootstrap.min.css', 'tools/vendor/build-vendor.mjs');
  assert.match(b, /手で編集しないでください/);
  assert.match(b, /bootstrap\.min\.css/);
});

test('npm ci をしていなければ、何が無いかを言って止まる', () => {
  assert.throws(() => readDep('/nowhere', 'bootstrap/dist/x.css'), /npm ci/);
});

// --- 通しで ----------------------------------------------------------------

const FULL = {
  config: {
    targets: [
      { out: 'vendor_css.html', css: ['fake-bootstrap/b.css'] },
      { out: 'vendor_icons.html', icons: 'bootstrap-icons' },
      { out: 'vendor_js.html', js: ['fake-bootstrap/b.js'] },
    ],
  },
  files: { 'index.html': '<i class="bi bi-house"></i>' },
  deps: {
    'fake-bootstrap/b.css': '.btn{color:red}\n/*# sourceMappingURL=b.css.map */',
    'fake-bootstrap/b.js': 'window.B=1\n//# sourceMappingURL=b.js.map',
    'bootstrap-icons/icons/house.svg': SVG('M0 0h8v8H0z'),
  },
};

test('通しで走らせると、3 つの生成物が出る', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });

  const css = fs.readFileSync(path.join(repo, 'vendor_css.html'), 'utf8');
  assert.match(css, /<style>/);
  assert.match(css, /\.btn\{color:red\}/);

  const icons = fs.readFileSync(path.join(repo, 'vendor_icons.html'), 'utf8');
  assert.match(icons, /\.bi-house\{/);

  const js = fs.readFileSync(path.join(repo, 'vendor_js.html'), 'utf8');
  assert.match(js, /<script>/);
  assert.match(js, /window\.B=1/);
});

test('wrap: none なら .html に包まず素のまま出す（静的アプリ向け）', async () => {
  const repo = makeRepo({ ...FULL, config: { ...FULL.config, wrap: 'none' } });
  await buildVendor(repo, { log: () => {} });
  const js = fs.readFileSync(path.join(repo, 'vendor_js.html'), 'utf8');
  assert.doesNotMatch(js, /<script>/);
  assert.match(js, /window\.B=1/);
});

test('同じ入力からは同じ生成物が出る（決まった結果になる）', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });
  const first = fs.readFileSync(path.join(repo, 'vendor_icons.html'), 'utf8');
  await buildVendor(repo, { log: () => {} });
  assert.equal(fs.readFileSync(path.join(repo, 'vendor_icons.html'), 'utf8'), first);
});

// --- 取りこぼしの検査 ------------------------------------------------------

test('生成物が最新なら verify-generated は通る', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });
  assert.equal(await verifyGenerated(repo, { log: () => {}, err: () => {} }), 0);
});

test('⚠️ 生成物を 1 バイト変えると verify-generated が落ちる', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });
  const p = path.join(repo, 'vendor_js.html');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + ' ');
  const msgs = [];
  assert.equal(await verifyGenerated(repo, { log: () => {}, err: (m) => msgs.push(m) }), 1);
  assert.match(msgs.join('\n'), /vendor_js\.html が原本と食い違っています/);
});

test('原本（node_modules）を直して build を忘れると落ちる', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });
  fs.writeFileSync(path.join(repo, 'node_modules/fake-bootstrap/b.js'), 'window.B=2');
  assert.equal(await verifyGenerated(repo, { log: () => {}, err: () => {} }), 1);
});

test('画面にアイコンを足して build を忘れると落ちる', async () => {
  const repo = makeRepo(FULL);
  await buildVendor(repo, { log: () => {} });
  fs.writeFileSync(
    path.join(repo, 'node_modules/bootstrap-icons/icons/gear.svg'),
    SVG('M1 1h6v6H1z'),
  );
  fs.writeFileSync(path.join(repo, 'index.html'), '<i class="bi bi-house"></i><i class="bi bi-gear"></i>');
  assert.equal(await verifyGenerated(repo, { log: () => {}, err: () => {} }), 1);
});

test('生成物が無ければ「npm run build を実行して」と言って落ちる', async () => {
  const repo = makeRepo(FULL);
  const msgs = [];
  assert.equal(await verifyGenerated(repo, { log: () => {}, err: (m) => msgs.push(m) }), 1);
  assert.match(msgs.join('\n'), /npm run build/);
});

test('⚠️ 生成物は走査しない（--bi-i を拾って走らせるたび中身が変わる）', () => {
  // 生成した vendor_icons.html には `--bi-i` という変数名が入っている。
  // これを次の走査で拾うと「bi-i というアイコンが使われている」ことになり、
  // 1 回目と 2 回目で生成物が変わって verify-generated が常に落ちる。
  // fonts.css で同じ形の事故が起きている（744 字 → 768 字）。
  const repo = makeRepo({
    config: { targets: [{ out: 'vendor_icons.html', icons: 'bootstrap-icons' }] },
    files: {
      'index.html': '<i class="bi bi-house"></i>',
      'vendor_icons.html': '.bi-house{--bi-i:url("…")}',
    },
  });
  const cfg = loadConfig(repo);
  assert.deepEqual(collectIconNames(repo, { ...DEFAULT_CONFIG, ...cfg }, 'bi'), ['house']);
});

test('SVG が無いアイコンは、黙って通さず必ず知らせる', async () => {
  const repo = makeRepo({
    ...FULL,
    files: { 'index.html': '<i class="bi bi-house"></i><i class="bi bi-no-such"></i>' },
  });
  const warns = [];
  const results = await buildVendor(repo, { log: () => {}, warn: (m) => warns.push(m) });
  assert.match(warns.join('\n'), /SVG が見つからないアイコン: no-such/);
  assert.deepEqual(results.find((r) => r.out === 'vendor_icons.html').missingIcons, ['no-such']);
});

test('⚠️ 生成物の「名前」もアイコン名として拾わない', () => {
  // <link href="./vendor/mdi-icons.css"> と書いてあると、その文字列から
  // `mdi-icons` というアイコンが使われていると読んでしまう。
  // ファイルを走査から外すだけでは足りない。読まれる側に名前が出てくるため。
  const repo = makeRepo({
    config: { targets: [{ out: 'vendor/mdi-icons.css', icons: '@mdi/svg' }] },
    files: {
      'index.html':
        '<link href="./vendor/mdi-icons.css" rel="stylesheet"><i class="mdi mdi-account"></i>',
    },
  });
  const cfg = loadConfig(repo);
  assert.deepEqual(collectIconNames(repo, { ...DEFAULT_CONFIG, ...cfg }, 'mdi'), ['account']);
});

test('アイコンの出どころは接尾辞を持てる（Material Symbols の -fill）', () => {
  const pack = ICON_PACKS['@material-symbols/svg-400'];
  assert.equal(pack.prefix, 'ms');
  assert.equal(pack.suffix, '-fill');
});

test('接尾辞つきの出どころから SVG を引く', async () => {
  const repo = makeRepo({
    config: { targets: [{ out: 'ms.css', icons: '@material-symbols/svg-400' }], wrap: 'none' },
    files: { 'index.html': '<span class="ms ms-search"></span>' },
    deps: { '@material-symbols/svg-400/rounded/search-fill.svg': SVG('M1 1h6v6H1z') },
  });
  await buildVendor(repo, { log: () => {}, warn: () => {} });
  const css = fs.readFileSync(path.join(repo, 'ms.css'), 'utf8');
  assert.match(css, /\.ms-search\{/);
});

test('⚠️ 短い生成物名でも、まわりの語を巻きこまない', () => {
  // 生成物が ms.css のとき、拡張子を外した "ms" で落とすと
  // class="ms ms-search" の ms まで消え、アイコンが 1 つも見つからなくなる。
  const repo = makeRepo({
    config: { targets: [{ out: 'ms.css', icons: '@material-symbols/svg-400' }] },
    files: { 'index.html': '<link href="./ms.css"><span class="ms ms-search"></span>' },
  });
  const cfg = loadConfig(repo);
  assert.deepEqual(collectIconNames(repo, { ...DEFAULT_CONFIG, ...cfg }, 'ms'), ['search']);
});

test('⚠️ アイコン名の _ を切り落とさない（check_circle が check になる）', () => {
  const repo = makeRepo({
    config: { targets: [{ out: 'icons.html', icons: '@material-symbols/svg-400' }] },
    files: { 'index.html': '<span class="ms ms-check_circle"></span><span class="ms ms-search_off"></span>' },
  });
  const cfg = loadConfig(repo);
  assert.deepEqual(
    collectIconNames(repo, { ...DEFAULT_CONFIG, ...cfg }, 'ms'),
    ['check_circle', 'search_off'],
  );
});

test('実行時に決まるアイコンは extra に書けば入る', async () => {
  const repo = makeRepo({
    config: {
      wrap: 'none',
      targets: [{ out: 'icons.css', icons: '@material-symbols/svg-400', extra: ['warning', 'delete'] }],
    },
    files: { 'index.html': '<span class="ms ms-add"></span>' },
    deps: {
      '@material-symbols/svg-400/rounded/add-fill.svg': SVG('M0 0'),
      '@material-symbols/svg-400/rounded/warning-fill.svg': SVG('M1 1'),
      '@material-symbols/svg-400/rounded/delete-fill.svg': SVG('M2 2'),
    },
  });
  await buildVendor(repo, { log: () => {}, warn: () => {} });
  const css = fs.readFileSync(path.join(repo, 'icons.css'), 'utf8');
  for (const n of ['add', 'warning', 'delete']) assert.match(css, new RegExp(`\\.ms-${n}\\{`), n);
});

test('リポジトリごとの読み替えを書ける（出どころに無い名前の受け皿）', async () => {
  const repo = makeRepo({
    config: {
      wrap: 'none',
      targets: [
        { out: 'icons.css', icons: '@material-symbols/svg-400', alias: { tips_and_updates: 'lightbulb' } },
      ],
    },
    files: { 'index.html': '<span class="ms ms-tips_and_updates"></span>' },
    deps: { '@material-symbols/svg-400/rounded/lightbulb-fill.svg': SVG('M3 3') },
  });
  const [r] = await buildVendor(repo, { log: () => {}, warn: () => {} });
  assert.deepEqual(r.missingIcons, [], '読み替えたのに見つからない扱いになっている');
  // クラス名は「画面が書いている名前」のままでなければならない
  assert.match(fs.readFileSync(path.join(repo, 'icons.css'), 'utf8'), /\.ms-tips_and_updates\{/);
});
