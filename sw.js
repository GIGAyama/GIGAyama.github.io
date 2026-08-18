/* =============================================================
   giga-school.com — オフラインでも開けるようにする

   ・HTML は「まずネットワーク、だめなら控え」。中身が古いまま残らない。
   ・CSS・JS・画像は「まず控え、裏で取り直す」。二度目からは速い。
   ・サムネイルは数が多いので、控えの数に上限を設ける。
   ・別のドメイン（各アプリ）へは一切手を出さない。
   ============================================================= */

const VERSION = 'v1';
const SHELL = `giga-school-shell-${VERSION}`;   // 骨組み（毎回使うもの）
const RUNTIME = `giga-school-media-${VERSION}`; // 画像など、使った分だけためるもの
const MEDIA_LIMIT = 140;                        // ためこむ画像の上限

const SHELL_FILES = [
  '/',
  '/index.html',
  '/404.html',
  '/assets/style.css',
  '/assets/app.js',
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
      .filter((k) => k.startsWith('giga-school-') && k !== SHELL && k !== RUNTIME)
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

  /* ページそのもの：まずネットワーク。つながらないときだけ控えを出す */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match(req)) || (await caches.match('/index.html'))
          || new Response('オフラインです', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  const isMedia = url.pathname.startsWith('/assets/thumbs/');
  const isShell = SHELL_FILES.includes(url.pathname);
  if (!isMedia && !isShell) return;

  /* まず控え、裏で取り直す */
  event.respondWith((async () => {
    const cacheName = isMedia ? RUNTIME : SHELL;
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone());
        if (isMedia) trim(RUNTIME, MEDIA_LIMIT);
      }
      return res;
    }).catch(() => null);
    return hit || (await network) || new Response('', { status: 504 });
  })());
});
