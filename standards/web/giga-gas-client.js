/* =====================================================================
 * giga-gas-client.js — GitHub Pages のページから GAS ウェブアプリを呼ぶ
 * =====================================================================
 * 何のためにあるか
 * ----------------
 * 「型E（担任が自分でデプロイする）」では、アプリの画面は Pages 側に置き、
 * データの読み書きだけを担任自身の GAS ウェブアプリに投げる。
 * このとき Pages（https://〜.giga-school.com）から
 * GAS（https://script.google.com/macros/s/…/exec）へ、
 * ブラウザから直接 fetch することになる。ここには GAS 特有の落とし穴が
 * いくつもあり、どれも「動かない理由が画面に出ない」形で失敗する。
 * 各アプリが自前で書くと、そのたびに同じ穴に落ちる。
 *
 * 落とし穴と、この実装が取っている手当て
 * --------------------------------------
 * 1. プリフライト（OPTIONS）を出してはいけない
 *    GAS のウェブアプリは OPTIONS リクエストに答えられない。
 *    Content-Type を 'application/json' にすると、ブラウザは必ず
 *    プリフライトを出すので、本文が届く前に失敗する。
 *    → 'text/plain;charset=utf-8' で送る。中身は JSON のままでよい。
 *      GAS 側は e.postData.contents を JSON.parse すれば読める。
 *
 * 2. 302 リダイレクトを追う必要がある
 *    /exec に POST すると script.googleusercontent.com へ 302 で飛び、
 *    その先で ContentService の応答が返る。
 *    → redirect: 'follow'（fetch の既定だが、意図として明示する）
 *
 * 3. no-cors を使ってはいけない
 *    no-cors だと応答が opaque になり、成功も失敗も区別できない。
 *    linker-clipper で実際にこれをやっていて、GAS が断っていても
 *    「送信しました」と表示して手元のデータを消していた。
 *    → 通常の cors で投げ、status と本文を見る。
 *
 * 4. 応答が JSON とはかぎらない
 *    未ログイン・権限不足のときは Google のログイン画面の HTML が返る。
 *    JSON.parse がそこで例外になるので、「JSON が壊れている」ではなく
 *    「アクセス権を確かめてください」と言えるようにする。
 *
 * 5. 沈黙したまま終わらない
 *    GAS の実行が詰まるとブラウザ側は待ち続ける。
 *    → AbortController で時間を切る。
 *
 * 6. 一時的な失敗は自分で拾い直す
 *    GAS は同時実行数の上限や一時的な 500 を返す。児童が一斉に開く場面で
 *    そのまま失敗させると、教室で数人だけ書けない形になる。
 *    → 429/500/502/503/504 とネットワークエラーだけ、時間を空けて再試行。
 *
 * 何をしないか
 * ------------
 * - 認証はしない。誰であるかは GAS 側が Session.getActiveUser() で見る。
 *   型Eでは exec URL 自体が担任のデプロイなので、URL を知っていることと
 *   Google にログインしていることが入口になる。
 * - 画面も出さない。文言はアプリ側が決める。
 *
 * 使いかた
 *   const gas = GigaGasClient.create({ url: execUrl });
 *   const res = await gas.call('listPins', { classCode: 'ABC123' });
 *
 * GAS 側は doPost(e) で e.postData.contents を JSON.parse し、
 * { action, params } を見て分岐して、ContentService で JSON を返す。
 * ===================================================================== */

