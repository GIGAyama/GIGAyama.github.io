/* =============================================================
   giga-school.com — オフラインでも開けるようにする

   ・HTML と CSS・JS は「まずネットワーク、だめなら控え」。
   ・画像は「まず控え、裏で取り直す」。数が多く、同じ名前なら中身も変わらない。

   ⚠️ CSS・JS を「まず控え」にしてはいけない。
      以前そうしていたところ、更新した直後の 1 回目に
      「新しい HTML ＋ 古い CSS」の組み合わせが出て、画面が壊れた。
      実際、カードの紹介ボタンが押せずアプリが開く不具合になった
      （ボタンを前面に出す指定が古い CSS に無く、カード全体のリンクが上に来た）。
      HTML と一緒に変わるものは、HTML と同じ配り方にする。
   ・サムネイルは数が多いので、控えの数に上限を設ける。
   ・別のドメイン（各アプリ）へは一切手を出さない。
   ============================================================= */

const VERSION = 'v3';
const SHELL = `giga-school-shell-${VERSION}`;   // 骨組み（毎回使うもの）
const PAGES = `giga-school-pages-${VERSION}`;   // 開いたページ。アドレスごとに持つ
const RUNTIME = `giga-school-media-${VERSION}`; // 画像など、使った分だけためるもの
const PAGE_LIMIT = 40;                          // ためこむページの上限（紹介ページ 31 本＋余裕）
const MEDIA_LIMIT = 140;                        // ためこむ画像の上限

const SHELL_FILES = [
  '/',
  '/index.html',
  '/404.html',
  '/assets/style.css',
  '/assets/app.js',
  '/assets/article.js',
  '/assets/favicon.svg',
  '/assets/logo.svg',
  '/site.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* 1 つでも失敗したら全部だめ、にはしない */
    await Promise.allSettled(SHELL_FILES.map((f) => cache.add(new Request(f, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('giga-school-') && k !== SHELL && k !== PAGES && k !== RUNTIME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** 控えが増えすぎないよう、古いものから捨てる。 */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 各アプリのドメインには触らない

  /* ページそのもの：まずネットワーク。つながらないときだけ控えを出す。
     ⚠️ 控えは「開いたそのアドレス」で持つ。
        以前はどのページを開いても /index.html として保存していた。
        トップ 1 枚しかない間は同じことだったが、/apps/<slug>/ の紹介ページが
        増えたあとは、記事を開いたあとのトップが記事に化ける。 */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(PAGES);
          cache.put(req, fresh.clone());
          trim(PAGES, PAGE_LIMIT);
        }
        return fresh;
      } catch (e) {
        return (await caches.match(req))
          || (await caches.match('/index.html'))
          || new Response('オフラインです', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  const isMedia = url.pathname.startsWith('/assets/thumbs/');
  const isShell = SHELL_FILES.includes(url.pathname);
  if (!isMedia && !isShell) return;

  /* 画像：まず控え、裏で取り直す */
  if (isMedia) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) { cache.put(req, res.clone()); trim(RUNTIME, MEDIA_LIMIT); }
        return res;
      }).catch(() => null);
      return hit || (await network) || new Response('', { status: 504 });
    })());
    return;
  }

  /* CSS・JS：まずネットワーク。HTML と一緒に変わるものなので、
     古い控えを先に返すと、新しい HTML と食い違って画面が壊れる */
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return (await cache.match(req)) || new Response('', { status: 504 });
    }
  })());
});
