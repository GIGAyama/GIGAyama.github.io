/**
 * 【正本】standards/gas/Gemini.gs のテスト。
 *
 * GAS のランタイムは手元で動かせないので、UrlFetchApp / Utilities を偽物に
 * 差しかえて、Node で中身の判断だけを検査する。見るのは次の3点。
 *
 *   1. 一時エラー（429/503）で本当に再試行するか
 *   2. 再試行しても無駄なエラー（400/403）で即座にあきらめるか
 *   3. 200 でも本文が空のとき、成功として返してしまわないか
 *
 * 3番目がいちばん大事。空文字を成功として返すと、児童の画面に空欄が
 * 保存され、あとから原因を追えなくなる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'Gemini.gs'), 'utf8');

/** 応答の並びを与えて GigaGemini を作る。sleeps には待った時間が入る */
function load(responses) {
  const calls = [];
  const sleeps = [];
  const queue = [...responses];
  const sandbox = {
    module: { exports: {} },
    console,
    UrlFetchApp: {
      fetch(url, options) {
        calls.push({ url, options });
        const r = queue.shift();
        if (!r) throw new Error('テストの応答が足りません');
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
      fetchAll(requests) {
        calls.push({ batch: requests.length });
        return requests.map(() => {
          const r = queue.shift();
          if (!r) throw new Error('テストの応答が足りません');
          return { getResponseCode: () => r.code, getContentText: () => r.body };
        });
      },
    },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { G: sandbox.module.exports, calls, sleeps };
}

/** vm の中で作られた値は別realmのプロトタイプを持ち、strict な deepEqual が
 *  「構造は同じだが参照が違う」で落ちる。検査したいのは中身なので、
 *  こちら側のrealmの素のオブジェクトに直してから比べる。 */
const plain = (v) => JSON.parse(JSON.stringify(v));

const okBody = (text) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
const errBody = (msg) => JSON.stringify({ error: { message: msg } });
const REQ = { apiKey: 'k', prompt: 'こんにちは' };

test('200 なら本文を返し、前後の空白を落とす', () => {
  const { G, calls } = load([{ code: 200, body: okBody('  こたえ  ') }]);
  assert.equal(G.call(REQ), 'こたえ');
  assert.equal(calls.length, 1);
});

test('API キーは URL ではなくヘッダで送る', () => {
  const { G, calls } = load([{ code: 200, body: okBody('a') }]);
  G.call(REQ);
  assert.doesNotMatch(calls[0].url, /key=/, 'URL にキーが載っている');
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'k');
});

test('429 は再試行し、待ち時間が指数で伸びる', () => {
  const { G, calls, sleeps } = load([
    { code: 429, body: errBody('rate') },
    { code: 429, body: errBody('rate') },
    { code: 200, body: okBody('やっと成功') },
  ]);
  assert.equal(G.call(REQ), 'やっと成功');
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('503 も再試行する', () => {
  const { G, calls } = load([
    { code: 503, body: '' },
    { code: 200, body: okBody('ok') },
  ]);
  assert.equal(G.call(REQ), 'ok');
  assert.equal(calls.length, 2);
});

test('再試行を使いきったら AI_BUSY を投げる', () => {
  const { G, calls } = load([
    { code: 429, body: errBody('rate') },
    { code: 429, body: errBody('rate') },
    { code: 429, body: errBody('rate') },
  ]);
  assert.throws(() => G.call(REQ), /AI_BUSY/);
  assert.equal(calls.length, 3, '3回で打ち切っていない');
});

test('400 は再試行しない（何度投げても同じ）', () => {
  const { G, calls, sleeps } = load([{ code: 400, body: errBody('bad prompt') }]);
  assert.throws(() => G.call(REQ), /AI_ERROR/);
  assert.equal(calls.length, 1, '無駄な再試行をしている');
  assert.deepEqual(sleeps, []);
});

test('403 はキーの問題だと分かる文言で伝える', () => {
  const { G } = load([{ code: 403, body: errBody('API key not valid') }]);
  assert.throws(() => G.call(REQ), /APIキー/);
});

test('200 でも本文が空なら成功にしない', () => {
  // 安全フィルタで止められると、200 のまま candidates が空で返る。
  // ここを成功として返すと、画面に空欄が保存されて原因を追えなくなる。
  const { G } = load([{ code: 200, body: JSON.stringify({ candidates: [] }) }]);
  assert.throws(() => G.call(REQ), /AI_EMPTY/);
});

test('APIキーが無ければ通信する前に止まる', () => {
  const { G, calls } = load([]);
  assert.throws(() => G.call({ prompt: 'x' }), /APIキー/);
  assert.equal(calls.length, 0, 'キー無しで通信してしまった');
});

test('callJson はコードフェンス付きでも読める', () => {
  const { G } = load([{ code: 200, body: okBody('```json\n{"a":1}\n```') }]);
  assert.deepEqual(plain(G.callJson(REQ)), { a: 1 });
});

test('callJson は前後に説明文があっても読める', () => {
  const { G } = load([{ code: 200, body: okBody('はい、こちらです。\n{"b":2}\nどうぞ。') }]);
  assert.deepEqual(plain(G.callJson(REQ)), { b: 2 });
});

test('parseJsonText は配列も読める', () => {
  const { G } = load([]);
  assert.deepEqual(plain(G.parseJsonText('```\n[1,2]\n```')), [1, 2]);
});

test('parseJsonText は JSON でなければ日本語で断る', () => {
  const { G } = load([]);
  assert.throws(() => G.parseJsonText('ごめんなさい、わかりません'), /JSONとして読めません/);
});

test('callAll は件数と順序を保ち、例外を投げない', () => {
  const { G } = load([
    { code: 200, body: okBody('one') },
    { code: 400, body: errBody('bad') },
    { code: 200, body: okBody('three') },
  ]);
  const out = G.callAll([REQ, REQ, REQ], { chunkSize: 8 });
  assert.equal(out.length, 3);
  assert.deepEqual(plain(out).map((r) => r.ok), [true, false, true]);
  assert.deepEqual(plain(out).map((r) => r.text), ['one', '', 'three']);
  assert.match(out[1].error, /AI_ERROR/);
});

test('callAll は一時エラーのものだけ再試行する', () => {
  const { G, calls } = load([
    { code: 200, body: okBody('ok1') },
    { code: 503, body: '' },        // ← これだけ再試行される
    { code: 200, body: okBody('ok2-retry') },
  ]);
  const out = G.callAll([REQ, REQ], { chunkSize: 8 });
  assert.deepEqual(plain(out).map((r) => r.ok), [true, true]);
  assert.equal(out[1].text, 'ok2-retry');
  assert.equal(calls[1].batch, 1, '成功したぶんまで投げ直している');
});

test('callAll は chunkSize ごとに小分けする', () => {
  const { G, calls } = load(Array.from({ length: 5 }, () => ({ code: 200, body: okBody('x') })));
  G.callAll(Array.from({ length: 5 }, () => REQ), { chunkSize: 2 });
  assert.deepEqual(calls.map((c) => c.batch), [2, 2, 1]);
});
