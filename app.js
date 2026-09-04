"use strict";
const LS = "questlog.v1";
const STATE_CACHE = "celestia-state";   // 通知係と共有する置き場（sw.js も同じ名前を使う）
const STATE_KEY = "state.json";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, "0");
const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
/* キャラクターは全ユーザー共通で固定。ユーザーが変えられるのは自分の呼ばれ方だけ。 */
const CHARA = "セレスティア";
/* キャラの絵。ファイルを置いたらここにパスを入れる（例："icons/celestia.png"）。
   空のあいだは「セ」の仮枠が出る。 */
const CHARA_IMG = "";

/* ---------- state ---------- */
function seed() {
  return {
    v: 2,
    chara: { level: 1, exp: 0 },
    user: "",
    missions: [
      wakeMission(uid(), WAKE_DEFAULT)
    ],
    goals: [],
    events: {}, log: {}, theme: "auto", notify: false
  };
}
/* 保存データを今の形にそろえる。古い版から来たものも、手で書きかえられたものも
   ここを通る。中身は捨てずに、型だけを直す。ここで数値・日付・時刻をきちんと
   絞っておくことが、描画側が変なものを掴まない一番の守りになる。 */
/* 早起きミッションは4つの時刻からえらぶ。EXPは時刻で決まり、早いほど多い。
   タイトル・曜日・時間のしばりも時刻から自動で決まるので、保存時に組み立てる。 */
const WAKE = [
  { time: "06:00", exp: 30 },
  { time: "07:00", exp: 25 },
  { time: "08:00", exp: 20 },
  { time: "09:00", exp: 15 }
];
const WAKE_DEFAULT = "07:00";
const wakeAt = t => WAKE.find(w => w.time === t) || WAKE.find(w => w.time === WAKE_DEFAULT);
const wakeHour = t => +t.split(":")[0];
const wakeTitle = t => wakeHour(t) + "時に起きる";
/* 早起きの形にそろえた1件を作る */
function wakeMission(id, time) {
  const w = wakeAt(time);
  return { id: id, type: "wake", title: wakeTitle(w.time), exp: w.exp,
           days: [0,1,2,3,4,5,6], mode: "before", time: w.time };
}

const asStr = v => (typeof v === "string" ? v : "");
const asNum = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const asArr = v => (Array.isArray(v) ? v : []);
const asObj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const asDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const asTime = v => (/^\d{2}:\d{2}$/.test(v) ? v : "");
const asStamp = v => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : "");   // 通知の日時

function normalize(o) {
  o = asObj(o);
  const c = asObj(o.chara);   // 名前と絵はもう持たないので作り直す
  o.chara = {
    level: Math.max(1, Math.floor(asNum(c.level, 1))),
    exp: Math.max(0, Math.floor(asNum(c.exp, 0)))
  };
  o.user = asStr(o.user).slice(0, 40);
  o.say = asStr(o.say);                      // 直前に言ったセリフ
  const sd = asObj(o.said); o.said = {};     // 場面ごとに、最後に出した日
  Object.keys(sd).forEach(k => { if (typeof sd[k] === "string") o.said[k] = sd[k]; });
  o.theme = ["auto", "dark", "light"].indexOf(o.theme) >= 0 ? o.theme : "auto";

  o.missions = asArr(o.missions).map(x => {
    const m = asObj(x);
    // 早起きは中身をすべて時刻から作り直す。手で書きかえられてもずれない
    if (m.type === "wake") return wakeMission(asStr(m.id) || uid(), asStr(m.time));
    const mode = (m.mode === "before" || m.mode === "after") ? m.mode : "";
    return {
      id: asStr(m.id) || uid(),
      type: "free",
      title: asStr(m.title),
      exp: Math.max(0, Math.floor(asNum(m.exp, 10))),
      days: asArr(m.days).map(d => Math.floor(asNum(d, -1))).filter(d => d >= 0 && d <= 6),
      mode: mode,
      time: mode ? asTime(m.time) : ""
    };
  });

  // 早起きは固定ミッション。無ければ足し、増えていたら最初の1つに寄せる
  const wakes = o.missions.filter(m => m.type === "wake");
  o.missions = [wakes[0] || wakeMission(uid(), WAKE_DEFAULT)]
    .concat(o.missions.filter(m => m.type !== "wake"));

  o.goals = asArr(o.goals).map(x => {
    const g = asObj(x);
    return {
      id: asStr(g.id) || uid(),
      title: asStr(g.title),
      due: asDate(g.due),
      done: !!g.done,
      doneAt: asDate(g.doneAt),
      steps: asArr(g.steps).map(y => {
        const s = asObj(y);
        return { id: asStr(s.id) || uid(), title: asStr(s.title), done: !!s.done };
      })
    };
  });

  const ev = asObj(o.events); o.events = {};
  Object.keys(ev).forEach(k => {
    const list = asArr(ev[k]).map(y => {
      const e = asObj(y);
      return { id: asStr(e.id) || uid(), title: asStr(e.title),
               time: asTime(e.time), end: asTime(e.end), notify: asStamp(e.notify) };
    });
    if (list.length) o.events[k] = list;
  });

  const lg = asObj(o.log); o.log = {};
  Object.keys(lg).forEach(k => {
    const list = asArr(lg[k]).filter(x => typeof x === "string");
    if (list.length) o.log[k] = list;
  });

  o.notify = !!o.notify;      // 通知を使うか（端末の許可とは別に、こちらでも持つ）
  o.v = 2;
  delete o.todos; delete o.help;
  return o;
}

let st;
try {
  const raw = localStorage.getItem(LS);
  st = raw ? JSON.parse(raw) : seed();
} catch (e) { st = seed(); }
if (!st || !st.chara) st = seed();
st = normalize(st);

/* 通知係（sw.js）はアプリが閉じていても動くので、localStorage を読めない。
   そこで「予定・レベル・呼び名」だけを、両方から読める置き場に写しておく。
   写すのは今日から先の予定だけ。ここにある名前は端末の外へは出さない。 */
async function mirror() {
  if (!("caches" in window)) return;
  try {
    const today = keyOf(new Date()), days = {};
    Object.keys(st.events).forEach(k => { if (k >= today) days[k] = st.events[k]; });
    const box = await caches.open(STATE_CACHE);
    await box.put(STATE_KEY, new Response(JSON.stringify({
      level: st.chara.level, user: st.user, events: days
    }), { headers: { "content-type": "application/json" } }));
  } catch (e) { /* 写せなくても本体は動く */ }
}

let saveWarned = false;
function save() {
  mirror();
  pingsLater();
  try { localStorage.setItem(LS, JSON.stringify(st)); }
  catch (e) {
    if (!saveWarned) { saveWarned = true; setMsg("保存できませんでした。端末の空き容量を確認してください。", true); }
  }
}
function setMsg(t, bad) {
  const m = $("#setMsg"); if (!m) return;
  m.textContent = t; m.style.color = bad ? "var(--bad)" : "var(--ok)";
  clearTimeout(setMsg.t); setMsg.t = setTimeout(() => { m.textContent = ""; }, 3200);
}

/* ---------- level ---------- */
const need = lv => 50 + (lv - 1) * 25;
function rankOf(lv) {
  if (lv >= 50) return "熾天使";
  if (lv >= 35) return "大天使";
  if (lv >= 25) return "権天使";
  if (lv >= 18) return "力天使";
  if (lv >= 12) return "守護天使";
  if (lv >= 6) return "翼を得し者";
  return "見習い天使";
}
function addExp(n) {
  const c = st.chara; c.exp += n; let up = 0;
  while (c.exp >= need(c.level)) { c.exp -= need(c.level); c.level++; up++; }
  while (c.exp < 0 && c.level > 1) { c.level--; c.exp += need(c.level); }
  if (c.exp < 0) c.exp = 0;
  if (up > 0) levelUp();
}
let luTimer = null;
function levelUp() {
  $("#luNum").textContent = st.chara.level;
  $("#luSub").textContent = callName(st.chara.level) + "、おめでとう ／ " + rankOf(st.chara.level);
  const el = $("#levelup"); el.classList.add("on");
  clearTimeout(luTimer); luTimer = setTimeout(() => el.classList.remove("on"), 1900);
}

