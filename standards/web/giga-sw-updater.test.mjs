import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(HERE, 'giga-sw-updater.js');

test('giga-sw-updater.js: 正本ファイルが存在し空でない', () => {
  assert.ok(fs.existsSync(SCRIPT_PATH), 'giga-sw-updater.js が存在すること');
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.length > 1000, '十分なコード長があること');
});

test('giga-sw-updater.js: 児童向けルビが含まれている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes('<ruby>新<rt>あたら</rt></ruby>しい'), '「新しい」のルビがあること');
  assert.ok(code.includes('<ruby>更新<rt>こうしん</rt></ruby>する'), '「更新する」のルビがあること');
});

test('giga-sw-updater.js: 外部CDNへの参照が含まれていない（自己完結）', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(!code.includes('https://cdnjs'), 'cdnjs への参照がないこと');
  assert.ok(!code.includes('https://cdn.jsdelivr'), 'jsdelivr への参照がないこと');
  assert.ok(!code.includes('https://fonts.googleapis'), 'Google Fonts への参照がないこと');
});

test('giga-sw-updater.js: 48px 以上のタップ領域がスタイルされている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes('min-height: 48px'), 'ボタンの最小高さが 48px 以上であること');
});

test('giga-sw-updater.js: SKIP_WAITING と controllerchange 連携が含まれている', () => {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(code.includes("SKIP_WAITING"), 'SKIP_WAITING postMessage が含まれること');
  assert.ok(code.includes("controllerchange"), 'controllerchange リスナーが含まれること');
});

/* ── はじめの 1 回は 読みなおさない ───────────────────────────────
 *
 * ⚠️ 字が 在るかを 見るだけの 検査では、この 事故は 止まらなかった。
 *    sw.js の activate が clients.claim() を 呼ぶと、まだ SW に
 *    つながって いなかった ページが つながり controllerchange が 飛ぶ。
 *    そこで reload すると、はじめて ひらいた 人の 画面が ひとりで
 *    読みなおる（2026-11-09、Hiding-animal で 実測）。
 *    なので ここは 本物の コードを 走らせて、reload が 呼ばれたかを 数える。
 */
function runUpdater({ controllerAtInit }) {
  const code = fs.readFileSync(SCRIPT_PATH, 'utf-8');
  const listeners = {};
  let reloads = 0;
  const sw = {
    controller: controllerAtInit ? { id: 'old' } : null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    ready: Promise.resolve({
      waiting: null, installing: null, addEventListener() {},
    }),
  };
  const el = () => ({
    appendChild() {}, addEventListener() {}, setAttribute() {},
    attachShadow() { return { appendChild() {}, innerHTML: '' }; },
    style: {}, classList: { add() {}, remove() {} },
  });
  let defined = null;
  const sandbox = {
    navigator: { serviceWorker: sw },
    customElements: { get() { return undefined; }, define(_n, cls) { defined = cls; } },
    HTMLElement: class { attachShadow() { return { appendChild() {}, innerHTML: '' }; } },
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector() { return null; },
      createElement: el,
      body: { appendChild() {} },
    },
    location: { reload() { reloads += 1; } },
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  return {
    fire: () => (listeners.controllerchange || []).forEach((f) => f()),
    reloads: () => reloads,
    /* 「こうしん する」を 押したことにする。
       ⚠️ reg.waiting へ 直に postMessage する テストに しないこと。
          それでは 人が 押した ことを 見分ける 道を 通らない。 */
    pressUpdate: () => {
      const el = Object.create(defined.prototype);
      el._waitingWorker = { postMessage() {} };
      el.shadowRoot = { querySelector: () => null, innerHTML: '' };
      el.applyUpdate();
    },
  };
}

test('giga-sw-updater.js: はじめて ひらいた 1 回は、controllerchange で 読みなおさない', () => {
  const r = runUpdater({ controllerAtInit: false });
  r.fire();
  assert.equal(r.reloads(), 0, 'claim() の controllerchange で reload してはいけない');
});

test('giga-sw-updater.js: はじめの ページでも、「こうしん する」を 押したら 読みなおす', () => {
  /* ⚠️ 初回かどうかだけで 見分けると、いちばん はじめに ひらいた タブを
     閉じずに 置いた まま 新しい 版が 出た とき、ボタンを 押しても
     何も 起きない（その ページは 最後まで「初回」の ままなので）。
     2026-11-09 に 実ブラウザで 出た。人が 押した ことも 見る。 */
  const r = runUpdater({ controllerAtInit: false });
  r.fire();
  assert.equal(r.reloads(), 0, 'まだ 押して いない あいだは 読みなおさない');
  r.pressUpdate();
  r.fire();
  assert.equal(r.reloads(), 1, '押した あとの controllerchange では 読みなおす');
});

test('giga-sw-updater.js: 2 回目いこうは、controllerchange で 読みなおす', () => {
  const r = runUpdater({ controllerAtInit: true });
  r.fire();
  assert.equal(r.reloads(), 1, '版が 入れかわったら reload すること');
  r.fire();
  assert.equal(r.reloads(), 1, '2 度 reload しないこと（refreshing の 見はり）');
});
