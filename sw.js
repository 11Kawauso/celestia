/* 夜明けのクエストログ — Service Worker
   方針：自分のファイルは「まずネットを見に行く」。
   だからサイトを更新すれば次に開いたとき必ず新しくなる。
   電波がないときだけキャッシュを出すので、オフラインでも開ける。 */

importScripts("./notify-lines.js");   // 通知の文面。アプリ本体と同じものを使う

const CACHE = "celestia-v2";
const STATE_CACHE = "celestia-state";   // アプリが写した予定とレベルの置き場（app.js と同じ名前）
const STATE_KEY = "state.json";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./notify-lines.js",
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
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== STATE_CACHE).map(k => caches.delete(k))
      ))
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
/* サーバーから届くのは「どの日の、どの予定か」だけ。
   予定の名前もレベルも端末の中（下の控え）から読むので、外には出ていかない。 */
async function stateNow() {
  try {
    const box = await caches.open(STATE_CACHE);
    const res = await box.match(STATE_KEY);
    return res ? await res.json() : null;
  } catch (e) { return null; }
}
async function buildNotice(d) {
  const st = await stateNow();
  const list = st && st.events && st.events[d.k];
  const ev = list && list.find(x => x.id === d.id);
  if (!ev) return { title: "セレスティア", body: "予定の時間だぞ。" };   // 控えが無いときの保険
  const today = new Date();
  const key = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
  return NOTIFY.make({ title: ev.title, time: ev.time, day: d.k }, key, st.level || 1, st.user || "");
}
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(
    buildNotice(d).then(t => self.registration.showNotification(t.title, {
      body: t.body,
      tag: "celestia-" + (d.id || "x"),
      data: { url: "./" }
    }))
  );
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