var GigaGasClient = (function () {
  'use strict';

  var DEFAULTS = {
    timeoutMs: 30000,
    maxAttempts: 3,
    baseDelayMs: 800,
  };

  // 再試行してよい HTTP 応答。400 や 403 は何度やっても同じなので入れない。
  var RETRIABLE = [429, 500, 502, 503, 504];

  /** exec URL として妥当か（打ち間違いを、通信する前に止める） */
  function validateUrl(url) {
    var u = String(url || '').trim();
    if (!u) throw new Error('GAS_URL_MISSING: ウェブアプリの URL が設定されていません');
    if (u.indexOf('https://script.google.com/') !== 0) {
      throw new Error('GAS_URL_INVALID: ウェブアプリの URL は https://script.google.com/ で始まります');
    }
    // /dev は本人しか開けない。配布して「先生の画面は出るのに児童は真っ白」
    // になる典型なので、ここで止める。
    if (/\/dev\/?(\?|$)/.test(u)) {
      throw new Error('GAS_URL_DEV: /dev の URL は本人しか開けません。デプロイ画面の /exec で終わる URL を使ってください');
    }
    if (!/\/exec\/?(\?|$)/.test(u)) {
      throw new Error('GAS_URL_INVALID: /exec で終わる URL を使ってください');
    }
    return u;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 応答の本文を読んで JSON にする。
   * JSON でなければ「アクセス権」の話として投げる（ログイン画面の HTML）。
   */
  function parseBody(text) {
    var t = String(text == null ? '' : text);
    try {
      return JSON.parse(t);
    } catch (e) {
      if (/<html|<!DOCTYPE/i.test(t)) {
        throw new Error('GAS_NOT_AUTHORIZED: サーバーからの返事を読めませんでした。'
          + 'Google にログインしているか、この URL を開く権限があるかを確かめてください');
      }
      throw new Error('GAS_BAD_RESPONSE: サーバーからの返事を読めませんでした');
    }
  }

  function create(options) {
    var opts = options || {};
    var url = validateUrl(opts.url);
    var timeoutMs = opts.timeoutMs || DEFAULTS.timeoutMs;
    var maxAttempts = opts.maxAttempts || DEFAULTS.maxAttempts;
    var baseDelayMs = opts.baseDelayMs || DEFAULTS.baseDelayMs;
    var fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw new Error('GAS_NO_FETCH: この環境には fetch がありません');

    /** 1回だけ投げる（再試行は call が受け持つ） */
    function once(body) {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
      return fetchImpl(url, {
        method: 'POST',
        redirect: 'follow',
        // ここを application/json にすると、ブラウザがプリフライト（OPTIONS）を
        // 出す。GAS は OPTIONS に答えられないので必ず失敗する。中身は JSON でよい。
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        return res;
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
    }

    /**
     * GAS の関数を1つ呼ぶ。
     * @param {string} action GAS 側で分岐に使う名前
     * @param {Object} params その関数に渡す値
     * @return {Promise<*>} 応答の data（GAS が {ok:true, data:…} を返す前提）
     */
    function call(action, params) {
      var body = { action: String(action || ''), params: params || {} };
      var lastError = null;

      function attempt(n) {
        return once(body).then(function (res) {
          if (res.ok) return res.text().then(function (text) {
            var json = parseBody(text);
            // GAS 側が「断った」ことは成功した通信の中で伝わる。
            // ここで例外にしておかないと、呼び出し側が失敗に気づけない。
            if (json && json.ok === false) {
              throw new Error(json.code
                ? json.code + ': ' + (json.error || json.message || '処理できませんでした')
                : (json.error || json.message || '処理できませんでした'));
            }
            return (json && Object.prototype.hasOwnProperty.call(json, 'data')) ? json.data : json;
          });

          if (RETRIABLE.indexOf(res.status) === -1) {
            throw new Error('GAS_HTTP_' + res.status + ': サーバーの応答が ' + res.status + ' でした');
          }
          lastError = new Error('GAS_HTTP_' + res.status + ': サーバーが混み合っています（' + res.status + '）');
          return retry(n);
        }, function (err) {
          // 中止（時間切れ）と、通信そのものの失敗。どちらも待って試し直す価値がある。
          var name = err && err.name;
          lastError = (name === 'AbortError')
            ? new Error('GAS_TIMEOUT: 応答がありませんでした（' + timeoutMs + 'ms）')
            : new Error('GAS_NETWORK: 通信できませんでした');
          return retry(n);
        });
      }

      function retry(n) {
        if (n + 1 >= maxAttempts) throw lastError;
        return sleep(baseDelayMs * Math.pow(2, n)).then(function () { return attempt(n + 1); });
      }

      return attempt(0);
    }

    return { call: call, url: url };
  }

  return {
    create: create,
    validateUrl: validateUrl,
    parseBody: parseBody,
    DEFAULTS: DEFAULTS,
    RETRIABLE: RETRIABLE,
  };
})();

// Node（テスト）から読めるようにする。ブラウザでは module が無いので何もしない。
if (typeof module !== 'undefined' && module.exports) module.exports = GigaGasClient;
