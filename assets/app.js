/* =============================================================
   GIGA school — giga-school.com
   検索・絞り込み・テーマ切り替え
   依存ライブラリなし。JavaScript が無効でも一覧はそのまま読める。
   ============================================================= */
(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  /* ---------------------------------------------------------
     テーマ（ライト／ダーク）
     --------------------------------------------------------- */
  var STORE_KEY = 'giga-school:theme';
  var root = document.documentElement;

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORE_KEY, theme); } catch (e) { /* 保存できなくても動く */ }
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label',
        theme === 'dark' ? 'ライトテーマに切り替える' : 'ダークテーマに切り替える');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d1117' : '#ffffff');
  }

  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    applyTheme(currentTheme());
    toggle.addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------------------------------------------------------
     ヘッダーの影（スクロール位置で境界線を出す）
     --------------------------------------------------------- */
  var header = document.querySelector('.site-header');
  if (header && 'IntersectionObserver' in window) {
    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
    document.body.prepend(sentinel);
    new IntersectionObserver(function (entries) {
      header.dataset.stuck = String(!entries[0].isIntersecting);
    }).observe(sentinel);
  }

  /* ---------------------------------------------------------
     上に戻る
     --------------------------------------------------------- */
  var toTop = document.querySelector('.to-top');
  if (toTop) {
    var onScroll = function () {
      toTop.dataset.visible = String(window.scrollY > 720);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    toTop.addEventListener('click', function () {
      window.scrollTo({
        top: 0,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    });
  }

  /* ---------------------------------------------------------
     動きを減らす設定かどうか
     --------------------------------------------------------- */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------
     スクロールに合わせて静かに現れる

     隠すのはこの処理が動いたときだけ。JavaScript が読み込まれなかった場合や
     途中で失敗した場合は何も隠れず、そのまま読める。
     --------------------------------------------------------- */
  (function setUpReveal() {
    if (reduceMotion.matches || !('IntersectionObserver' in window)) return;

    var targets = Array.prototype.slice.call(
      document.querySelectorAll('.section__head, .pillar, .card, .info-card, .contact'));
    if (!targets.length) return;

    root.classList.add('js-reveal');
    targets.forEach(function (el) { el.dataset.reveal = 'pending'; });

    var observer = new IntersectionObserver(function (entries) {
      var step = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        /* 同時に入ってきたものは少しずつ遅らせる（同じ行が順に現れて見える） */
        el.style.setProperty('--reveal-delay', Math.min(step, 4) * 40 + 'ms');
        el.dataset.reveal = 'in';
        observer.unobserve(el);
        step++;
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

    targets.forEach(function (el) { observer.observe(el); });

    function revealAll() {
      observer.disconnect();
      targets.forEach(function (el) { el.dataset.reveal = 'in'; });
    }

    /* 途中で「動きを減らす」に切り替えられたら、残りをすべて出しておく */
    if (reduceMotion.addEventListener) {
      reduceMotion.addEventListener('change', function () {
        if (reduceMotion.matches) revealAll();
      });
    }

    /* 保険：画面の中に入って少し経っても出現待ちのままなら、監視が届いていないと
       みなして全部出す。本文が消えたままになるのが、いちばん困る壊れ方なので。 */
    var sweepTimer = null;

    function detach() {
      window.removeEventListener('scroll', schedule);
      if (sweepTimer) { window.clearTimeout(sweepTimer); sweepTimer = null; }
    }

    function sweep() {
      sweepTimer = null;
      var stuck = false, remaining = 0;
      targets.forEach(function (el) {
        if (el.dataset.reveal !== 'pending') return;
        remaining++;
        var r = el.getBoundingClientRect();
        /* 出現の境目（画面下から 12%）より上に来ているのに待ったまま */
        if (r.top < window.innerHeight * 0.88 && r.bottom > 0) stuck = true;
      });
      if (stuck) { revealAll(); detach(); return; }
      if (!remaining) detach();
    }

    function schedule() {
      if (sweepTimer) return;
      sweepTimer = window.setTimeout(sweep, 700);   // 監視が動く余地を先に与える
    }

    window.setTimeout(sweep, 2500);
    window.addEventListener('scroll', schedule, { passive: true });
  })();

  /* ---------------------------------------------------------
     アプリの検索と絞り込み
     --------------------------------------------------------- */
  var finder = document.querySelector('[data-finder]');
  if (!finder) return;

  var list = document.getElementById('app-list');
  if (!list) return;

  var cards = Array.prototype.slice.call(list.querySelectorAll('.card'));
  var input = finder.querySelector('input[type="search"]');
  var clearBtn = finder.querySelector('.search__clear');
  var chips = Array.prototype.slice.call(finder.querySelectorAll('.chip'));
  var status = finder.querySelector('[data-status]');
  var resetBtn = document.querySelector('[data-reset]');

  /* 検索対象の文字列をあらかじめ作っておく（名前・説明・カテゴリ） */
  var index = cards.map(function (card) {
    return {
      el: card,
      cat: card.dataset.cat || '',
      text: normalize([
        card.dataset.name || '',
        card.dataset.keywords || '',
        card.textContent || ''
      ].join(' '))
    };
  });

  /* 全角・半角・大文字小文字の違いを吸収する */
  function normalize(s) {
    return s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, function (c) {           // ひらがな → カタカナ
        return String.fromCharCode(c.charCodeAt(0) + 0x60);
      })
      .replace(/[-_・　\s]+/g, ' ')
      .trim();
  }

  var state = { q: '', cat: 'all' };

  var canAnimateMove = typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function';

  /* 絞り込みの前後で位置を測り、残ったカードを新しい場所へ滑らせる（FLIP）。
     消えるカードは即座に消す。フェードアウトを挟むと反応が鈍く感じるため。 */
  function measure() {
    var before = new Map();
    cards.forEach(function (el) {
      if (!el.hidden) before.set(el, el.getBoundingClientRect());
    });
    return before;
  }

  function playMove(before) {
    cards.forEach(function (el) {
      if (el.hidden) return;
      var now = el.getBoundingClientRect();
      var was = before.get(el);
      if (was) {
        var dx = was.left - now.left;
        var dy = was.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.animate(
          [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
          { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' });
      } else {
        el.animate(
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    });
  }

  function apply(writeUrl) {
    var terms = state.q ? state.q.split(' ').filter(Boolean) : [];
    var shown = 0;
    var animate = canAnimateMove && !reduceMotion.matches;
    var before = animate ? measure() : null;

    index.forEach(function (item) {
      var okCat = state.cat === 'all' || item.cat === state.cat;
      var okText = terms.every(function (t) { return item.text.indexOf(t) !== -1; });
      var visible = okCat && okText;
      item.el.hidden = !visible;
      if (visible) shown++;
    });

    /* 利用者の操作で現れたカードは、出現待ちのままにしない。
       （読み込み直後の呼び出しでは触らない。スクロールでの出現を残すため） */
    if (writeUrl) {
      cards.forEach(function (el) {
        if (!el.hidden && el.dataset.reveal === 'pending') el.dataset.reveal = 'in';
      });
    }

    if (animate) playMove(before);

    if (status) {
      status.textContent = shown === cards.length
        ? cards.length + ' 件すべてを表示しています'
        : cards.length + ' 件中 ' + shown + ' 件を表示しています';
    }

    /* 状態を URL に残す（共有・再読み込みで復元できる）。
       読み込み直後は書き換えない。ここで # を付けると、
       ブラウザがその位置まで勝手にスクロールしてしまうため。 */
    if (writeUrl) {
      var params = new URLSearchParams();
      if (state.cat !== 'all') params.set('cat', state.cat);
      if (state.q) params.set('q', input ? input.value.trim() : state.q);
      var qs = params.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }
  }

  if (input) {
    var timer = null;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        state.q = normalize(input.value);
        apply(true);
      }, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        state.q = '';
        apply(true);
      }
    });
  }

  if (clearBtn && input) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      state.q = '';
      apply(true);
      input.focus();
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.cat = chip.dataset.cat || 'all';
      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      apply(true);
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (input) input.value = '';
      state = { q: '', cat: 'all' };
      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String((c.dataset.cat || 'all') === 'all'));
      });
      apply(true);
    });
  }

  /* キーボード：/ で検索へ */
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && input && document.activeElement !== input) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  /* URL の状態を復元 */
  (function restore() {
    var params = new URLSearchParams(location.search);
    var cat = params.get('cat');
    var q = params.get('q');
    if (q && input) { input.value = q; state.q = normalize(q); }
    if (cat && chips.some(function (c) { return c.dataset.cat === cat; })) {
      state.cat = cat;
      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.dataset.cat === cat));
      });
    }
    apply(false);
  })();
})();