/* ---------- mission helpers ---------- */
const doneOn = (id, k) => (st.log[k] || []).includes(id);
/* 通知が使える状態か。端末の許可と、設定画面のトグルの両方が要る。 */
const notifyOK = () => typeof Notification !== "undefined" && "serviceWorker" in navigator;
const canNotify = () => notifyOK() && Notification.permission === "granted" && !!st.notify;
const stampOf = d => keyOf(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
/* 通知をいつ出すか。決めてあればその時刻。
   決めていなければ、始まりの1時間前／始まりが無ければ前の日の昼12時。 */
function notifyAt(k, e) {
  if (e.notify) return e.notify;
  const [y, m, d] = k.split("-").map(Number);
  if (e.time) return stampOf(new Date(y, m - 1, d, +e.time.slice(0, 2) - 1, +e.time.slice(3)));
  return stampOf(new Date(y, m - 1, d - 1, 12, 0));
}
/* 通知の日時の見せかた。「9/29 12:00」 */
const stampText = v => (+v.slice(5, 7)) + "/" + (+v.slice(8, 10)) + " " + v.slice(11);

/* 予定の時刻の見せかた。「9:00〜10:00」／片方だけなら「9:00〜」「〜10:00」／
   どちらも空なら何も出さない。 */
const evSpan = e => (e.time || e.end) ? (e.time + "〜" + e.end) : "";
/* 並べる順は始まる時刻。決めていない予定はうしろへ。 */
const evKey = e => e.time || e.end || "99";
function toggleDone(id, k, on) {
  const arr = st.log[k] || (st.log[k] = []);
  const i = arr.indexOf(id);
  if (on && i < 0) arr.push(id);
  if (!on && i >= 0) arr.splice(i, 1);
  if (!arr.length) delete st.log[k];
}
const CLAIM_FROM = 5 * 60;   // 早起きミッションの受け取りは朝5時から
const hm = s => (+s.split(":")[0]) * 60 + (+s.split(":")[1]);

/* 長方形ボタンの状態を決める。
   done = 受け取り済み ／ ready = いま受け取れる ／ late = 時間切れ ／ lock = まだ受け取れない */
function claimState(m, now, otherDay) {
  if (doneOn(m.id, keyOf(now))) return "done";
  if (otherDay) return "lock";
  const cur = now.getHours() * 60 + now.getMinutes();
  if (m.mode === "before" && m.time) {
    if (cur >= hm(m.time)) return "late";              // 指定時刻を過ぎた
    if (m.type !== "wake") return "ready";             // 朝5時のしばりは早起きだけ
    return cur >= CLAIM_FROM ? "ready" : "lock";       // 早起きは朝5時から
  }
  if (m.mode === "after" && m.time) {
    return cur >= hm(m.time) ? "ready" : "lock";
  }
  return "ready";   // 時間のしばりが無いものは、やったかどうかを自己申告で受け取る
}
const CLAIM_LABEL = { done: "受け取り済み", ready: "報酬を受け取る", late: "時間切れ", lock: "未クリア" };
function streakOf(m) {
  const d = new Date();
  if (!doneOn(m.id, keyOf(d))) d.setDate(d.getDate() - 1);
  let s = 0;
  for (let i = 0; i < 400; i++) {
    if (m.days.includes(d.getDay())) {
      if (doneOn(m.id, keyOf(d))) s++; else break;
    }
    d.setDate(d.getDate() - 1);
  }
  return s;
}
function daysLabel(m) {
  if (m.days.length === 7) return "毎日";
  if (m.days.length === 5 && [1,2,3,4,5].every(x => m.days.includes(x))) return "平日";
  if (m.days.length === 2 && m.days.includes(0) && m.days.includes(6)) return "週末";
  if (!m.days.length) return "曜日なし";
  return m.days.slice().sort().map(x => DOW[x]).join("・");
}
const sortKey = m => (m.mode && m.time ? m.time : "99:99");

/* ---------- 祝日 ---------- */
/* 国民の祝日・振替休日・国民の休日を出す。外部データは使わない。
   春分と秋分は近似式で、1980〜2099年のあいだは実際の暦と一致する。
   2020・2021年の五輪にともなう臨時の移動は入れていない。 */
const holCache = {};
function holidaysOf(y) {
  if (holCache[y]) return holCache[y];
  const h = {}, key = (m, d) => m + "-" + d;
  const put = (m, d, name) => { h[key(m, d)] = name; };
  const nthMon = (m, n) => 1 + ((8 - new Date(y, m - 1, 1).getDay()) % 7) + (n - 1) * 7;
  const eq = (a) => Math.floor(a + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  put(1, 1, "元日");
  put(1, nthMon(1, 2), "成人の日");
  put(2, 11, "建国記念の日");
  put(2, 23, "天皇誕生日");
  put(3, eq(20.8431), "春分の日");
  put(4, 29, "昭和の日");
  put(5, 3, "憲法記念日");
  put(5, 4, "みどりの日");
  put(5, 5, "こどもの日");
  put(7, nthMon(7, 3), "海の日");
  put(8, 11, "山の日");
  put(9, nthMon(9, 3), "敬老の日");
  put(9, eq(23.2488), "秋分の日");
  put(10, nthMon(10, 2), "スポーツの日");
  put(11, 3, "文化の日");
  put(11, 23, "勤労感謝の日");

  const base = Object.assign({}, h);
  const each = fn => {
    const d = new Date(y, 0, 1);
    while (d.getFullYear() === y) { fn(d); d.setDate(d.getDate() + 1); }
  };
  // 国民の休日：祝日にはさまれた平日（9月の敬老の日と秋分の日のあいだなど）
  each(d => {
    const m = d.getMonth() + 1, dd = d.getDate();
    if (base[key(m, dd)] || d.getDay() === 0) return;
    const p = new Date(y, d.getMonth(), dd - 1), n = new Date(y, d.getMonth(), dd + 1);
    if (base[key(p.getMonth() + 1, p.getDate())] && base[key(n.getMonth() + 1, n.getDate())])
      put(m, dd, "国民の休日");
  });
  // 振替休日：日曜と重なった祝日のぶんを、次に空いている日へ送る
  const sub = [];
  each(d => {
    if (d.getDay() !== 0 || !h[key(d.getMonth() + 1, d.getDate())]) return;
    const n = new Date(y, d.getMonth(), d.getDate() + 1);
    while (h[key(n.getMonth() + 1, n.getDate())]) n.setDate(n.getDate() + 1);
    if (n.getFullYear() === y) sub.push([n.getMonth() + 1, n.getDate()]);
  });
  sub.forEach(x => put(x[0], x[1], "振替休日"));

  holCache[y] = h;
  return h;
}
const holidayName = d => holidaysOf(d.getFullYear())[(d.getMonth() + 1) + "-" + d.getDate()] || "";

/* ---------- セリフ ---------- */
/* レベル＝親密度。上がるほど呼び方と口調がやわらぐ。
   区切りは rankOf のランクの境目にそろえてある。
     0: Lv1-5   見習い天使            「お前」・ぶっきらぼう
     1: Lv6-17  翼を得し者／守護天使  「あんた」・少し丸い
     2: Lv18-34 力天使／権天使        名前で呼ぶ・素直
     3: Lv35-   大天使／熾天使        「ご主人様」・丁寧
   文面を変えたいときは下の SPEECH だけ直せばよい。{you} は呼び方、{n} は残りの数。 */
/* 段階と呼び方の決まりは notify-lines.js に置いてある。
   通知（アプリが閉じていても出る）と同じものを使いたいので、そちらを本家にした。 */
function toneOf(lv) { return NOTIFY.tone(lv); }
function callName(lv) { return NOTIFY.you(lv, st.user); }
/* しゃべる場面。押した瞬間に出るものと、アプリを開いたときに出るものがある。
   開いたときに出るものは「その日はじめて条件を満たしたとき」に一度だけ。
   重なった日は、この並びの上にあるものだけが出る（並べ替えれば優先順が変わる）。 */
const OPEN_SCENES = [
  "wakeLate",   // 2 早起きが時間切れになってから、はじめて開いた
  "night",      // 4 21時〜0時に、はじめて開いた
  "midnight",   // 5 1時〜5時に、はじめて開いた
  "holiday"     // 7 土日・祝日に、はじめて開いた
];

/* セリフ表。口調4段階 × 場面。
   ・各場面は配列。いくつ足してもよく、その中から1つがランダムに選ばれる
   ・{you} は呼び方（お前／あんた／名前／ご主人様）、{n} は残りの数に置きかわる
   ・場面のキー
       first        はじめてアプリを開いたとき（1度だけ）
       wakeClaim    1 早起きの報酬を受け取った
       missionClaim 3 早起き以外の報酬を受け取った
       goalDone     6 目標を達成した
       wakeLate     2 早起きが時間切れ
       night        4 夜（21時〜0時）
       midnight     5 夜中（1時〜5時）
       holiday      7 土日・祝日
       more         受け取りのセリフの後ろに足す（残りがあるときだけ） */
const SPEECH = [
  { /* 0 見習い天使（Lv1-5）：お前・ぶっきらぼう */
    first:        ["……お前が私の主人か。まあいい、精々励め。",
                   "ふん。私はセレスティア。お前のことは、まだ何も知らない。"],
    wakeClaim:    ["ふん。今日はやったようだな。",
                   "ほう、起きられたのか。……まあ、悪くない。"],
    missionClaim: ["それくらいはできて当然だろう。",
                   "ふん。持っていけ。"],
    goalDone:     ["やり遂げたのか。……お前にしては上出来だ。",
                   "ふん。まぐれではないと、証明してみせろ。"],
    wakeLate:     ["また寝坊か。{you}に期待した私がばかだった。",
                   "……もう間に合わん。明日はどうする気だ。"],
    night:        ["今日はもう終わりだ。明日は起きろよ、{you}。",
                   "夜だぞ。さっさと寝る支度をしろ。"],
    midnight:     ["{you}、まだ起きているのか。いいかげんにしろ。",
                   "こんな時間まで何をしている。寝ろ。"],
    holiday:      ["今日は休みか。だからといって、だらけるなよ。",
                   "休みだろうと朝は来る。分かっているな、{you}。"],
    more:         ["あと{n}つ残ってるぞ。"] },

  { /* 1 翼を得し者・守護天使（Lv6-17）：あんた・少し丸い */
    first:        ["……ふうん。あんたが、私の主人ね。"],
    wakeClaim:    ["今日も起きられたのね。……悪くないわ。",
                   "おはよう。ほら、受け取っていきなさい。"],
    missionClaim: ["ちゃんとやったのね。えらいじゃない。",
                   "……まあ、こんなものかしら。はい、どうぞ。"],
    goalDone:     ["やり切ったのね。ちょっと、見直したわ。",
                   "……お疲れさま。今日はゆっくりしなさい。"],
    wakeLate:     ["寝坊ね。まあ、{you}にしては頑張ってるほうかしら。",
                   "間に合わなかったのね。……明日があるわ。"],
    night:        ["おやすみ、{you}。明日はちゃんと起きるのよ。",
                   "もう夜ね。そろそろ休みなさい。"],
    midnight:     ["{you}、こんな時間まで起きてるの。体を壊すわよ。",
                   "夜更かしはだめ。ほら、画面を閉じて。"],
    holiday:      ["今日はお休みね。たまにはゆっくりしたら。",
                   "休みだからって、朝寝坊は別の話よ。"],
    more:         ["あと{n}つ残ってるわよ。"] },

  { /* 2 力天使・権天使（Lv18-34）：名前で呼ぶ・素直 */
    first:        ["{you}。これからよろしくね。"],
    wakeClaim:    ["{you}、今日もちゃんと起きられたね。えらい。",
                   "{you}、おはよう。今日も会えてうれしい。"],
    missionClaim: ["{you}、よくやったね。",
                   "きちんと続けてるね。……すごいと思う。"],
    goalDone:     ["{you}、やったね。ずっと見てたよ。",
                   "達成おめでとう。私も、うれしい。"],
    wakeLate:     ["{you}、おはよう。……まあ、そんな日もあるよ。",
                   "間に合わなかったね。無理はしないで。"],
    night:        ["{you}、こんばんは。明日の朝、待ってるね。",
                   "そろそろ休んで。おやすみ、{you}。"],
    midnight:     ["{you}、まだ起きてるの？ 早く休んで。",
                   "こんな時間まで……。心配になるよ。"],
    holiday:      ["今日はお休みだね。{you}、何をして過ごすの？",
                   "休みの日でも会いに来てくれるんだ。うれしい。"],
    more:         ["あと{n}つ受け取れるよ。"] },

  { /* 3 大天使・熾天使（Lv35-）：ご主人様・丁寧 */
    first:        ["{you}。この身、あなたに捧げます。"],
    wakeClaim:    ["{you}、今朝もご立派でした。",
                   "{you}、おはようございます。報酬をお受け取りください。"],
    missionClaim: ["{you}、見事でございます。",
                   "さすがでございます。どうぞ、お納めください。"],
    goalDone:     ["{you}、成し遂げられましたね。心よりお祝い申し上げます。",
                   "あなたの歩みを、ずっと見ておりました。おめでとうございます。"],
    wakeLate:     ["{you}、おはようございます。お疲れが出たのでしょう。",
                   "今朝は間に合いませんでしたね。どうかお気になさらず。"],
    night:        ["{you}、こんばんは。また明日の朝、お待ちしております。",
                   "{you}、そろそろお休みください。"],
    midnight:     ["{you}、まだ起きていらしたのですか。どうかお休みください。",
                   "こんな時間まで……。お体に障ります。"],
    holiday:      ["{you}、今日はお休みでございますね。ごゆるりとお過ごしください。",
                   "お休みの日にもお会いできて、光栄でございます。"],
    more:         ["あと{n}つ、お受け取りいただけます。"] }
];

/* いま条件を満たしていて、その日まだ出していない場面を、優先順に並べて返す。 */
function scenesDue(now) {
  const w = st.missions.find(m => m.type === "wake");
  const h = now.getHours(), dow = now.getDay();
  const due = {
    wakeLate: !!w && claimState(w, now, false) === "late",
    night:    h >= 21,               // 21時〜0時
    midnight: h >= 1 && h < 5,       // 1時〜5時
    holiday:  dow === 0 || dow === 6 || !!holidayName(now)
  };
  const today = keyOf(now);
  return OPEN_SCENES.filter(k => due[k] && st.said[k] !== today);
}
/* セリフを1つ選んで覚える。次の場面が来るまでこれが出つづける。 */
function say(scene, now, tail) {
  const lv = st.chara.level;
  const list = SPEECH[toneOf(lv)][scene];
  if (!list || !list.length) return;
  let line = list[Math.floor(Math.random() * list.length)] + (tail || "");
  st.say = line.replace(/\{you\}/g, callName(lv));
  st.said[scene] = keyOf(now);
  save();
}
/* 受け取りのセリフに足す「あと◯つ」。残っていなければ空。 */
function moreTail(now) {
  const left = st.missions
    .filter(m => m.days.includes(now.getDay()))
    .filter(m => claimState(m, now, false) === "ready").length;
  if (!left) return "";
  const l = SPEECH[toneOf(st.chara.level)].more;
  if (!l || !l.length) return "";
  return l[Math.floor(Math.random() * l.length)].replace("{n}", left);
}
/* アプリを開いたとき・時間がまたいだときに呼ぶ。 */
function updateSpeech(now) {
  const today = keyOf(now);
  // はじめての起動。いま条件を満たしている場面も一緒に消化して、
  // あいさつが直後に上書きされないようにする
  if (!st.say) {
    say("first", now);
    scenesDue(now).forEach(k => { st.said[k] = today; });
    save();
    return;
  }
  const due = scenesDue(now);
  if (!due.length) return;
  say(due[0], now);
  // 同時に重なっていた下位の場面も、その日はもう出さない
  due.forEach(k => { st.said[k] = today; });
  save();
}

/* ---------- render ---------- */
function render() {
  const now = new Date(), tk = keyOf(now);
  $("#topdate").textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日（" + DOW[now.getDay()] + "）";

  // hero
  const c = st.chara;
  $("#cname").textContent = CHARA;
  $("#rank").textContent = rankOf(c.level);
  $("#lvnum").textContent = c.level;
  const nd = need(c.level);
  const C = 2 * Math.PI * 47;
  const p = Math.max(0, Math.min(1, c.exp / nd));
  // 輪は大（パネルの中）と小（ホーム右上）のふたつ。どちらも同じ値で動かす
  $$(".rfill").forEach(r => {
    r.setAttribute("stroke-dasharray", C.toFixed(1));
    r.setAttribute("stroke-dashoffset", (C * (1 - p)).toFixed(1));
  });
  $("#minilv").textContent = c.level;
  // 棘は、輪の光が自分の位置を通りすぎたぶんだけ金色になる（レベルが上がればまた消える）
  $$(".spikes path").forEach(sp => sp.classList.toggle("on", p >= +sp.dataset.at));
  $("#expnow").textContent = c.exp + " / " + nd + " EXP";
  $("#expneed").textContent = "次のレベルまで あと " + (nd - c.exp);

  // キャラの絵とセリフ
  $("#portrait").innerHTML = CHARA_IMG
    ? '<img src="' + esc(CHARA_IMG) + '" alt="' + CHARA + '">'
    : '<span class="rune">' + CHARA[0] + "</span>";
  $("#speech").textContent = st.say;
  // today's missions
  const todays = st.missions.filter(m => m.days.includes(now.getDay()))
    .sort((a, b) => (a.type === "wake" ? 0 : 1) - (b.type === "wake" ? 0 : 1) ||
      sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, "ja"));
  const doneCount = todays.filter(m => doneOn(m.id, tk)).length;
  $("#s-done").textContent = doneCount;
  $("#s-left").textContent = todays.length - doneCount;
  $("#s-fire").textContent = st.missions.reduce((a, m) => Math.max(a, streakOf(m)), 0);

  const ml = $("#missionList");
  ml.innerHTML = todays.length
    ? todays.map(m => missionRow(m, tk, now)).join("")
    : '<div class="empty">今日のミッションはありません。<br>「＋ 追加」から作れます。</div>';
  ml.style.display = "flex"; ml.style.flexDirection = "column"; ml.style.gap = "9px";

  const others = st.missions.filter(m => !m.days.includes(now.getDay()));
  const ol = $("#otherMissions");
  ol.parentElement.hidden = others.length === 0;
  ol.innerHTML = others.map(m => missionRow(m, tk, now, true)).join("");
  ol.style.display = "flex"; ol.style.flexDirection = "column"; ol.style.gap = "9px";

  // today's events
  const ev = (st.events[tk] || []).slice().sort((a, b) => evKey(a).localeCompare(evKey(b)));
  $("#todayEventsSec").hidden = ev.length === 0;
  $("#todayEvents").innerHTML = ev.map(e =>
    '<div class="row"><div class="rowbody"><div class="rowtitle">' + esc(e.title) + '</div>' +
    (evSpan(e) ? '<div class="chips"><span class="chip time">' + esc(evSpan(e)) + "</span></div>" : "") +
    "</div></div>").join("");
  $("#todayEvents").style.display = "flex"; $("#todayEvents").style.flexDirection = "column"; $("#todayEvents").style.gap = "9px";

  renderGoals();
  renderCal();
  if ($("#userName").value !== st.user) $("#userName").value = st.user;
  if (document.activeElement !== $("#backup")) $("#backup").value = JSON.stringify(st);
}

function missionRow(m, tk, now, dim) {
  const cs = claimState(m, now, dim);
  const s = streakOf(m);
  const chips = [];
  chips.push('<span class="chip">' + esc(daysLabel(m)) + "</span>");
  if (m.mode && m.time) {
    const lab = m.mode === "before" ? "〜" + m.time + " まで" : m.time + " から";
    chips.push('<span class="chip ' + (cs === "late" ? "late" : "time") + '">' + esc(lab) + "</span>");
  }
  if (s > 1) chips.push('<span class="chip fire">' + s + "日れんぞく</span>");

  // 受け取れる状態と受け取り済みは、枠を緑にする
  const cls = "row" + (cs === "ready" || cs === "done" ? " clear" : "") + (dim ? " locked" : "");
  return '<div class="' + cls + '" data-m="' + esc(m.id) + '">' +
    '<button class="edit" data-act="edit" data-id="' + esc(m.id) + '" aria-label="編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button>' +
    '<div class="rowbody"><div class="rowtitle">' + esc(m.title) + "</div>" +
    '<div class="chips">' + chips.join("") + "</div></div>" +
    '<span class="expbadge">EXP+' + esc(m.exp) + "</span>" +
    '<button class="claim ' + cs + '" data-act="claim" data-id="' + esc(m.id) + '">' +
    CLAIM_LABEL[cs] + "</button>" +
    "</div>";
}

/* ---------- goals ---------- */
/* 期限までの残り日数。今日なら0、過ぎていればマイナス。 */
function daysLeft(due) {
  const p = due.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(p[0], p[1] - 1, p[2]) - t) / 86400000);
}
function dueChip(g) {
  if (!g.due) return "";
  const p = g.due.split("-").map(Number);
  const lab = p[1] + "月" + p[2] + "日";
  if (g.done) return '<span class="chip">期限 ' + lab + "</span>";
  const n = daysLeft(g.due);
  if (n < 0) return '<span class="chip late">' + lab + "・" + (-n) + "日すぎた</span>";
  if (n === 0) return '<span class="chip late">' + lab + "・きょうが期限</span>";
  return '<span class="chip time">' + lab + "・あと" + n + "日</span>";
}
function goalCard(g) {
  const total = g.steps.length, dn = g.steps.filter(x => x.done).length;
  const ratio = total ? dn / total : 0;
  const chips = [];
  if (total) chips.push('<span class="chip">ステップ ' + dn + " / " + total + "</span>");
  const dc = dueChip(g); if (dc) chips.push(dc);
  if (g.done) chips.push('<span class="chip ok">達成</span>');
  const ready = !g.done && total > 0 && dn === total;
  const steps = g.steps.map(x =>
    '<button class="gstep' + (x.done ? " on" : "") + '" data-act="gstep" data-id="' + esc(g.id) + '" data-s="' + esc(x.id) + '">' +
    '<span class="gbox"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
    '<span class="gtxt">' + esc(x.title) + "</span></button>").join("");
  return '<div class="goal' + (g.done ? " done" : "") + '">' +
    '<div class="goalhead"><div class="goaltitle">' + esc(g.title) + "</div>" +
    '<button class="edit" data-act="gedit" data-id="' + esc(g.id) + '" aria-label="編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button></div>' +
    (chips.length ? '<div class="chips">' + chips.join("") + "</div>" : "") +
    (total ? '<div class="track"><div class="fill" style="width:' + Math.round(ratio * 100) + '%"></div></div>' : "") +
    (total ? '<div class="gsteps">' + steps + "</div>" : "") +
    '<button class="gfin' + (ready ? " ready" : "") + '" data-act="gdone" data-id="' + esc(g.id) + '">' +
    (g.done ? "やっぱり続ける" : "達成にする") + "</button></div>";
}
/* 期限のあるものを先に、近い順。期限なしは後ろ。 */
const goalOrder = (a, b) =>
  (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due || "").localeCompare(b.due || "") || a.title.localeCompare(b.title, "ja");

