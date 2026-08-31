/* 夜明けのクエストログ — Service Worker
   方針：自分のファイルは「まずネットを見に行く」。
   だからサイトを更新すれば次に開いたとき必ず新しくなる。
   電波がないときだけキャッシュを出すので、オフラインでも開ける。 */

const CACHE = "celestia-v1";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(req, res) {
  if (res && res.ok && res.type !== "opaque") {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // ネット優先。失敗したらキャッシュ、それも無ければトップページ。
    e.respondWith(
      fetch(req)
        .then(res => store(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
  } else {
    // フォントなど外部のものは中身が変わらないのでキャッシュ優先。
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => store(req, res)))
    );
  }
});
