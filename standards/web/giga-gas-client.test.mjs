/* =====================================================================
 * giga-gas-client のテスト
 * =====================================================================
 * このクライアントの値打ちは「GAS 特有の失敗を、原因の分かる形で返す」
 * ことにある。だからテストも、通信が成功する道より、
 *
 *   - プリフライトを出さない送り方になっているか
 *   - ログイン画面の HTML が返ってきたときに何と言うか
 *   - 混み合ったときに拾い直すか、無駄な再試行をしないか
 *   - /dev の URL を配ってしまっていないか
 *
 * に厚みを置いている。
 * ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GigaGasClient = require('./giga-gas-client.js');

const EXEC = 'https://script.google.com/macros/s/AKfyc123/exec';

/** fetch の偽物。渡した応答を順に返し、呼ばれ方を記録する */
function fakeFetch(responses) {
  const calls = [];
  const queue = responses.slice();
  const impl = (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === 'function') return next();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: () => Promise.resolve(next.body),
    });
  };
  impl.calls = calls;
  return impl;
}

const jsonOk = (data) => ({ status: 200, body: JSON.stringify({ ok: true, data }) });

// ── URL の検査 ──────────────────────────────────────────────

test('exec URL をそのまま受ける', () => {
  assert.equal(GigaGasClient.validateUrl(EXEC), EXEC);
});

test('/dev の URL は断る（本人しか開けず、配ると児童側が真っ白になる）', () => {
  assert.throws(
    () => GigaGasClient.validateUrl('https://script.google.com/macros/s/AKfyc123/dev'),
    /GAS_URL_DEV/
  );
});

test('script.google.com 以外は断る', () => {
  assert.throws(() => GigaGasClient.validateUrl('https://example.com/exec'), /GAS_URL_INVALID/);
});

test('空の URL は、通信する前に断る', () => {
  assert.throws(() => GigaGasClient.validateUrl(''), /GAS_URL_MISSING/);
});

test('/exec でも /dev でもない URL は断る', () => {
  assert.throws(
    () => GigaGasClient.validateUrl('https://script.google.com/macros/s/AKfyc123/'),
    /GAS_URL_INVALID/
  );
});

// ── 送り方 ─────────────────────────────────────────────────

test('Content-Type は text/plain（application/json だとプリフライトが出て必ず失敗する）', async () => {
  const f = fakeFetch([jsonOk({ n: 1 })]);
  await GigaGasClient.create({ url: EXEC, fetch: f }).call('ping', {});
  assert.equal(f.calls[0].init.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('302 を追う指定になっている（/exec は googleusercontent へ飛ばす）', async () => {
  const f = fakeFetch([jsonOk(null)]);
  await GigaGasClient.create({ url: EXEC, fetch: f }).call('ping', {});
  assert.equal(f.calls[0].init.redirect, 'follow');
});

test('no-cors を使っていない（使うと成功と失敗が区別できなくなる）', async () => {
  const f = fakeFetch([jsonOk(null)]);
  await GigaGasClient.create({ url: EXEC, fetch: f }).call('ping', {});
  assert.notEqual(f.calls[0].init.mode, 'no-cors');
});

test('本文は { action, params } の JSON', async () => {
  const f = fakeFetch([jsonOk(null)]);
  await GigaGasClient.create({ url: EXEC, fetch: f }).call('listPins', { classCode: 'ABC' });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    action: 'listPins',
    params: { classCode: 'ABC' },
  });
});

// ── 応答の読み取り ──────────────────────────────────────────

test('{ok:true, data} の data を返す', async () => {
  const f = fakeFetch([jsonOk({ pins: [1, 2] })]);
  const got = await GigaGasClient.create({ url: EXEC, fetch: f }).call('listPins', {});
  assert.deepEqual(got, { pins: [1, 2] });
});

test('data が無い応答は、そのまま返す', async () => {
  const f = fakeFetch([{ status: 200, body: JSON.stringify({ ok: true, message: 'はい' }) }]);
  const got = await GigaGasClient.create({ url: EXEC, fetch: f }).call('ping', {});
  assert.deepEqual(got, { ok: true, message: 'はい' });
});

test('{ok:false} は例外にする（通信は成功していても、処理は断られている）', async () => {
  const f = fakeFetch([{
    status: 200,
    body: JSON.stringify({ ok: false, code: 'NOT_MEMBER', error: 'このクラスの一員ではありません' }),
  }]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f }).call('listPins', {}),
    /NOT_MEMBER: このクラスの一員ではありません/
  );
});

test('ログイン画面の HTML が返ったら、アクセス権の話として伝える', async () => {
  const f = fakeFetch([{ status: 200, body: '<!DOCTYPE html><html>Sign in</html>' }]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f }).call('listPins', {}),
    /GAS_NOT_AUTHORIZED/
  );
});

test('JSON でも HTML でもない返事は、その旨を伝える', async () => {
  const f = fakeFetch([{ status: 200, body: 'not json at all' }]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f }).call('ping', {}),
    /GAS_BAD_RESPONSE/
  );
});

// ── 再試行 ─────────────────────────────────────────────────

test('混み合い（500）は待って試し直し、次が通れば成功として返す', async () => {
  let n = 0;
  const impl = () => {
    n++;
    const r = n === 1
      ? { status: 500, body: 'busy' }
      : { status: 200, body: JSON.stringify({ ok: true, data: 'done' }) };
    return Promise.resolve({ ok: r.status === 200, status: r.status, text: () => Promise.resolve(r.body) });
  };
  const got = await GigaGasClient.create({ url: EXEC, fetch: impl, baseDelayMs: 1 }).call('ping', {});
  assert.equal(got, 'done');
  assert.equal(n, 2);
});

test('403 は試し直さない（何度やっても同じで、待たせるだけ）', async () => {
  const f = fakeFetch([{ status: 403, body: 'denied' }]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f, baseDelayMs: 1 }).call('ping', {}),
    /GAS_HTTP_403/
  );
  assert.equal(f.calls.length, 1);
});

test('通信できないときも試し直す。最後まで駄目なら通信の失敗として伝える', async () => {
  const f = fakeFetch([new Error('network down')]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f, baseDelayMs: 1, maxAttempts: 3 }).call('ping', {}),
    /GAS_NETWORK/
  );
  assert.equal(f.calls.length, 3);
});

test('試し直しの回数は maxAttempts で止まる（無限には粘らない）', async () => {
  const f = fakeFetch([{ status: 503, body: 'busy' }]);
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: f, baseDelayMs: 1, maxAttempts: 2 }).call('ping', {}),
    /GAS_HTTP_503/
  );
  assert.equal(f.calls.length, 2);
});

test('時間切れは、待ち続けずに時間切れとして返す', async () => {
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  await assert.rejects(
    () => GigaGasClient.create({ url: EXEC, fetch: impl, timeoutMs: 10, baseDelayMs: 1, maxAttempts: 2 })
      .call('ping', {}),
    /GAS_TIMEOUT/
  );
});
