/* =============================================================
   紹介記事の中を探す（/apps/）

   トップページの検索（app.js）はカードの語だけを見ている。
   こちらは記事の本文 226,000 字を対象にする。

   ── 索引を最初に読み込まない ──────────────────
   索引は 663KB（配るときは gzip がかかって 182KB）ある。
   ページを開いただけの人にこれを読ませる理由はないので、
   検索の欄に触れたときに、はじめて取りに行く。1 回読めば使い回す。

   ── 当たったところへ直接つなぐ ────────────────
   索引は見出し（h2）ごとに切ってある。当たった節の名前を出し、
   /apps/<slug>/#s-3 のように、その節へ直接つなぐ。
   使い方マニュアルの節は /apps/<slug>/manual/#s-3 へ（項目の u に入っている）。
   21,000 字の記事を頭から探し直させない。

   依存ライブラリなし。外へは何も送らない。
   ============================================================= */
(function () {
  'use strict';

  var box = document.querySelector('[data-article-search]');
  if (!box) return;

  /* ここまで来たら JavaScript は動いている。CSS が検索の欄を出す */
  document.documentElement.classList.remove('no-js');

  var input = box.querySelector('input[type="search"]');
  var clear = box.querySelector('.search__clear');
  var status = document.querySelector('[data-search-status]');
  var results = document.querySelector('[data-search-results]');
  var list = document.querySelector('.article-list');
  /* 検索しているあいだ引っこめるもの（分野の入口と、一覧の見出し） */
  var hideables = document.querySelectorAll('[data-search-hide]');
  if (!input || !results || !list) return;

  var SNIPPET = 42;        // 当たったところの前後に出す文字数
  var LIMIT = 40;          // 出す件数の上限。これ以上は絞ってもらう
  var index = null;
  var loading = null;
  var timer = 0;

  /* 全角・半角・大文字小文字・ひらがなカタカナの違いを吸収する。
     ⚠️ 文字数が変わらないようにする。当たった位置をそのまま
        元の文字列で使い、前後を抜き出して見せるため。 */
  function fold(s) {
    return String(s)
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 0x60);
      })
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      });
  }

  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    say('索引を読み込んでいます…');
    loading = fetch('/data/search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) {
        index = (data.items || []).map(function (it) {
          return { s: it.s, n: it.n, i: it.i, h: it.h, t: it.t,
                   /* 行き先。持っていない項目は紹介ページ。索引を軽くするため、
                      /apps/<slug>/ のときは書き出す側で省いてある */
                   u: it.u || ('/apps/' + it.s + '/'),
                   f: fold(it.t), fh: fold(it.h + ' ' + it.n + ' ' + (it.hr || '')),
                   /* ふりがなのよみ。見せる文字（h・t）はふりがなを落とした字なので、
                      これが無いと「けいさん」と打っても「計算」の節に当たらない。
                      ⚠️ f には混ぜない。混ぜると当たった位置が t の外を指して、
                         抜き出す一文がずれる。探すためだけの別の入れ物にする */
                   fr: fold(it.r || '') };
        });
        return index;
      })
      .catch(function () {
        loading = null;
        say('索引を読み込めませんでした。少し待ってから、もう一度お試しください。');
        return null;
      });
    return loading;
  }

  function say(text) {
    if (status) status.textContent = text;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 当たったところの前後を切り出す。文の途中から始まるので、前後に「…」を付ける */
  function snippet(text, at, len) {
    var from = Math.max(0, at - SNIPPET);
    var to = Math.min(text.length, at + len + SNIPPET);
    return (from > 0 ? '…' : '')
      + esc(text.slice(from, at))
      + '<mark>' + esc(text.slice(at, at + len)) + '</mark>'
      + esc(text.slice(at + len, to))
      + (to < text.length ? '…' : '');
  }

  function search(q) {
    var needle = fold(q);
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i];
      var at = it.f.indexOf(needle);
      /* 見出しやアプリの名前に当たったものを先に出す。
         「九九カード」で探したときに、本文で触れているだけの節より、
         そのアプリの節が先に来てほしい */
      var inHead = it.fh.indexOf(needle) >= 0;
      /* かなで打たれたときは、ふりがなのよみでも当てる。
         当たった位置（at）は本文のものだけを使う。よみで当たったときは
         位置が無いので、節の頭を抜き出して見せる */
      var inReading = at < 0 && !inHead && it.fr.indexOf(needle) >= 0;
      if (at < 0 && !inHead && !inReading) continue;
      hits.push({ it: it, at: at, head: inHead });
    }
    hits.sort(function (a, b) { return (b.head ? 1 : 0) - (a.head ? 1 : 0); });
    return hits;
  }

  function render(q, hits) {
    var shown = hits.slice(0, LIMIT);
    results.innerHTML = shown.map(function (h) {
      var it = h.it;
      return '<li class="hit">'
        + '<a class="hit__link" href="' + it.u + '#' + it.i + '">'
        + '<span class="hit__app">' + esc(it.n) + '</span>'
        + '<span class="hit__head">' + esc(it.h) + '</span></a>'
        + '<p class="hit__text">'
        + (h.at >= 0 ? snippet(it.t, h.at, q.length) : esc(it.t.slice(0, SNIPPET * 2)) + '…')
        + '</p></li>';
    }).join('');

    if (!hits.length) {
      say('「' + q + '」は見つかりませんでした。ほかの言い方でも試してみてください。');
    } else if (hits.length > LIMIT) {
      say(hits.length + ' 件のうち ' + LIMIT + ' 件を出しています。もう少し詳しく入れると絞れます。');
    } else {
      say(hits.length + ' 件見つかりました。');
    }
  }

  function show(on) {
    list.hidden = on;
    results.hidden = !on;
    for (var i = 0; i < hideables.length; i++) hideables[i].hidden = on;
    if (clear) clear.hidden = !on;
  }

  function run() {
    var q = input.value.trim();
    if (!q) {
      show(false);
      say('');
      return;
    }
    load().then(function (ok) {
      if (!ok) return;
      /* 読み込んでいるあいだに消されていることがある */
      if (input.value.trim() !== q) return;
      show(true);
      render(q, search(q));
    });
  }

  input.addEventListener('input', function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 180);
  });
  /* 打ちはじめる前に取りに行っておくと、1 文字目から待たせずに済む */
  input.addEventListener('focus', load, { once: true });

  if (clear) {
    clear.hidden = true;
    clear.addEventListener('click', function () {
      input.value = '';
      input.focus();
      run();
    });
  }
}());