function renderGoals() {
  const open = st.goals.filter(g => !g.done).sort(goalOrder);
  const done = st.goals.filter(g => g.done);
  const o = $("#goalList"), d = $("#goalDone");
  o.innerHTML = open.length ? open.map(goalCard).join("")
    : '<div class="empty">長期目標はまだありません。<br>「＋ 追加」から、時間のかかる目標を書いてみましょう。</div>';
  d.innerHTML = done.map(goalCard).join("");
  $("#goalDoneSec").hidden = done.length === 0;
  [o, d].forEach(x => { x.style.display = "flex"; x.style.flexDirection = "column"; x.style.gap = "10px"; });
}

let calY, calM;
(function () { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); })();
function renderCal() {
  $("#calmon").textContent = calY + "年 " + (calM + 1) + "月";
  $("#dowRow").innerHTML = DOW.map((d, i) =>
    '<div class="dow ' + (i === 0 ? "sun" : i === 6 ? "sat" : "") + '">' + d + "</div>").join("");
  const first = new Date(calY, calM, 1), last = new Date(calY, calM + 1, 0);
  const tk = keyOf(new Date());
  let html = "";
  for (let i = 0; i < first.getDay(); i++) html += '<div class="cell pad"></div>';
  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(calY, calM, day), k = keyOf(d);
    const sched = st.missions.filter(m => m.days.includes(d.getDay()));
    const doneN = sched.filter(m => doneOn(m.id, k)).length;
    const ratio = sched.length ? doneN / sched.length : 0;
    const hasEv = (st.events[k] || []).length > 0;
    const hasGoal = st.goals.some(g => !g.done && g.due === k);
    // 日曜と祝日は赤、土曜は青。今日はこの上から金色になる。
    const dw = d.getDay();
    const dc = (dw === 0 || holidayName(d)) ? " sun" : dw === 6 ? " sat" : "";
    html += '<button class="cell' + (k === tk ? " now" : "") + '" data-act="day" data-k="' + k + '">' +
      '<span class="d' + dc + '">' + day + "</span>" +
      (hasEv || hasGoal ? '<span class="dots">' +
        (hasEv ? '<span class="dot"></span>' : "") +
        (hasGoal ? '<span class="dot due"></span>' : "") + "</span>" : "") +
      (doneN ? '<span class="mini"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>' : "") +
      "</button>";
  }
  // 月によって行数が変わると下のヘルプボタンが動くので、いつも6行（42マス）にそろえる
  for (let i = first.getDay() + last.getDate(); i < 42; i++) html += '<div class="cell pad"></div>';
  $("#calGrid").innerHTML = html;
}

