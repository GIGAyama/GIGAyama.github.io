/* =============================================================
   GIGA school — リンクのコピーと、印刷

   [data-copy] のボタンと [data-print] のボタンを拾う。

   ── なぜ app.js から出したのか ──────────────────────
   ここは 2026-08-29 まで assets/app.js の中にあった。app.js を読むのは
   トップページ（/）と掲載用の資料（/press/）と自己紹介（/profile/）だけで、
   紹介ページ（/apps/<slug>/）は assets/article.js しか読まない。

   ところが紹介ページには tools/lib/article-share.mjs が「リンクをコピー」の
   ボタンを出していて、そのコメントには「既にある [data-copy]（assets/app.js）を
   そのまま使う」と書いてあった。app.js が読まれていないので、
   **32 本の紹介ページすべてで、押しても何も起きなかった。**

   押しても何も起きないボタンは、無いより悪い。読み込む側が増えても
   写しを作らずに済むよう、1 本のファイルに出してある。

   ⚠️ 読む側を増やしたら sw.js の SHELL_FILES にも足すこと。
      足さないと、電波の無いところでこのボタンだけが黙って死ぬ。
   ============================================================= */
(function () {
  'use strict';

  var toastEl = null;
  var toastTimer = null;

  function toast(message, hold) {
    if (!toastEl) {
      toastEl = document.createElement('p');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.dataset.visible = 'true';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.dataset.visible = 'false';
    }, hold || 2200);
  }

  /* ---------------------------------------------------------
     リンクをコピー

     学級だよりや Classroom に貼るときは、共有画面よりコピーが早い。
     クリップボードは https でないと使えないことがあるので、
     古いやり方（選んで写す）まで順に降りる。
     --------------------------------------------------------- */
  function copyByTextarea(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
    document.body.appendChild(box);
    box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(box);
    return ok;
  }

  function copyLink(text, what) {
    var ok = (what || 'リンク') + 'をコピーしました';
    var ng = 'コピーできませんでした：' + text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(ok);
      }).catch(function () {
        if (copyByTextarea(text)) toast(ok);
        else toast(ng, 8000);
      });
      return;
    }
    if (copyByTextarea(text)) toast(ok);
    else toast(ng, 8000);
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      /* カードは data-url を、掲載用の資料は data-copy に文字を持たせている。
         知らせの文言も、何をコピーしたかに合わせる */
      copyLink(copyBtn.dataset.copy || copyBtn.dataset.url, copyBtn.dataset.copyLabel);
      return;
    }

    /* 使い方マニュアルは、印刷して職員室で配ることを前提にしてある。
       ページの中に onclick を書かずに済ませるために、ここで拾う。 */
    var printBtn = e.target.closest('[data-print]');
    if (printBtn) {
      e.preventDefault();
      window.print();
    }
  });
})();
