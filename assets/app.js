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
      document.querySelectorAll('.section__head, .pillar, .card, .info-card, .contact, .profile-brief'));
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
     カードの中で画面写真を切り替える

     画面に入っているカードだけを動かす。2 枚目以降は、そのカードが
     見えるようになってから読み込む（最初の表示を軽くするため）。
     時計はページ全体で 1 本だけ持ち、カードごとにタイマーは作らない。
     --------------------------------------------------------- */
  (function setUpShots() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('.card__media[data-shots]'))
      .filter(function (b) { return b.querySelectorAll('img').length > 1; });
    if (!boxes.length || reduceMotion.matches || !('IntersectionObserver' in window)) return;

    var SLOW = 3400;   // ふだんの切り替え間隔
    var FAST = 1300;   // マウスを乗せているとき
    var live = [];     // いま画面に入っているもの
    var ticker = null;

    var items = boxes.map(function (box, i) {
      var imgs = Array.prototype.slice.call(box.querySelectorAll('img'));
      var dots = document.createElement('span');
      dots.className = 'card__dots';
      dots.setAttribute('aria-hidden', 'true');
      imgs.forEach(function (_, k) {
        var d = document.createElement('i');
        if (k === 0) d.className = 'is-on';
        dots.appendChild(d);
      });
      box.appendChild(dots);
      return {
        box: box, imgs: imgs, dots: dots.children, at: 0, loaded: false,
        /* カードごとに開始をずらし、一斉に切り替わらないようにする */
        next: 0, offset: (i % 7) * 480
      };
    });

    function load(item) {
      if (item.loaded) return;
      item.loaded = true;
      item.imgs.forEach(function (img) {
        var src = img.getAttribute('data-src');
        if (src) { img.src = src; img.removeAttribute('data-src'); }
      });
    }

    function step(item) {
      item.imgs[item.at].classList.remove('is-on');
      item.dots[item.at].classList.remove('is-on');
      item.at = (item.at + 1) % item.imgs.length;
      item.imgs[item.at].classList.add('is-on');
      item.dots[item.at].classList.add('is-on');
    }

    function tick() {
      var now = Date.now();
      live.forEach(function (item) {
        if (now < item.next) return;
        step(item);
        item.next = now + (item.box.matches(':hover') ? FAST : SLOW);
      });
      if (!live.length) { window.clearInterval(ticker); ticker = null; }
    }

    function start() {
      if (!ticker && live.length) ticker = window.setInterval(tick, 200);
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var item = entry.target.__shots;
        if (entry.isIntersecting) {
          load(item);
          if (live.indexOf(item) === -1) {
            item.next = Date.now() + SLOW + item.offset;
            live.push(item);
          }
        } else {
          var k = live.indexOf(item);
          if (k !== -1) live.splice(k, 1);
        }
      });
      start();
    }, { rootMargin: '120px 0px' });

    items.forEach(function (item) {
      item.box.__shots = item;
      observer.observe(item.box);
      /* マウスを乗せたら、待たずに次へ進める */
      item.box.addEventListener('pointerenter', function () {
        if (live.indexOf(item) === -1) return;
        item.next = Math.min(item.next, Date.now() + 260);
      });
    });

    /* 別のタブを見ているあいだは止める */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (ticker) { window.clearInterval(ticker); ticker = null; }
      } else {
        var now = Date.now();
        live.forEach(function (item, i) { item.next = now + SLOW + (i % 7) * 480; });
        start();
      }
    });
  })();

  /* ---------------------------------------------------------
     オフラインでも開けるようにする

     一度開いたあとは、回線が不安定でもトップページが出る。
     ページ本体は毎回ネットワークを先に見るので、内容が古いまま残らない。
     --------------------------------------------------------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* 登録できなくても、ふつうに閲覧できる */
      });
    });
  }

  /* ---------------------------------------------------------
     押した結果を短く伝える

     ページ全体で 1 つだけ持つ。読み上げにも届くよう role="status" にする。
     --------------------------------------------------------- */
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
     カードのリンクをコピー

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

  /* ---------------------------------------------------------
     カードの共有

     端末に共有の仕組みがあればそれを開き、無ければ X の投稿画面を開く。
     どちらも利用者が押したときだけ動き、勝手に外へ送るものはない。
     --------------------------------------------------------- */
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

    var btn = e.target.closest('[data-share]');
    if (!btn) return;
    e.preventDefault();
    var url = btn.dataset.url;
    var name = btn.dataset.title;
    var text = name + '｜学校で使える Web アプリ';
    if (navigator.share) {
      navigator.share({ title: name, text: text, url: url }).catch(function () { /* 取り消しは無視 */ });
      return;
    }
    var intent = 'https://x.com/intent/post?text=' + encodeURIComponent(text)
      + '&url=' + encodeURIComponent(url);
    window.open(intent, '_blank', 'noopener,noreferrer,width=600,height=560');
  });

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
  /* 絞り込みは 2 本立て。教科・分野（data-cat）と、つかいかた（data-use）。
     2 つは掛け合わせで効く（例：国語 × みんなでやる） */
  var catChips = Array.prototype.slice.call(finder.querySelectorAll('.chip[data-cat]'));
  var useChips = Array.prototype.slice.call(finder.querySelectorAll('.chip[data-use]'));
  var status = finder.querySelector('[data-status]');
  var resetBtn = document.querySelector('[data-reset]');
  var forgetBtn = finder.querySelector('[data-forget]');

  /* ---------- かな → ローマ字 ----------
     「sakubun」でも作文が引けるようにする。ヘボン式と訓令式で綴りが割れる音
     （し・つ・ち・ふ・じ など）は、両方の綴りを検索用の文字列に入れておく。 */
  var ROMAJI = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
    カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
    サ: 'sa', シ: 'shi|si', ス: 'su', セ: 'se', ソ: 'so',
    タ: 'ta', チ: 'chi|ti', ツ: 'tsu|tu', テ: 'te', ト: 'to',
    ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
    ハ: 'ha', ヒ: 'hi', フ: 'fu|hu', ヘ: 'he', ホ: 'ho',
    マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
    ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
    ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
    ワ: 'wa', ヲ: 'o', ン: 'n',
    ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
    ザ: 'za', ジ: 'ji|zi', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
    ダ: 'da', ヂ: 'ji|di', ヅ: 'zu|du', デ: 'de', ド: 'do',
    バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
    パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
    キャ: 'kya', キュ: 'kyu', キョ: 'kyo',
    シャ: 'sha|sya', シュ: 'shu|syu', ショ: 'sho|syo',
    チャ: 'cha|tya', チュ: 'chu|tyu', チョ: 'cho|tyo',
    ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
    ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
    ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
    リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
    ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
    ジャ: 'ja|zya', ジュ: 'ju|zyu', ジョ: 'jo|zyo',
    ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
    ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo'
  };

  function toRomaji(kana, variant) {
    var out = '', i = 0, pending = '';
    while (i < kana.length) {
      var two = kana.slice(i, i + 2);
      var one = kana[i];
      var hit = ROMAJI[two] ? (i += 2, ROMAJI[two]) : ROMAJI[one] ? (i += 1, ROMAJI[one]) : null;
      if (hit === null) {
        if (one === 'ッ') { pending = 'sokuon'; i += 1; continue; }
        if (one === 'ー') { i += 1; continue; }        // 長音は落として綴りを短くする
        out += one; i += 1; continue;
      }
      var parts = hit.split('|');
      var syl = parts[Math.min(variant, parts.length - 1)];
      if (pending === 'sokuon') { out += syl[0]; pending = ''; }
      out += syl;
    }
    return out;
  }

  /* かなの並びだけを取り出してローマ字にする */
  function romajiOf(text) {
    var words = text.match(/[ァ-ヶー]+/g);
    if (!words) return '';
    var seen = {};
    words.forEach(function (w) {
      seen[toRomaji(w, 0)] = 1;
      seen[toRomaji(w, 1)] = 1;
    });
    return Object.keys(seen).join(' ');
  }

  /* 検索対象の文字列をあらかじめ作っておく（名前・説明・カテゴリ・ローマ字） */
  var index = cards.map(function (card) {
    var base = normalize([
      card.dataset.name || '',
      card.dataset.keywords || '',
      card.textContent || ''
    ].join(' '));
    return {
      el: card,
      cat: card.dataset.cat || '',
      /* 1 枚が 2 つのつかいかたを持つことがある（例：みっけ！＝調べる・みんなでやる） */
      use: (card.dataset.use || '').split(' ').filter(Boolean),
      text: base + ' ' + romajiOf(base)
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

  var state = { q: '', cat: 'all', use: 'all', sort: 'name' };

  var canAnimateMove = typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function';

  /* ---------- 最近開いたもの ----------
     「開く」を押したアプリを端末の中だけに覚えておき、並び替えの選択肢にする。
     外へは何も送らない。保存できない設定でも、選択肢が出ないだけで他は動く。 */
  var RECENT_KEY = 'giga-school:recent';
  var RECENT_LIMIT = 8;
  var recentRank = {};

  function recentList() {
    try {
      var list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    } catch (e) { return []; }
  }

  /* 記録があるときだけ、並び順の選択肢と「記録を消す」を出す */
  function refreshRecent() {
    var list = recentList();
    recentRank = {};
    list.forEach(function (slug, i) { recentRank[slug] = i; });
    var recentOption = sortSelect && sortSelect.querySelector('[data-recent]');
    if (recentOption) recentOption.hidden = list.length === 0;
    if (forgetBtn) forgetBtn.hidden = list.length === 0;
    return list.length > 0;
  }

  function remember(slug) {
    if (!slug) return;
    var list = recentList().filter(function (s) { return s !== slug; });
    list.unshift(slug);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
    } catch (e) { /* 保存できなくても動く */ }
  }

  /* アプリを開いたときに控える。カード全体が題のリンクになっているので、
     どこを押しても同じところを通る。 */
  list.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var link = e.target.closest('.card__title a, .card__open');
    if (!link) return;
    var card = e.target.closest('.card');
    if (card) remember(card.dataset.slug);
  });

  /* ---------- 並び替え ----------
     もとの並び（名前順）を控えておき、そこから組み替える。 */
  var sortSelect = finder.querySelector('[data-sort]');
  var originalOrder = cards.slice();

  var SORTS = {
    name: function (a, b) {
      return (a.dataset.name || '').localeCompare(b.dataset.name || '', 'ja');
    },
    new: function (a, b) {
      return (b.dataset.published || '').localeCompare(a.dataset.published || '')
        || SORTS.name(a, b);
    },
    updated: function (a, b) {
      return (b.dataset.updated || '').localeCompare(a.dataset.updated || '')
        || SORTS.name(a, b);
    },
    /* 記録に無いものは後ろへ。記録どうしは新しく開いた順 */
    recent: function (a, b) {
      var ra = recentRank[a.dataset.slug];
      var rb = recentRank[b.dataset.slug];
      if (ra === undefined && rb === undefined) return SORTS.name(a, b);
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    }
  };

  function reorder() {
    var order = originalOrder.slice().sort(SORTS[state.sort] || SORTS.name);
    /* 並びが変わらないなら、要素を動かさない（余計な再描画を避ける） */
    var same = order.every(function (el, i) { return list.children[i] === el; });
    if (same) return;
    var frag = document.createDocumentFragment();
    order.forEach(function (el) { frag.appendChild(el); });
    list.appendChild(frag);
  }

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
      var okUse = state.use === 'all' || item.use.indexOf(state.use) !== -1;
      var okText = terms.every(function (t) { return item.text.indexOf(t) !== -1; });
      var visible = okCat && okUse && okText;
      item.el.hidden = !visible;
      if (visible) shown++;
    });

    reorder();

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
      if (state.use !== 'all') params.set('use', state.use);
      if (state.q) params.set('q', input ? input.value.trim() : state.q);
      if (state.sort !== 'name') params.set('sort', state.sort);
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

  /* 同じ系統の中では 1 つだけ選べる。系統をまたぐと掛け合わせになる */
  function bindChips(group, key) {
    group.forEach(function (chip) {
      chip.addEventListener('click', function () {
        state[key] = chip.dataset[key] || 'all';
        group.forEach(function (c) {
          c.setAttribute('aria-pressed', String(c === chip));
        });
        apply(true);
      });
    });
  }
  bindChips(catChips, 'cat');
  bindChips(useChips, 'use');

  function pressChips(group, key, value) {
    group.forEach(function (c) {
      c.setAttribute('aria-pressed', String((c.dataset[key] || 'all') === value));
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (input) input.value = '';
      state = { q: '', cat: 'all', use: 'all', sort: state.sort };
      pressChips(catChips, 'cat', 'all');
      pressChips(useChips, 'use', 'all');
      apply(true);
    });
  }

  if (forgetBtn) {
    forgetBtn.addEventListener('click', function () {
      try { localStorage.removeItem(RECENT_KEY); } catch (e) { /* 消せなくても続ける */ }
      if (state.sort === 'recent') {
        state.sort = 'name';
        if (sortSelect) sortSelect.value = 'name';
      }
      refreshRecent();
      apply(true);
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      state.sort = SORTS[sortSelect.value] ? sortSelect.value : 'name';
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
    var use = params.get('use');
    var q = params.get('q');
    var sort = params.get('sort');
    if (q && input) { input.value = q; state.q = normalize(q); }
    if (sort && SORTS[sort]) {
      state.sort = sort;
      if (sortSelect) sortSelect.value = sort;
    }
    /* 記録が無ければ「最近開いた順」は選べない。URL に書かれていても名前順に戻す */
    if (!refreshRecent() && state.sort === 'recent') {
      state.sort = 'name';
      if (sortSelect) sortSelect.value = 'name';
    }
    if (cat && catChips.some(function (c) { return c.dataset.cat === cat; })) {
      state.cat = cat;
      pressChips(catChips, 'cat', cat);
    }
    if (use && useChips.some(function (c) { return c.dataset.use === use; })) {
      state.use = use;
      pressChips(useChips, 'use', use);
    }
    apply(false);
  })();
})();