/* ---------- sheets ---------- */
function openSheet(id) { $("#scrim").classList.add("on"); $(id).classList.add("on"); }
/* 1枚だけ閉じる。ミッションを保存したときに、その下のステータス画面まで
   一緒に閉じてしまわないように、閉じるのは自分の分だけにする。 */
function closeSheet(id) {
  $(id).classList.remove("on");
  $("#scrim").classList.toggle("on", $$(".sheet.on").length > 0);
}
function closeSheets() {                       // 全部たたむ（タブを移ったときなど）
  $("#scrim").classList.remove("on");
  $$(".sheet").forEach(x => x.classList.remove("on"));
}
/* シートの外を押したら閉じる。閉じるのはいちばん手前の1枚だけなので、
   ステータス画面の上でミッションを編集していても、後ろまでは消えない。
   つかまえるのは capture（降りてくる途中）。この時点ではまだ押した先の処理が
   走っていないので、「開くための一押し」で開いたそばから閉じることがない。
   閉じるときはその一押しをここで止める。うしろのボタンまで押されないように。 */
document.addEventListener("click", e => {
  const top = $(".sheet.on:not(.side)") || $(".sheet.on");   // 下から出るシートのほうが手前
  if (!top || e.target.closest(".pop,.popveil")) return;
  if (e.target.closest(".sheet") === top) return;            // 中を押したときは閉じない
  e.stopPropagation(); e.preventDefault();
  closeSheet("#" + top.id);
}, true);
/* 右上の小さいゲージ＝レベルとミッションの入口 */
$("#openStatus").addEventListener("click", () => openSheet("#sheetS"));
$("#sClose").addEventListener("click", () => closeSheet("#sheetS"));

