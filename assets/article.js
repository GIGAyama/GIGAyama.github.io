/* =============================================================
   GIGA school — アプリの紹介ページ
   画面写真を、押したら大きく見られるようにする。

   依存ライブラリなし。JavaScript が無効なとき、あるいは <dialog> が
   使えないときは、画像そのものが開く（ふつうのリンクのまま）。

   ── なぜ「幅いっぱい＋縦スクロール」なのか ──────────────
   画面写真の 57% は縦長（780×1880 など、スマホの画面）である。
   画面に収まる大きさへ縮めると、幅が 330px ほどになってしまい、
   本文の中で見るのと大して変わらない。大きくした意味がなくなる。
   だから縮めず、元の大きさまでで幅いっぱいに出し、縦は流して読ませる。
   ============================================================= */
(function () {
  'use strict';

  var zooms = document.querySelectorAll('.prose__zoom');
  if (!zooms.length) return;
  if (typeof HTMLDialogElement === 'undefined') return;   // 使えない環境は、ふつうのリンクのまま

  var dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', '画面写真を大きく表示');
  dialog.innerHTML =
    '<div class="lightbox__inner">'
    + '<img class="lightbox__img" alt="">'
    + '<p class="lightbox__caption"></p>'
    + '</div>'
    + '<button class="lightbox__close" type="button" aria-label="閉じる">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
    + ' stroke-linecap="round" aria-hidden="true" focusable="false">'
    + '<path d="M6 6 18 18M18 6 6 18"/></svg></button>';
  document.body.appendChild(dialog);

  var img = dialog.querySelector('.lightbox__img');
  var caption = dialog.querySelector('.lightbox__caption');
  var inner = dialog.querySelector('.lightbox__inner');

  function open(link) {
    var source = link.querySelector('img');
    var fig = link.closest('figure');
    var text = fig ? fig.querySelector('figcaption') : null;

    img.src = link.getAttribute('href');
    img.alt = source ? source.alt : '';
    caption.textContent = text ? text.textContent : '';
    caption.hidden = !caption.textContent;

    dialog.showModal();
    inner.scrollTop = 0;   // 前に見た画像の位置を持ち越さない
  }

  Array.prototype.forEach.call(zooms, function (link) {
    link.addEventListener('click', function (event) {
      /* 別のタブで開こうとしている人の邪魔をしない */
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(link);
    });
  });

  dialog.querySelector('.lightbox__close').addEventListener('click', function () {
    dialog.close();
  });

  /* 画像の外側を押したら閉じる。画像そのものを押したときは閉じない
     （拡大して見ている最中に、少し動かしただけで消えてしまわないように） */
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog || event.target === inner) dialog.close();
  });

  /* 閉じたあとに画像を外す。次に開くまで通信も描画もさせない */
  dialog.addEventListener('close', function () {
    img.removeAttribute('src');
  });
})();
