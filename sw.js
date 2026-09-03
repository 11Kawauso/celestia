/* 夜明けのクエストログ — Service Worker
   方針：自分のファイルは「まずネットを見に行く」。
   だからサイトを更新すれば次に開いたとき必ず新しくなる。
   電波がないときだけキャッシュを出すので、オフラインでも開ける。 */

const CACHE = "celestia-v2";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
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

/* ---------- 通知 ---------- */
/* サーバーから届いたものを、そのまま出す。
   いまは title と body をそのまま使う形。あとで、この中で端末の中の予定と
   レベルを見て文面を組み立てる（そうすれば予定の名前を外に出さずに済む）。 */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "セレスティア", {
    body: d.body || "",
    tag: d.tag || "celestia",
    data: { url: d.url || "./" }
  }));
});

/* 通知を押したら、開いているアプリに戻す。無ければ開く。 */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});

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