/* mission editor */
let editing = null, draft = null;
$("#mDays").innerHTML = DOW.map((d, i) => '<button class="day" data-d="' + i + '">' + d + "</button>").join("");
$("#mWakeTime").innerHTML = WAKE.map(w =>
  '<button class="pill" data-t="' + w.time + '">' + wakeHour(w.time) +
  '時<span class="pexp">EXP+' + w.exp + "</span></button>").join("");

function paintDraft() {
  const wake = draft.type === "wake";
  $("#mWake").hidden = !wake;
  $("#mFree").hidden = wake;
  if (wake) {
    draft.wakeTime = wakeAt(draft.wakeTime).time;
    $$("#mWakeTime .pill").forEach(p => p.classList.toggle("on", p.dataset.t === draft.wakeTime));
    return;
  }
  $("#mName").value = draft.title;
  $$("#mExp .pill").forEach(p => p.classList.toggle("on", +p.dataset.e === draft.exp));
  $$("#mDays .day").forEach(p => p.classList.toggle("on", draft.days.includes(+p.dataset.d)));
  $$("#mMode .pill").forEach(p => p.classList.toggle("on", p.dataset.m === (draft.mode || "")));
  $("#mTimeRow").hidden = !draft.mode;
  $("#mTime").value = draft.time || "07:00";
}
function openMission(m) {
  editing = m ? m.id : null;
  // 追加でつくれるのは自由ミッションだけ。早起きは固定で、時刻の変更だけできる
  draft = m
    ? { type: m.type, title: m.title, exp: m.exp, days: m.days.slice(),
        mode: m.mode || "", time: m.time || "",
        wakeTime: m.type === "wake" ? m.time : WAKE_DEFAULT }
    : { type: "free", title: "", exp: 20, days: [0,1,2,3,4,5,6],
        mode: "", time: "", wakeTime: WAKE_DEFAULT };
  $("#mTitle").textContent = m
    ? (m.type === "wake" ? "早起きミッションを編集" : "ミッションを編集")
    : "ミッションを追加";
  $("#mDelete").hidden = !m || m.type === "wake";   // 早起きは消せない
  paintDraft(); openSheet("#sheetM");
}
$("#mWakeTime").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b) return;
  draft.wakeTime = b.dataset.t; paintDraft();
});
$("#addMission").addEventListener("click", () => openMission(null));
$("#mExp").addEventListener("click", e => { const b = e.target.closest(".pill"); if (!b) return; draft.exp = +b.dataset.e; paintDraft(); });
$("#mDays").addEventListener("click", e => {
  const b = e.target.closest(".day"); if (!b) return;
  const d = +b.dataset.d, i = draft.days.indexOf(d);
  if (i < 0) draft.days.push(d); else draft.days.splice(i, 1);
  paintDraft();
});
$("#mMode").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b) return;
  draft.mode = b.dataset.m; if (draft.mode && !draft.time) draft.time = "07:00";
  paintDraft();
});
$("#mTime").addEventListener("change", e => { draft.time = e.target.value; });
$("#mName").addEventListener("input", e => { draft.title = e.target.value; });
$("#mCancel").addEventListener("click", () => closeSheet("#sheetM"));
$("#mSave").addEventListener("click", () => {
  let data;
  if (draft.type === "wake") {
    data = wakeMission(null, draft.wakeTime);
    delete data.id;
  } else {
    const t = draft.title.trim();
    if (!t) { $("#mName").focus(); return; }
    if (!draft.days.length) draft.days = [0,1,2,3,4,5,6];
    data = { type: "free", title: t, exp: draft.exp, days: draft.days,
             mode: draft.mode, time: draft.mode ? draft.time : "" };
  }
  if (editing) Object.assign(st.missions.find(x => x.id === editing), data);
  else st.missions.push(Object.assign({ id: uid() }, data));
  save(); render(); closeSheet("#sheetM");
});
let delArm = false;
$("#mDelete").addEventListener("click", e => {
  if (!delArm) { delArm = true; e.target.textContent = "もう一度おすと消えます"; setTimeout(() => { delArm = false; e.target.textContent = "このミッションを消す"; }, 3000); return; }
  const target = st.missions.find(m => m.id === editing);
  if (target && target.type === "wake") { closeSheet("#sheetM"); return; }   // 早起きは消せない
  st.missions = st.missions.filter(m => m.id !== editing);
  Object.keys(st.log).forEach(k => { st.log[k] = st.log[k].filter(id => id !== editing); if (!st.log[k].length) delete st.log[k]; });
  delArm = false; e.target.textContent = "このミッションを消す";
  save(); render(); closeSheet("#sheetM");
});

/* 確認の小窓。消す前に一度だけ止める。中身を差しかえて他でも使える。 */
let confirmFn = null;
function askConfirm(title, name, fn) {
  $("#cTitle").textContent = title;
  $("#cName").textContent = name;
  confirmFn = fn;
  openSheet("#sheetC");
}
$("#cNo").addEventListener("click", () => closeSheet("#sheetC"));
$("#cYes").addEventListener("click", () => {
  const fn = confirmFn; confirmFn = null;
  closeSheet("#sheetC");
  if (fn) fn();
});

