// 記録ハブへの写し（records-hub-client.js）の検査。
//
// 学習ログ（study.records.v1）はアプリ側で上限（KANJI_Town は500件）を持ち、古いものから捨てる。
// 以前は「前回までの件数から先」だけを写していたため、上限に達すると件数が変わらなくなり、
// 以後1件も写せなくなっていた。艦隊の全アプリが同じ写しを使っている。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('./records-hub-client.js', import.meta.url), 'utf8');
const HUB_ORIGIN = 'https://gamification.giga-school.com';
const LOG_KEY = 'study.records.v1';
const CAP = 500;

/** ブラウザの代わり。ハブは届いた id を覚え、いつも ok を返す */
function createEnvironment() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const listeners = {};
  const received = [];
  const frameWindow = {
    postMessage(message) {
      received.push(...message.records.map((r) => r.id));
      setTimeout(() => (listeners.message || []).forEach((fn) => fn({
        origin: HUB_ORIGIN, source: frameWindow, data: { type: 'giga.hub.result', reqId: message.reqId, ok: true },
      })), 0);
    },
  };
  const document = {
    readyState: 'complete',
    hidden: false,
    createElement() {
      return { style: {}, setAttribute() {}, _l: {}, addEventListener(t, f) { this._l[t] = f; }, contentWindow: frameWindow };
    },
    addEventListener() {},
    body: { appendChild(el) { setTimeout(() => el._l.load && el._l.load(), 0); } },
  };
  const window = { addEventListener(t, f) { (listeners[t] ||= []).push(f); } };
  const context = vm.createContext({
    window, document, localStorage,
    location: { origin: 'https://kanji-town.giga-school.com', hostname: 'kanji-town.giga-school.com' },
    setTimeout, clearTimeout, setInterval: () => 1, Promise, Map, Set, JSON, Math, Array,
  });

  let n = 0;
  const addRecords = (count) => {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    for (let i = 0; i < count; i++) log.push({ schema: 'study.v1', id: `rec-${String(++n).padStart(6, '0')}`, appId: 'kanji-town' });
    if (log.length > CAP) log.splice(0, log.length - CAP);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const start = async () => { vm.runInContext(SOURCE, context); await settle(); };
  const sync = async () => { await window.GigaRecordsHub.sync(); await settle(); };
  return { localStorage, received, addRecords, start, sync };
}

test('学習ログが上限（500件）に達したあとも、新しい記録を写しつづける', async () => {
  const env = createEnvironment();
  env.addRecords(CAP);
  await env.start();
  assert.equal(env.received.length, CAP);

  env.received.length = 0;
  env.addRecords(10);
  await env.sync();
  assert.deepEqual(env.received, Array.from({ length: 10 }, (_, i) => `rec-${String(CAP + 1 + i).padStart(6, '0')}`));

  env.received.length = 0;
  env.addRecords(3);
  await env.sync();
  assert.equal(env.received.length, 3);
});

test('新しい記録が無いときは、何も送らない', async () => {
  const env = createEnvironment();
  env.addRecords(CAP);
  await env.start();
  env.received.length = 0;
  await env.sync();
  assert.equal(env.received.length, 0);
});

test('上限に達する前は、これまでどおり増えた分だけを送る', async () => {
  const env = createEnvironment();
  env.addRecords(20);
  await env.start();
  env.received.length = 0;
  env.addRecords(5);
  await env.sync();
  assert.equal(env.received.length, 5);
});

test('控えが古い形（件数だけ）でも、新しい記録を送れる', async () => {
  const env = createEnvironment();
  env.addRecords(30);
  env.localStorage.setItem('study.hub.mirrored.v1', JSON.stringify({ count: 25 }));
  await env.start();
  assert.equal(env.received.length, 5);
});