/* day sheet */
let dayKey = null, dEditing = null;   // dEditing は編集中の予定の id（追加のときは null）
function openDay(k) {
  dayKey = k;
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  $("#dTitle").textContent = m + "月" + d + "日（" + DOW[dt.getDay()] + "）";
  clearDayForm();
  paintDay();
  openSheet("#sheetD");
}
/* 入力欄をまっさらに戻す（＝追加のモードに戻す） */
function clearDayForm() {
  dEditing = null;
  $("#dEvName").value = ""; $("#dEvTime").value = ""; $("#dEvEnd").value = "";
  $("#dNotifyDate").value = ""; $("#dNotifyTime").value = "";
  $("#dEvAdd").textContent = "予定を追加";
  $("#dEvCancel").hidden = true;
}
/* その予定を入力欄に写して、編集のモードにする */
function editEvent(id) {
  const e = (st.events[dayKey] || []).find(x => x.id === id); if (!e) return;
  dEditing = id;
  $("#dEvName").value = e.title;
  $("#dEvTime").value = e.time; $("#dEvEnd").value = e.end;
  $("#dNotifyDate").value = e.notify ? e.notify.slice(0, 10) : "";
  $("#dNotifyTime").value = e.notify ? e.notify.slice(11) : "";
  $("#dEvAdd").textContent = "保存する";
  $("#dEvCancel").hidden = false;
  paintDay();
  $("#dEvName").focus();
}
function paintDay() {
  const k = dayKey;
  // 通知時間は、設定画面で通知をオンにするまでさわれない
  const ok = canNotify();
  $("#dNotifyDate").disabled = $("#dNotifyTime").disabled = !ok;
  $("#dNotifyOff").hidden = ok;

  const ev = (st.events[k] || []).slice().sort((a, b) => evKey(a).localeCompare(evKey(b)));
  $("#dEvents").innerHTML = ev.length ? ev.map(e =>
    '<div class="row' + (e.id === dEditing ? " editing" : "") + '">' +
    '<button class="edit" data-act="evedit" data-id="' + esc(e.id) + '" aria-label="この予定を編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button>' +
    '<div class="rowbody"><div class="rowtitle">' + esc(e.title) + "</div>" +
    (evSpan(e) || e.notify ? '<div class="chips">' +
      (evSpan(e) ? '<span class="chip time">' + esc(evSpan(e)) + "</span>" : "") +
      (e.notify ? '<span class="chip">通知 ' + esc(stampText(e.notify)) + "</span>" : "") +
      "</div>" : "") + "</div>" +
    '<button class="del" data-act="evdel" data-id="' + esc(e.id) + '" aria-label="削除"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg></button></div>'
  ).join("") : '<div class="empty">予定なし</div>';

  const gd = st.goals.filter(g => g.due === k);
  $("#dGoalsWrap").hidden = gd.length === 0;
  $("#dGoals").innerHTML = gd.map(g =>
    '<div class="row' + (g.done ? " done" : "") + '"><div class="rowbody">' +
    '<div class="rowtitle">' + esc(g.title) + "</div>" +
    '<div class="chips"><span class="chip ' + (g.done ? "ok" : "time") + '">' +
    (g.done ? "達成ずみ" : "この日が期限") + "</span></div></div></div>").join("");
}
$("#dEvAdd").addEventListener("click", () => {
  const t = $("#dEvName").value.trim(); if (!t) return;
  // 通知時間は、日か時刻のどちらかだけでも通す。
  // 日が空なら予定の日、時刻が空なら昼12時。どちらも空なら「決めていない」。
  const nd = $("#dNotifyDate").value, nt = $("#dNotifyTime").value;
  const notify = canNotify() && (nd || nt) ? (nd || dayKey) + "T" + (nt || "12:00") : "";
  const data = { title: t, time: $("#dEvTime").value, end: $("#dEvEnd").value, notify: notify };
  const list = st.events[dayKey] || (st.events[dayKey] = []);
  const target = dEditing && list.find(x => x.id === dEditing);
  if (target) Object.assign(target, data);            // 編集中なら上書き
  else list.push(Object.assign({ id: uid() }, data)); // そうでなければ足す
  clearDayForm();
  save(); paintDay(); renderCal(); render();
});
$("#dEvCancel").addEventListener("click", () => { clearDayForm(); paintDay(); });
$("#dClose").addEventListener("click", () => closeSheet("#sheetD"));
$("#dEvents").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === "evedit") { editEvent(id); return; }
  if (b.dataset.act !== "evdel") return;
  const ev = (st.events[dayKey] || []).find(x => x.id === id); if (!ev) return;
  askConfirm("この予定を消しますか", ev.title, () => {
    st.events[dayKey] = (st.events[dayKey] || []).filter(x => x.id !== id);
    if (!st.events[dayKey].length) delete st.events[dayKey];
    if (dEditing === id) clearDayForm();   // 編集中のものを消したら、入力欄も戻す
    save(); paintDay(); renderCal(); render();
  });
});

/* 指で右へなぞって閉じる。
   始まりが画面の左半分のときだけ受けつける（右半分は消すボタンなどを触るため）。
   なぞっている間は画面が指について動き、ある程度まで行ったらそのまま閉じる。
   足りなければ元の位置へ戻る。縦に振ったときは、いつもどおり中身が上下する。 */
$$(".sheet.side").forEach(el => {
  const SLOP = 12;     // これだけ動いてから、縦なぞりか横なぞりかを決める
  const CLOSE = 70;    // これだけ右へ行ったら閉じる
  let touch = null, x0 = 0, y0 = 0, dx = 0, way = "";

  el.addEventListener("touchstart", e => {
    if (touch !== null || e.touches.length !== 1) return;
    const t = e.touches[0], r = el.getBoundingClientRect();
    if (t.clientX > r.left + r.width / 2) return;      // 左半分から始めたときだけ
    touch = t.identifier; x0 = t.clientX; y0 = t.clientY; dx = 0; way = "";
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    if (touch === null) return;
    const t = Array.prototype.find.call(e.touches, x => x.identifier === touch);
    if (!t) return;
    const ax = t.clientX - x0, ay = t.clientY - y0;
    if (!way) {
      if (Math.abs(ax) < SLOP && Math.abs(ay) < SLOP) return;
      way = Math.abs(ax) > Math.abs(ay) ? "yoko" : "tate";
      if (way === "yoko") el.style.transition = "none";
    }
    if (way !== "yoko") return;
    dx = Math.max(0, ax);                              // 右へだけ動かす
    el.style.transform = "translateX(" + dx + "px)";
    if (e.cancelable) e.preventDefault();              // 横に動かしている間は上下させない
  }, { passive: false });

  const release = commit => {
    if (touch === null) return;
    const shut = commit && way === "yoko" && dx > CLOSE;
    touch = null; way = ""; dx = 0;
    el.style.transition = ""; el.style.transform = "";  // ここから先は CSS のすべりに任せる
    if (shut) closeSheet("#" + el.id);
  };
  el.addEventListener("touchend", () => release(true));
  // 端末に横取りされた（電話が来たなど）ときは、閉じずに元へ戻す
  el.addEventListener("touchcancel", () => release(false));
});

/* ---------- global clicks ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "claim") {
    const m = st.missions.find(x => x.id === id); if (!m) return;
    const now = new Date();
    if (claimState(m, now, !m.days.includes(now.getDay())) !== "ready") { flash(b); return; }
    toggleDone(m.id, keyOf(now), true); addExp(m.exp);   // 受け取ったら取り消せない
    say(m.type === "wake" ? "wakeClaim" : "missionClaim", now, moreTail(now));
    save(); render();
  }
  if (act === "edit") { const m = st.missions.find(x => x.id === id); if (m) openMission(m); }
  if (act === "gstep") {
    const g = st.goals.find(x => x.id === id); if (!g) return;
    const x = g.steps.find(y => y.id === b.dataset.s); if (!x) return;
    x.done = !x.done; save(); render();
  }
  if (act === "gedit") { const g = st.goals.find(x => x.id === id); if (g) openGoal(g); }
  if (act === "gdone") {
    const g = st.goals.find(x => x.id === id); if (!g) return;
    g.done = !g.done; g.doneAt = g.done ? keyOf(new Date()) : "";
    if (g.done) say("goalDone", new Date());
    save(); render();
  }
  if (act === "day") { openDay(b.dataset.k); }
  if (act === "help") {
    if (popFor === b) closePop(); else openPop(b);
  }
});
function flash(el) {
  const row = el.closest(".row"); if (!row) return;
  row.animate([{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }], { duration: 260 });
}

/* ---------- help popover ---------- */
/* 説明はその場で開かず、最前面の小窓に出す。
   基本はボタンの上。上に入りきらないときだけ下に回す。 */
let popFor = null;
const POP_EDGE = 12;   // 画面の端からあけておく余白
const POP_GAP = 9;     // ボタンとの間隔

function openPop(btn) {
  const src = document.getElementById(btn.dataset.help); if (!src) return;
  const body = $("#popBody");
  body.innerHTML = src.innerHTML;
  // 複製した中身の id は落とす。元の要素と重複させないため。
  body.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  $("#pop").hidden = false; $("#popVeil").hidden = false;
  if (popFor) markPop(popFor, false);
  popFor = btn; markPop(btn, true);
  placePop();
}
function closePop() {
  if (!popFor) return;
  markPop(popFor, false); popFor = null;
  $("#pop").hidden = true; $("#popVeil").hidden = true;
}
function markPop(btn, on) {
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-expanded", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "説明をかくす" : "説明を見る");
}
function placePop() {
  if (!popFor) return;
  const pop = $("#pop"), r = popFor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;

  // 上下の限界は、ヘッダーと下タブの実際の位置から取る（iPhoneのノッチぶん高さが変わるため）。
  const lim = {
    top: $(".top").getBoundingClientRect().bottom + 6,
    bottom: $(".nav").getBoundingClientRect().top - 6
  };
  // ボタンがヘッダーの裏や下タブの裏へ流れていったら閉じる
  if (r.bottom < lim.top || r.top > lim.bottom) { closePop(); return; }

  // 幅を測る前に左端へ戻す。右寄りのままだと折り返し幅が変わって測り間違える。
  pop.style.maxWidth = Math.min(320, vw - POP_EDGE * 2) + "px";
  pop.style.left = "0px";
  const w = pop.offsetWidth, h = pop.offsetHeight;

  // 横：ボタンの中心にそろえ、はみ出すぶんだけ画面内へ寄せる
  const left = Math.max(POP_EDGE, Math.min(r.left + r.width / 2 - w / 2, vw - POP_EDGE - w));
  // 縦：上に入るなら上、入らなければ下
  const above = r.top - POP_GAP - h >= lim.top;

  pop.style.left = left + "px";
  pop.style.top = Math.max(lim.top, Math.min(
    above ? r.top - POP_GAP - h : r.bottom + POP_GAP, lim.bottom - h)) + "px";
  pop.classList.toggle("below", !above);
  // 矢印はボタンの真ん中を指す
  $("#popArrow").style.left =
    Math.max(13, Math.min(r.left + r.width / 2 - left, w - 13)) + "px";
}
$("#popVeil").addEventListener("click", closePop);
document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
window.addEventListener("resize", placePop);
window.addEventListener("scroll", placePop, true);

/* ---------- ヘッダーの高さ ---------- */
/* ヘッダーは画面の上に貼り付けてあるので、その下にあける余白は main が受けもつ。
   ノッチや字体の読みこみで高さが変わるため、決め打ちにせず実際に測って渡す。 */
function measureTop() {
  document.documentElement.style.setProperty("--toph", $(".top").offsetHeight + "px");
}
if (window.ResizeObserver) new ResizeObserver(measureTop).observe($(".top"));
else {
  window.addEventListener("resize", measureTop);
  if (document.fonts) document.fonts.ready.then(measureTop).catch(() => {});
}
measureTop();

/* ---------- tabs ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.toggle("on", x === t));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
  closePop();
  window.scrollTo(0, 0);
  closeSheets();                                        // 開きっぱなしのパネルはたたむ
  if (t.dataset.v === "set") { $("#backup").value = JSON.stringify(st); paintNotify(); }
}));
$("#prevM").addEventListener("click", () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(); });
$("#nextM").addEventListener("click", () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCal(); });

/* ---------- goal editor ---------- */
let gediting = null, gdraft = null;
function paintGDue() {
  const on = !!gdraft.due;
  $$("#gDueMode .pill").forEach(p => p.classList.toggle("on", (p.dataset.u === "on") === on));
  $("#gDueRow").hidden = !on;
  $("#gDue").value = gdraft.due || "";
}
function paintGSteps() {
  $("#gSteps").innerHTML = gdraft.steps.length
    ? gdraft.steps.map((x, i) =>
        '<div class="gerow"><input class="field" data-i="' + i + '" placeholder="ステップ" value="' + esc(x.title) + '">' +
        '<button class="del" data-sd="' + i + '" aria-label="このステップを消す"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg></button></div>').join("")
    : '<div class="note" style="padding:2px 2px 0">ステップは無くてもかまいません。</div>';
}
function openGoal(g) {
  gediting = g ? g.id : null;
  gdraft = g
    ? { title: g.title, due: g.due || "", steps: g.steps.map(x => ({ id: x.id, title: x.title, done: x.done })) }
    : { title: "", due: "", steps: [{ id: uid(), title: "", done: false }] };
  $("#gHead").textContent = g ? "目標を編集" : "目標を追加";
  $("#gName").value = gdraft.title;
  $("#gDelete").hidden = !g;
  paintGDue(); paintGSteps(); openSheet("#sheetG");
}
$("#addGoal").addEventListener("click", () => openGoal(null));
$("#gDueMode").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b) return;
  if (b.dataset.u === "on") {
    if (!gdraft.due) {
      const d = new Date(); d.setDate(d.getDate() + 30);
      gdraft.due = keyOf(d);
    }
  } else gdraft.due = "";
  paintGDue();
});
$("#gDue").addEventListener("change", e => { gdraft.due = e.target.value; });
$("#gSteps").addEventListener("input", e => {
  const i = e.target.dataset.i; if (i === undefined) return;
  gdraft.steps[+i].title = e.target.value;
});
$("#gSteps").addEventListener("click", e => {
  const b = e.target.closest("[data-sd]"); if (!b) return;
  gdraft.steps.splice(+b.dataset.sd, 1); paintGSteps();
});
$("#gAddStep").addEventListener("click", () => {
  gdraft.steps.push({ id: uid(), title: "", done: false });
  paintGSteps();
  const ins = $$("#gSteps input"); if (ins.length) ins[ins.length - 1].focus();
});
$("#gCancel").addEventListener("click", () => closeSheet("#sheetG"));
$("#gSave").addEventListener("click", () => {
  const t = $("#gName").value.trim();
  if (!t) { $("#gName").focus(); return; }
  const steps = gdraft.steps
    .map(x => ({ id: x.id, title: x.title.trim(), done: !!x.done }))
    .filter(x => x.title);
  if (gediting) {
    const g = st.goals.find(x => x.id === gediting);
    Object.assign(g, { title: t, due: gdraft.due, steps: steps });
  } else {
    st.goals.unshift({ id: uid(), title: t, due: gdraft.due, steps: steps, done: false, doneAt: "" });
  }
  save(); render(); closeSheet("#sheetG");
});
let gDelArm = false;
$("#gDelete").addEventListener("click", e => {
  if (!gDelArm) {
    gDelArm = true; e.target.textContent = "もう一度おすと消えます";
    setTimeout(() => { gDelArm = false; e.target.textContent = "この目標を消す"; }, 3000);
    return;
  }
  st.goals = st.goals.filter(g => g.id !== gediting);
  gDelArm = false; e.target.textContent = "この目標を消す";
  save(); render(); closeSheet("#sheetG");
});

/* ---------- settings ---------- */
$("#userName").addEventListener("input", e => { st.user = e.target.value; save(); });
$("#copyBk").addEventListener("click", async () => {
  const t = $("#backup");
  try { await navigator.clipboard.writeText(t.value); setMsg("コピーしました"); }
  catch (e) { t.removeAttribute("readonly"); t.select(); t.setSelectionRange(0, 999999); setMsg("選択しました。長押しでコピーしてください"); t.setAttribute("readonly", ""); }
});
$("#showRestore").addEventListener("click", () => { const b = $("#restoreBox"); b.hidden = !b.hidden; });
$("#doRestore").addEventListener("click", () => {
  const keep = st;   // 失敗したときに戻すための控え
  try {
    const o = JSON.parse($("#restoreIn").value);
    if (!o || typeof o !== "object" || !o.chara) throw new Error("bad");
    st = normalize(o);
    render();          // 先に描いてみる。ここで落ちるなら保存しない
    save(); applyTheme();
    setMsg("読みこみました");
    $("#restoreIn").value = ""; $("#restoreBox").hidden = true;
  } catch (e) {
    st = keep;         // 元のデータはまだ保存領域にある。画面も戻す
    try { applyTheme(); render(); } catch (e2) {}
    setMsg("読みこめませんでした。文字が途中で切れていないか確認してください。", true);
  }
});
let wipeArm = false;
$("#wipe").addEventListener("click", e => {
  if (!wipeArm) { wipeArm = true; e.target.textContent = "本当に消す？ もう一度おす"; setTimeout(() => { wipeArm = false; e.target.textContent = "ぜんぶ消して最初から"; }, 3500); return; }
  st = seed(); wipeArm = false; e.target.textContent = "ぜんぶ消して最初から";
  save(); applyTheme(); render(); setMsg("最初にもどしました");
});

/* ---------- theme ---------- */
function applyTheme() {
  const t = st.theme || "auto";
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  $$("#themePills .pill").forEach(p => p.classList.toggle("on", p.dataset.t === t));
  let dark = t === "dark";
  if (t === "auto" && window.matchMedia) dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", dark ? "#0d1020" : "#f3f5fc");
}
/* ---------- 通知 ---------- */
/* いまできるのは「許可をもらう」「テストで1通出す」まで。
   予定にあわせて自動で届く仕組み（サーバー）は、このあと足す。
   iPhoneはホーム画面に追加したときだけ通知を出せる決まりなので、
   ブラウザのタブで開いているあいだはトグルを触れなくしておく。 */
const standalone = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
  window.navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);   // iPad は Mac を名乗る

function paintNotify() {
  const tog = $("#notifyTog"), lab = $("#notifyLab"), msg = $("#notifyMsg"), test = $("#notifyTest");
  const perm = notifyOK() ? Notification.permission : "unsupported";
  const on = canNotify();
  let stop = "";                                   // 触れない理由。空なら使える
  if (!notifyOK()) stop = "このブラウザでは通知を使えません。";
  else if (isIOS() && !standalone()) stop = "ホーム画面に追加したセレスティアから開くと使えます。";
  else if (perm === "denied") stop = "端末側で通知が切られています。iPhoneの「設定」アプリの通知から許可してください。";

  tog.disabled = !!stop;
  tog.setAttribute("aria-checked", on ? "true" : "false");
  lab.textContent = on ? "オン" : "オフ";
  msg.textContent = stop || (on
    ? "いまはテスト通知だけ出せます。予定にあわせた通知はこれから作ります。"
    : "オンにすると、端末が一度だけ許可をたずねます。");
  test.hidden = !on;
}
$("#notifyTog").addEventListener("click", async () => {
  if ($("#notifyTog").disabled) return;
  if (canNotify()) {                                   // オフにする
    st.notify = false; save(); paintNotify();
    pushOff().catch(() => {});
    return;
  }
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
  }
  if (perm !== "granted") { save(); paintNotify(); $("#notifyMsg").textContent = "通知は許可されませんでした。"; return; }
  st.notify = true; save(); paintNotify();
  $("#notifyMsg").textContent = "受付にとどけ出ています…";
  try {
    await pushOn();
    paintNotify();
  } catch (err) {
    st.notify = false; save(); paintNotify();
    // 何でしくじったかを、その場に出す。長い返事は途中まで。
    $("#notifyMsg").textContent = "受付できませんでした：" + String(err && err.message || err).slice(0, 300);
  }
});
/* 通知係（Service Worker）の支度ができるまで待つ。
   file: で開いたときなど、いつまでも支度ができない場合があるので、
   4秒で見切りをつけて「出せなかった」と伝える。 */
const swReady = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((ok, no) => setTimeout(() => no(new Error("まだ支度ができていません")), 4000))
]);
$("#notifyTest").addEventListener("click", async () => {
  try {
    const reg = await swReady();
    // 本番と同じ組み立てを通す。いまのレベルの口調で出る。
    const d = new Date(); d.setDate(d.getDate() + 1);
    const t = NOTIFY.make({ title: "テスト通知", time: "15:00", day: keyOf(d) },
                          keyOf(new Date()), st.chara.level, st.user);
    await reg.showNotification(t.title, { body: t.body, tag: "celestia-test", data: { url: "./" } });
  } catch (e) {
    setMsg("通知を出せませんでした。ホーム画面から開いているか確かめてください。", true);
  }
});

/* ---------- 通知のサーバー（Supabase） ---------- */
/* ここに書いてある鍵は「人目に触れてよい鍵」。表の読み出しはサーバー側の決まり（RLS）で
   全部止めてあるので、鍵を持っていても中身は取り出せない。
   サーバーに置くのは「いつ・どの番号の予定を叩くか」だけ。
   予定の名前もレベルも端末の中（sw.js が読む控え）にしか無い。 */
const SB_URL = "https://dtxrdhtseahscofxpzfh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0eHJkaHRzZWFoc2NvZnhwemZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzQ1NjksImV4cCI6MjEwNDAxMDU2OX0.bYNpgxHJczISeWGxbsDUsBU7jo5RRSS-yq5lvZM2lHk";
const VAPID_PUB = "BDOVCUeTSV8vTSKRl53tgj8HIJe5aeD6OopmwMPQoihw10hH2fXKOa4Z3jneUjIlaHDxU45NRTqQfoAQpqvn65s";
const SB_AUTH = "celestia.auth";   // 匿名の身分証のしまい場所

const b64pad = t => t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - t.length % 4) % 4);
const b64bytes = t => Uint8Array.from(atob(b64pad(t)), c => c.charCodeAt(0));
const uidOf = t => JSON.parse(atob(b64pad(t.split(".")[1]))).sub;   // 身分証に書かれている自分の番号

/* 匿名の身分証をとる。はじめの一度だけ作り、あとは期限が切れる前に更新する。
   名前もメールも要らない。「自分の行しか触れない」ための札でしかない。 */
async function sbToken() {
  let a = null;
  try { a = JSON.parse(localStorage.getItem(SB_AUTH) || "null"); } catch (e) { a = null; }
  const now = Math.floor(Date.now() / 1000);
  if (a && a.access_token && a.expires_at > now + 60) return a.access_token;

  const path = a && a.refresh_token ? "/auth/v1/token?grant_type=refresh_token" : "/auth/v1/signup";
  const body = a && a.refresh_token ? { refresh_token: a.refresh_token } : {};
  const res = await fetch(SB_URL + path, {
    method: "POST",
    headers: { apikey: SB_KEY, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    if (a) { localStorage.removeItem(SB_AUTH); return sbToken(); }   // 更新に失敗したら作り直す
    throw new Error("通知の受付にとどけ出られませんでした");
  }
  const j = await res.json();
  const keep = {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: now + (j.expires_in || 3600)
  };
  localStorage.setItem(SB_AUTH, JSON.stringify(keep));
  return keep.access_token;
}
/* 表に書く。読み出しは許していないので、返事は要らない（return=minimal）。 */
async function sbWrite(path, method, body, prefer) {
  const t = await sbToken();
  const res = await fetch(SB_URL + "/rest/v1/" + path, {
    method: method,
    headers: {
      apikey: SB_KEY, Authorization: "Bearer " + t, "content-type": "application/json",
      Prefer: "return=minimal" + (prefer ? "," + prefer : "")
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(method + " " + path + " → " + (await res.text()));
  return t;
}

/* 鳴らす予定を置き直す。送るのは番号・日付・時刻だけで、名前は送らない。
   過ぎたものは送らない。多すぎるときは近い順に200件まで。 */
async function syncPings() {
  const t = await sbToken(), owner = uidOf(t), now = Date.now(), rows = [];
  Object.keys(st.events).forEach(k => {
    st.events[k].forEach(e => {
      const at = new Date(notifyAt(k, e));      // 端末の時計で読む＝その土地の時刻
      if (at.getTime() > now) rows.push({ owner: owner, event_id: e.id, day_key: k, fire_at: at.toISOString() });
    });
  });
  rows.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
  await sbWrite("pings?owner=eq." + owner, "DELETE");
  if (rows.length) await sbWrite("pings", "POST", rows.slice(0, 200));
  return rows.length;
}
/* 保存のたびに呼ばれる。まとめて少し待ってから送る（打つたびに通信しないため）。 */
let pingTimer = null;
function pingsLater() {
  if (!canNotify()) return;
  clearTimeout(pingTimer);
  pingTimer = setTimeout(() => { syncPings().catch(() => {}); }, 2000);
}

/* 通知の宛先をサーバーに預ける（オンにしたとき） */
async function pushOn() {
  const reg = await swReady();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: b64bytes(VAPID_PUB)
    });
  }
  // 上書き（upsert）ではなく、消してから入れ直す。
  // 上書きは「今そこに何があるか」を読みにいくため、読み出しを許していないこの作りでは通らない。
  const t = await sbToken(), owner = uidOf(t);
  await sbWrite("devices?owner=eq." + owner, "DELETE");
  await sbWrite("devices", "POST",
    { owner: owner, sub: sub.toJSON(), updated_at: new Date().toISOString() });
  await syncPings();
}
/* 宛先も予定も引きあげる（オフにしたとき） */
async function pushOff() {
  try {
    const reg = await swReady();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* 宛先を消せなくても、下で予定は引きあげる */ }
  const t = await sbToken(), owner = uidOf(t);
  await sbWrite("pings?owner=eq." + owner, "DELETE");
  await sbWrite("devices?owner=eq." + owner, "DELETE");
}

$("#themePills").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b) return;
  st.theme = b.dataset.t; save(); applyTheme();
});
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { if ((st.theme || "auto") === "auto") applyTheme(); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

/* ---------- boot ---------- */
applyTheme();
mirror();
paintNotify();
if (canNotify()) syncPings().catch(() => {});
updateSpeech(new Date());
render();
let lastDay = keyOf(new Date());
setInterval(() => {
  const k = keyOf(new Date());
  if (k !== lastDay) { lastDay = k; const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); }
  updateSpeech(new Date());
  render();
}, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { updateSpeech(new Date()); render(); } });

/* ---------- service worker ---------- */
/* オフラインで開けるようにする。file: で直接開いたときは働かないので何もしない。 */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js")
    .then(reg => reg.update())
    .catch(() => {});
}
