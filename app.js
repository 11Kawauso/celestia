"use strict";
const LS = "questlog.v1";
const STATE_CACHE = "celestia-state";   // 通知係と共有する置き場（sw.js も同じ名前を使う）
const STATE_KEY = "state.json";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, "0");
const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const dayOf = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };   // keyOf の逆
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
    goals: [], memo: [], pass: "", reminders: [],
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

  /* メモ。フォルダも中身も同じ1本の配列で持ち、parent でぶら下がりを表す。
     こうしておくと、あとで移動や入れ子を足すときに形を変えずに済む。 */
  let oldWord = "";                    // 昔の形（項目ごとのパスワード）から引き継ぐ用
  o.memo = asArr(o.memo).map(x => {
    const m = asObj(x);
    const w = asStr(m.lock);           // 昔の形。いまは項目ごとに持たない
    if (w && !oldWord) oldWord = w;
    return {
      id: asStr(m.id) || uid(),
      kind: ["folder", "note", "image"].includes(m.kind) ? m.kind : "note",
      name: asStr(m.name).slice(0, 120),
      body: asStr(m.body),
      parent: asStr(m.parent),
      at: asDate(m.at),
      hide: !!m.hide || !!w            // 隠すかどうか。パスワードはアプリに1つ（o.pass）
    };
  });
  // パスワードはアプリで1つ。昔の控えから来たときは、最初に見つけたものを引き継ぐ。
  o.pass = (asStr(o.pass) || oldWord).slice(0, 60);
  // 親が消えているものは、いちばん上に戻す（迷子を作らない）
  o.memo.forEach(m => { if (m.parent && !o.memo.some(x => x.kind === "folder" && x.id === m.parent)) m.parent = ""; });

  /* くりかえし通知。予定と違って日付を持たず、決まりだけを持つ。
     rule は "daily"（毎日）／"every"（n日おき、from が起点）／"week"（曜日えらび）。 */
  o.reminders = asArr(o.reminders).map(x => {
    const r = asObj(x);
    const rule = ["daily", "every", "week"].includes(r.rule) ? r.rule : "daily";
    let days = asArr(r.days).map(Number).filter(d => d >= 0 && d <= 6);
    if (rule === "week" && !days.length) days = [0, 1, 2, 3, 4, 5, 6];
    return {
      id: asStr(r.id) || uid(),
      title: asStr(r.title).slice(0, 60),
      time: asTime(r.time) || "08:00",
      rule: rule,
      n: Math.min(30, Math.max(2, Math.round(+r.n || 2))),   // 何日おきか（2〜30）
      from: asDate(r.from) || keyOf(new Date()),             // n日おきの起点
      days: days
    };
  }).filter(r => r.title);

  const ev = asObj(o.events); o.events = {};
  Object.keys(ev).forEach(k => {
    const list = asArr(ev[k]).map(y => {
      const e = asObj(y);
      return { id: asStr(e.id) || uid(), title: asStr(e.title),
               time: asTime(e.time), end: asTime(e.end), notify: asStamp(e.notify),
               important: !!e.important };   // 無ければ「ふつうの予定」になるので、古い控えもそのまま読める
    });
    if (list.length) o.events[k] = list;
  });

  const lg = asObj(o.log); o.log = {};
  Object.keys(lg).forEach(k => {
    const list = asArr(lg[k]).filter(x => typeof x === "string");
    if (list.length) o.log[k] = list;
  });

  /* 始めた日。記録タブの「◯日目」の起点。
     これを持っていない古いデータは、残っている記録のいちばん古い日を始めた日とみなす。 */
  const seen = Object.keys(o.log).concat(o.memo.map(m => m.at), o.goals.map(g => g.doneAt))
    .map(asDate).filter(Boolean);
  o.since = asDate(o.since) || seen.concat(keyOf(new Date())).sort()[0];

  o.notify = !!o.notify;      // 通知を使うか（端末の許可とは別に、こちらでも持つ）
  o.v = 2;
  delete o.todos; delete o.help;
  return o;
}

let st, keepOld = false;   // 読めない控えが残っているときは、こちらからは上書きしない
try {
  const raw = localStorage.getItem(LS);
  st = raw ? JSON.parse(raw) : seed();
  keepOld = !!raw && !(st && st.chara);
} catch (e) { st = seed(); keepOld = true; }
if (!st || !st.chara) st = seed();
const hadSince = !!asDate(st.since);
st = normalize(st);
// 始めた日は一度決めたら動かさない。決めたその場で書いておく
// （書かずにいると、何も触らない日が続くたびに「今日」へずれていく）
if (!hadSince && !keepOld) { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

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
      level: st.chara.level, user: st.user, events: days,
      // 通知の文面を作るのに要るぶんだけ
      reminders: st.reminders.map(r => ({ id: r.id, title: r.title, time: r.time }))
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
/* 短い知らせ。置き場所は画面ごとにあるので、出ているほうに書く。 */
function setMsg(t, bad) {
  const all = $$(".msg"); if (!all.length) return;
  all.forEach(m => { m.textContent = t; m.style.color = bad ? "var(--bad)" : "var(--ok)"; });
  clearTimeout(setMsg.t);
  setMsg.t = setTimeout(() => { all.forEach(m => { m.textContent = ""; }); }, 3200);
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
  renderMemo();
  renderRec();
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
  paintBackup();
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
    : '<div class="empty">長期目標はまだありません。</div>';
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
    // 点は色ごとに1行。青＝ふつうの予定、赤＝重要な予定、金＝長期目標の期限。
    // 2つ以上あるときだけ、点の横に数を出す。
    const evs = st.events[k] || [];
    const impN = evs.filter(e => e.important).length;
    const evN = evs.length - impN;
    const goalN = st.goals.filter(g => !g.done && g.due === k).length;
    const dotRow = (cls, n) => n ? '<span class="dotrow"><i class="dot ' + cls + '"></i>' +
      (n > 1 ? '<b class="dotnum">' + n + "</b>" : "") + "</span>" : "";
    const dots = dotRow("ev", evN) + dotRow("imp", impN) + dotRow("due", goalN);
    // 日曜と祝日は赤、土曜は青。今日はこの上から金色になる。
    const dw = d.getDay();
    const dc = (dw === 0 || holidayName(d)) ? " sun" : dw === 6 ? " sat" : "";
    html += '<button class="cell' + (k === tk ? " now" : "") + '" data-act="day" data-k="' + k + '">' +
      '<span class="d' + dc + '">' + day + "</span>" +
      (dots ? '<span class="dots">' + dots + "</span>" : "") +
      (doneN ? '<span class="mini"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>' : "") +
      "</button>";
  }
  // 月によって行数が変わると下のヘルプボタンが動くので、いつも6行（42マス）にそろえる
  for (let i = first.getDay() + last.getDate(); i < 42; i++) html += '<div class="cell pad"></div>';
  $("#calGrid").innerHTML = html;
}

/* ---------- 記録 ---------- */
/* 数字は「始めてから何日目」と「早起きの連続」。グラフは30日ぶんの達成数で、
   ‹ › で1週ずつ前後へ送れる。recOff は、今日から何日さかのぼった所を右端にするか。 */
const REC_DAYS = 30;
let recOff = 0, recSel = null, recHover = null, recTotal = 0;
const md = d => (d.getMonth() + 1) + "/" + d.getDate();
const daysBetween = (a, b) => Math.round((b - a) / 864e5);   // 日付どうしの差（日数）
/* 早起きがいちばん長く続いた日数。早起きは毎日のミッションなので、暦の上で1日ずつ続いた分を数える */
function longestRun(id) {
  let best = 0, run = 0, prev = null;
  Object.keys(st.log).filter(k => st.log[k].includes(id)).sort().forEach(k => {
    const d = dayOf(k);
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  });
  return best;
}
function renderRec() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since = dayOf(st.since);
  $("#r-days").innerHTML = (Math.max(0, daysBetween(since, today)) + 1) + "<small>日目</small>";
  $("#r-since").textContent = since.getFullYear() + "年" + (since.getMonth() + 1) + "月" + since.getDate() + "日から";
  const wake = st.missions.find(m => m.type === "wake");
  $("#r-wake").innerHTML = streakOf(wake) + "<small>日</small>";
  $("#r-best").innerHTML = longestRun(wake.id) + "<small>日</small>";

  // グラフ。右端が今日から recOff 日前、そこから30日さかのぼる
  const end = new Date(today); end.setDate(end.getDate() - recOff);
  const days = [];
  for (let i = REC_DAYS - 1; i >= 0; i--) { const d = new Date(end); d.setDate(d.getDate() - i); days.push(d); }
  const counts = days.map(d => (st.log[keyOf(d)] || []).length);
  const top = Math.max(2, ...counts);   // 1回だけの日が満タンに見えないよう、上は2回以上にとる
  const thisYear = end.getFullYear() === today.getFullYear();
  $("#recRange").textContent = (thisYear ? "" : end.getFullYear() + "年 ") + md(days[0]) + "〜" + md(end);
  $("#recTop").textContent = top + "回";
  $("#recBars").innerHTML = days.map((d, i) => {
    const k = keyOf(d), n = counts[i], pre = d < since;   // 始めた日より前は何も描かない
    return '<button class="bar' + (pre ? " pre" : "") + '" data-k="' + k + '"' +
      (pre ? " disabled" : "") + ' aria-label="' + md(d) + "（" + DOW[d.getDay()] + "） " + n + '回">' +
      (pre ? "" : '<i' + (n ? "" : ' class="zero"') + ' style="height:' + (n / top * 100).toFixed(1) + '%"></i>') + "</button>";
  }).join("");
  // 日付は右端から1週ごと。送る単位と同じなので、送っても目盛りの並びが変わらない
  let x = "";
  for (let i = REC_DAYS - 1; i >= 0; i -= 7) {
    x += '<span style="left:' + ((i + .5) / REC_DAYS * 100).toFixed(2) + '%">' + (i === REC_DAYS - 1 && !recOff ? "今日" : md(days[i])) + "</span>";
  }
  $("#recX").innerHTML = x;
  $("#recNext").disabled = recOff === 0;
  $("#recPrev").disabled = days[0] <= since;
  recTotal = counts.reduce((a, b) => a + b, 0);
  paintRecPick();
}
/* グラフの上の1行。マウスが乗っている棒か、押して選んだ棒があればその日、無ければ30日の合計 */
function paintRecPick() {
  const k = recHover || recSel;
  const b = k && $('#recBars .bar[data-k="' + k + '"]');
  $("#recBars").classList.toggle("picking", !!b);
  $$("#recBars .bar").forEach(x => x.classList.toggle("sel", x === b));
  $("#recPick").innerHTML = b
    ? esc(b.getAttribute("aria-label")).replace(/(\d+)回$/, "<b>$1</b>回")
    : "この30日で <b>" + recTotal + "</b>回";
}
$("#recBars").addEventListener("click", e => {
  const b = e.target.closest(".bar"); if (!b || b.disabled) return;
  recSel = recSel === b.dataset.k ? null : b.dataset.k;   // 同じ棒をもう一度おすと戻る
  paintRecPick();
});
// マウスは乗せるだけで見られるように。離れたら、押して選んだ棒（無ければ合計）に戻る
$("#recBars").addEventListener("pointerover", e => {
  if (e.pointerType !== "mouse") return;
  const b = e.target.closest(".bar");
  recHover = b && !b.disabled ? b.dataset.k : null; paintRecPick();
});
$("#recBars").addEventListener("pointerleave", e => {
  if (e.pointerType !== "mouse") return;
  recHover = null; paintRecPick();
});
$("#recPrev").addEventListener("click", () => { recOff += 7; recSel = null; renderRec(); });
$("#recNext").addEventListener("click", () => { recOff = Math.max(0, recOff - 7); recSel = null; renderRec(); });

/* ---------- 画像の物置 ---------- */
/* 画像の本体だけは IndexedDB に置く。JSONの保存場所（localStorage）は5MBほどしかなく、
   写真1枚で使い切ってしまうため。メモ側は「どの画像か」の目印だけを持つ。
   そのため、設定画面のバックアップ文字列に画像は入らない。 */
const DB_NAME = "celestia-files", DB_STORE = "blobs";
let dbP = null;
function fileDB() {
  if (!dbP) dbP = new Promise((ok, ng) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(DB_STORE)) r.result.createObjectStore(DB_STORE);
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
  return dbP;
}
function fileDo(mode, fn) {
  return fileDB().then(d => new Promise((ok, ng) => {
    const tx = d.transaction(DB_STORE, mode), req = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => ok(req ? req.result : undefined);
    tx.onerror = () => ng(tx.error);
  })).catch(() => null);
}
const fileGet = k => fileDo("readonly", s => s.get(k));
const filePut = (k, v) => fileDo("readwrite", s => s.put(v, k));
const fileDel = k => fileDo("readwrite", s => s.delete(k));

/* 一覧に出すための小さい画像を焼く。元の写真は大きいので、
   そのまま並べると読みこみも記憶も重くなる。 */
function makeThumb(file, max) {
  return new Promise(ok => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => ok(b || file), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    img.src = url;
  });
}

/* ---------- メモ ---------- */
/* フォルダとメモを、ひとつの配列に parent でぶら下げて持つ。
   いま開いているフォルダは memoAt（空文字＝いちばん上）。 */
let memoAt = "", mEditing = null, mEditKind = "note", mMenuFor = null, mDelArm = false;
let memoSig = "", thumbUrls = [];
let unlocked = false;              // パスワードを通したか。アプリを離れると false に戻す（下の visibilitychange）
const ICO_FOLDER = '<svg viewBox="0 0 24 24"><path d="M3.5 6.5h5.5l2 2.5h9.5v10.5h-17z"/></svg>';
const ICO_NOTE = '<svg viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h4"/></svg>';
const ICO_LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/></svg>';
/* 非表示フォルダ。フォルダの形の真ん中に、小さな鍵穴を置く。 */
const ICO_HFOLDER = '<svg viewBox="0 0 24 24"><path d="M3.5 6.5h5.5l2 2.5h9.5v10.5h-17z"/>' +
  '<circle cx="12" cy="13.5" r="1.7"/><path d="M12 15.2v2"/></svg>';
const memoOf = id => st.memo.find(x => x.id === id);
const memoIn = pid => st.memo.filter(x => x.parent === pid);
const memoName = m => m.name || ("名前のない" + (m.kind === "folder" ? "フォルダ" : m.kind === "image" ? "画像" : "メモ"));
const isShut = m => !!m.hide && !unlocked;   // 隠してあって、まだパスワードを通していない

function renderMemo() {
  const here = memoAt ? memoOf(memoAt) : null;
  if (memoAt && !here) memoAt = "";                    // 開いていたフォルダが消えていたら上へ戻す
  $("#memoWhere").textContent = here ? memoName(here) : "書庫";
  $("#memoBack").hidden = !memoAt;

  // フォルダが先、それぞれ新しいものが上
  const list = memoIn(memoAt);
  const sorted = list.slice().sort((a, b) =>
    (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) ||
    (b.at || "").localeCompare(a.at || ""));

  // 中身が同じなら作り直さない。毎分の画面更新で画像を読み直さないため。
  const sig = memoAt + "|" + sorted.map(m =>
    [m.id, m.kind, m.name, m.body.slice(0, 40), m.hide ? 1 : 0, isShut(m) ? 1 : 0,
     m.kind === "folder" ? memoIn(m.id).length : ""].join(",")).join(";");
  if (sig === memoSig && $("#memoList").children.length) return;
  memoSig = sig;

  $("#memoList").innerHTML = sorted.length ? sorted.map(m => {
    const shut = isShut(m);
    const sub = shut ? '<div class="mlock">パスワードで見られます</div>'
      : m.kind === "folder" ? '<div class="mbody">' + memoIn(m.id).length + "件</div>"
      : m.kind === "note" && m.body ? '<div class="mbody">' + esc(m.body) + "</div>"
      : "";
    // 隠してあるフォルダは、開けているあいだも鍵つきの形のままにする（うっかり置き忘れ防止）
    const ico = m.hide && m.kind === "folder" ? ICO_HFOLDER
      : shut ? ICO_LOCK
      : m.kind === "folder" ? ICO_FOLDER : ICO_NOTE;
    const head = m.kind === "image" && !shut
      ? '<span class="mthumb" data-th="' + esc(m.id) + '"></span>'
      : '<span class="mico ' + (m.kind === "folder" ? "folder" : "") + '">' + ico + "</span>";
    return '<div class="row" data-act="mopen" data-id="' + esc(m.id) + '">' + head +
      '<div class="rowbody"><div class="rowtitle">' + esc(memoName(m)) + "</div>" + sub +
      "</div></div>";
  }).join("") : '<div class="empty">まだ何もありません。</div>';
  $("#memoList").style.display = "flex";
  $("#memoList").style.flexDirection = "column";
  $("#memoList").style.gap = "10px";
  paintThumbs();
}

/* 一覧の画像を、物置から出して貼る。前に作った参照は捨てておく。 */
function paintThumbs() {
  thumbUrls.forEach(u => URL.revokeObjectURL(u));
  thumbUrls = [];
  $$("#memoList [data-th]").forEach(el => {
    fileGet("th-" + el.dataset.th)
      .then(b => b || fileGet("img-" + el.dataset.th))   // 小さいのが無ければ元の画像で
      .then(b => {
        if (!b || !el.isConnected) return;
        const u = URL.createObjectURL(b);
        thumbUrls.push(u);
        el.style.backgroundImage = "url(" + u + ")";
      });
  });
}

/* 編集の窓を開く。folder のときは本文の欄を出さない。 */
function openMemoEdit(kind, id) {
  mEditKind = kind; mEditing = id || null;   // kind は "folder" / "hidden" / "note" / "image"
  const m = id ? memoOf(id) : null;
  const isFolder = kind === "folder" || kind === "hidden";
  $("#mmHead").textContent =
    (kind === "hidden" ? "非表示フォルダ" : isFolder ? "フォルダ" : "メモ") + (m ? "" : "を作る");
  $("#mmName").value = m ? m.name : "";
  $("#mmBody").value = m && m.kind !== "folder" ? m.body : "";
  $("#mmBodyWrap").hidden = isFolder;
  openSheet("#sheetMEdit");
  if (!m) setTimeout(() => $("#mmName").focus(), 60);
}
$("#memoAdd").addEventListener("click", () => openSheet("#sheetMAdd"));
$("#sheetMAdd").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  closeSheet("#sheetMAdd");
  if (b.dataset.add === "image") { $("#memoFile").click(); return; }
  if (b.dataset.add === "hidden") {                    // 中身をまとめて隠す入れ物
    if (!st.pass) { openPass(() => openMemoEdit("hidden", null)); return; }   // 先にパスワードを決める
    openMemoEdit("hidden", null); return;
  }
  openMemoEdit(b.dataset.add, null);
});
/* えらばれた写真を物置へ入れ、一覧に1件足す。名前はファイル名から。 */
$("#memoFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";                                  // 同じ写真をもう一度えらべるように
  if (!f) return;
  const id = uid();
  setMsg("画像を取りこんでいます…");
  makeThumb(f, 320)
    .then(th => Promise.all([filePut("img-" + id, f), th && filePut("th-" + id, th)]))
    .then(() => {
      st.memo.push({ id: id, kind: "image", name: f.name.replace(/\.[^.]+$/, "").slice(0, 120),
                     body: "", parent: memoAt, at: keyOf(new Date()), hide: false });
      save(); memoSig = ""; renderMemo(); setMsg("入れました");
    })
    .catch(() => setMsg("取りこめませんでした"));
});
$("#memoBack").addEventListener("click", () => {
  const here = memoOf(memoAt);
  memoAt = here ? here.parent : "";
  memoSig = ""; renderMemo();
});
$("#mmCancel").addEventListener("click", () => closeSheet("#sheetMEdit"));
$("#mmSave").addEventListener("click", () => {
  const isFolder = mEditKind === "folder" || mEditKind === "hidden";
  const name = $("#mmName").value.trim();
  const body = isFolder ? "" : $("#mmBody").value;
  if (!name && !body) return;                          // どちらも空なら何もしない
  const target = mEditing && memoOf(mEditing);
  if (target) { target.name = name; if (target.kind !== "folder") target.body = body; }
  else st.memo.push({ id: uid(), kind: isFolder ? "folder" : mEditKind, name: name, body: body,
                      parent: memoAt, at: keyOf(new Date()), hide: mEditKind === "hidden" });
  save(); memoSig = ""; renderMemo(); closeSheet("#sheetMEdit");
});

/* 一覧を押したとき。フォルダなら中へ、メモなら編集の窓へ。 */
$("#memoList").addEventListener("click", e => {
  const b = e.target.closest("[data-act='mopen']"); if (!b) return;
  if (Date.now() - mHoldEnd < HOLD_EAT) return;        // 長押し直後の一押しは飲みこむ
  const m = memoOf(b.dataset.id); if (!m) return;
  if (isShut(m)) { askWord(() => openMemoItem(m)); return; }   // 隠してあれば、まずパスワード
  openMemoItem(m);
});
function openMemoItem(m) {
  if (m.kind === "folder") { memoAt = m.id; memoSig = ""; renderMemo(); }
  else if (m.kind === "image") openMemoView(m.id);
  else openMemoEdit("note", m.id);
}
/* 画像を大きく見る */
let mvUrl = "";
function openMemoView(id) {
  const m = memoOf(id); if (!m) return;
  $("#mvHead").textContent = memoName(m);
  fileGet("img-" + id).then(b => {
    if (mvUrl) URL.revokeObjectURL(mvUrl);
    mvUrl = b ? URL.createObjectURL(b) : "";
    $("#mvImg").src = mvUrl;
    $("#mvImg").alt = memoName(m);
    openSheet("#sheetMView");
  });
}
$("#mvClose").addEventListener("click", () => closeSheet("#sheetMView"));

/* 長押しで設定の窓。指がずれたら、なぞりとみなして取り消す。 */
let mHoldT = null, mHoldFrom = null, mHoldEnd = 0;
function mStopHold() { clearTimeout(mHoldT); mHoldT = null; mHoldFrom = null; }
$("#memoList").addEventListener("pointerdown", e => {
  const b = e.target.closest("[data-act='mopen']"); if (!b) return;
  mHoldFrom = { x: e.clientX, y: e.clientY };
  clearTimeout(mHoldT);
  mHoldT = setTimeout(() => {
    mHoldT = null; mHoldEnd = Date.now();
    openMemoMenu(b.dataset.id);
  }, HOLD_MS);
});
$("#memoList").addEventListener("pointermove", e => {
  if (!mHoldT || !mHoldFrom) return;
  if (Math.abs(e.clientX - mHoldFrom.x) > HOLD_SLOP ||
      Math.abs(e.clientY - mHoldFrom.y) > HOLD_SLOP) mStopHold();
});
["pointerup", "pointercancel"].forEach(t => $("#memoList").addEventListener(t, mStopHold));

function openMemoMenu(id) {
  const m = memoOf(id); if (!m) return;
  mMenuFor = id; mDelArm = false;
  $("#miHead").textContent = m.name || (m.kind === "folder" ? "名前のないフォルダ" : "名前のないメモ");
  $("#miDelete").textContent = "削除";
  $("#miLock").textContent = m.hide ? "隠すのをやめる" : "隠す";
  openSheet("#sheetMItem");
}
/* 隠す／隠さない。パスワードはアプリに1つ（st.pass）なので、ここでは印を付けるだけ。
   まだパスワードが無いときは、先に決めてもらう。 */
$("#miLock").addEventListener("click", () => {
  const m = memoOf(mMenuFor); if (!m) return;
  closeSheet("#sheetMItem");
  if (m.hide) {                                // 隠すのをやめる
    m.hide = false; save(); memoSig = ""; renderMemo(); setMsg("隠すのをやめました");
    return;
  }
  const go = () => {
    m.hide = true; unlocked = false;           // かけたら、その場で隠れる（かかったことが見て分かる）
    save(); memoSig = ""; renderMemo(); setMsg("隠しました");
  };
  if (!st.pass) openPass(go); else go();
});

/* パスワードを決める・変える。変えるときは、いまのパスワードが要る。 */
let passThen = null;
function openPass(then) {
  passThen = then || null;
  const has = !!st.pass;
  $("#mlHead").textContent = has ? "パスワードを変える" : "パスワードを決める";
  $("#mlOldWrap").hidden = !has;
  $("#mlNewLab").textContent = has ? "新しいパスワード" : "パスワード";
  $("#mlOld").value = ""; $("#mlWord").value = ""; $("#mlNg").hidden = true;
  $("#mlOn").textContent = has ? "変える" : "決める";
  openSheet("#sheetMLock");
  setTimeout(() => (has ? $("#mlOld") : $("#mlWord")).focus(), 60);
}
$("#mlCancel").addEventListener("click", () => { passThen = null; closeSheet("#sheetMLock"); });
$("#mlOn").addEventListener("click", () => {
  const w = $("#mlWord").value.trim();
  if (st.pass && $("#mlOld").value.trim() !== st.pass) { $("#mlNg").hidden = false; return; }
  if (!w) { setMsg("パスワードを入れてください", true); return; }
  const first = !st.pass;
  st.pass = w; unlocked = true;                // 決めた本人は、そのまま見られる
  save(); paintPass(); memoSig = ""; renderMemo(); closeSheet("#sheetMLock");
  setMsg(first ? "パスワードを決めました" : "パスワードを変えました");
  const f = passThen; passThen = null; if (f) f();
});
$("#mlWord").addEventListener("keydown", e => { if (e.key === "Enter") $("#mlOn").click(); });

/* パスワードを聞く。合っていれば、隠してあるものが「まとめて」見えるようになる。 */
let askThen = null;
function askWord(then) {
  askThen = then || null;
  $("#moHead").textContent = "パスワード";
  $("#moWord").value = ""; $("#moNg").hidden = true;
  openSheet("#sheetMOpen");
  setTimeout(() => $("#moWord").focus(), 60);
}
$("#moCancel").addEventListener("click", () => { askThen = null; closeSheet("#sheetMOpen"); });
$("#moOk").addEventListener("click", () => {
  if ($("#moWord").value.trim() !== st.pass) { $("#moNg").hidden = false; return; }
  unlocked = true;
  closeSheet("#sheetMOpen");
  memoSig = ""; renderMemo();
  const f = askThen; askThen = null; if (f) f();
});
$("#moWord").addEventListener("keydown", e => { if (e.key === "Enter") $("#moOk").click(); });

/* 設定画面の「書庫のパスワード」 */
function paintPass() {
  $("#passState").textContent = st.pass ? "決めてあります" : "まだ決めていません";
  $("#passBtn").textContent = st.pass ? "パスワードを変える" : "パスワードを決める";
}
$("#passBtn").addEventListener("click", () => openPass(null));

$("#miRename").addEventListener("click", () => {
  const m = memoOf(mMenuFor); if (!m) return;
  closeSheet("#sheetMItem");
  openMemoEdit(m.kind, m.id);
});
/* 消すのは二度押し。一度目は聞き返すだけ（アプリのほかの場所と同じやり方）。 */
$("#miDelete").addEventListener("click", e => {
  const m = memoOf(mMenuFor); if (!m) return;
  // フォルダを消すときは、中身も一緒に消える
  const gone = [m.id];
  for (let i = 0; i < gone.length; i++)
    st.memo.filter(x => x.parent === gone[i]).forEach(x => gone.push(x.id));
  const n = gone.length - 1;
  if (!mDelArm) {
    mDelArm = true;
    e.target.textContent = (m.kind === "folder" && n ? "中の" + n + "件も消える。" : "") + "もう一度おす";
    setTimeout(() => { if (mDelArm) { mDelArm = false; e.target.textContent = "削除"; } }, 3500);
    return;
  }
  // 画像は物置のほうも消す（メモ側の目印だけ消しても、本体が残ってしまう）
  st.memo.filter(x => gone.includes(x.id) && x.kind === "image")
    .forEach(x => { fileDel("img-" + x.id); fileDel("th-" + x.id); });
  st.memo = st.memo.filter(x => !gone.includes(x.id));
  if (gone.includes(memoAt)) memoAt = "";
  mDelArm = false; e.target.textContent = "削除";
  save(); memoSig = ""; renderMemo(); closeSheet("#sheetMItem");
});

/* ---------- sheets ---------- */
/* 後ろを暗くする覆いは、下から出るシートのときだけ。
   右から出るパネルは画面いっぱいを覆う別ページなので、暗くする相手がいない。
   しかも覆いをつけると、パネルがすべり込むまでの間だけ上端が暗く見え、
   iPhone がその色をステータスバーに拾ったまま戻さなくなる。 */
function paintScrim() { $("#scrim").classList.toggle("on", $$(".sheet.on:not(.side)").length > 0); }
function openSheet(id) { $(id).classList.add("on"); paintScrim(); paintBar(); }
/* 1枚だけ閉じる。ミッションを保存したときに、その下のステータス画面まで
   一緒に閉じてしまわないように、閉じるのは自分の分だけにする。 */
function closeSheet(id) {
  $(id).classList.remove("on");
  paintScrim(); paintBar();
}
function closeSheets() {                       // 全部たたむ（タブを移ったときなど）
  $$(".sheet").forEach(x => x.classList.remove("on"));
  paintScrim(); paintBar();
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
  // 達成の記録（st.log）は残す。消すと、記録タブの数字がミッションを消したとたんに減ってしまう。
  // 残った番号はもうどのミッションとも一致しないので、カレンダーや今日の一覧には出ない。
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
  markImp(false);
  $("#dEvAdd").textContent = "予定を追加";
  $("#dEvCancel").hidden = true;
}
/* 「重要」の入り切り。押した見た目と、読み上げ用の印を一緒に切りかえる。 */
function markImp(on) {
  $("#dEvImp").classList.toggle("on", on);
  $("#dEvImp").setAttribute("aria-pressed", on ? "true" : "false");
}
$("#dEvImp").addEventListener("click", () => markImp(!$("#dEvImp").classList.contains("on")));

/* その予定を入力欄に写して、編集のモードにする */
function editEvent(id) {
  const e = (st.events[dayKey] || []).find(x => x.id === id); if (!e) return;
  dEditing = id;
  $("#dEvName").value = e.title;
  $("#dEvTime").value = e.time; $("#dEvEnd").value = e.end;
  markImp(!!e.important);
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
    '<div class="row' + (e.important ? " imp" : "") + (e.id === dEditing ? " editing" : "") + '">' +
    '<button class="edit" data-act="evedit" data-id="' + esc(e.id) + '" aria-label="この予定を編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button>' +
    '<div class="rowbody"><div class="rowtitle">' + esc(e.title) + "</div>" +
    (e.important || evSpan(e) || e.notify ? '<div class="chips">' +
      (e.important ? '<span class="chip imp">重要</span>' : "") +
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
  const data = {
    title: t, time: $("#dEvTime").value, end: $("#dEvEnd").value, notify: notify,
    important: $("#dEvImp").classList.contains("on")
  };
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

/* 下から出るシートは、指で下へなぞって閉じる。上の短い棒はそのための取っ手。
   取っ手からなら always、中身からのときは いちばん上まで戻っているときだけ受けつける
   （読んでいる途中や、文字を書いている最中に閉じてしまわないように）。 */
$$(".sheet:not(.side)").forEach(el => {
  const SLOP = 12;     // これだけ動いてから、上か下かを決める
  const CLOSE = 90;    // これだけ下へ行ったら、そのまま閉じる
  let touch = null, y0 = 0, dy = 0, way = "";

  el.addEventListener("touchstart", e => {
    if (touch !== null || e.touches.length !== 1) return;
    const grab = e.target.closest(".grab, .sheettitle");
    if (!grab && (el.scrollTop > 0 || e.target.closest("input, textarea, select"))) return;
    touch = e.touches[0].identifier; y0 = e.touches[0].clientY; dy = 0; way = "";
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    if (touch === null) return;
    const t = Array.prototype.find.call(e.touches, x => x.identifier === touch);
    if (!t) return;
    const ay = t.clientY - y0;
    if (!way) {
      if (Math.abs(ay) < SLOP) return;
      way = ay > 0 ? "shita" : "ue";
      if (way === "shita") el.style.transition = "none";
    }
    if (way !== "shita") return;
    dy = Math.max(0, ay);                              // 下へだけ動かす
    el.style.transform = "translateY(" + dy + "px)";
    if (e.cancelable) e.preventDefault();              // なぞっている間は中身を上下させない
  }, { passive: false });

  const release = commit => {
    if (touch === null) return;
    const shut = commit && way === "shita" && dy > CLOSE;
    touch = null; way = ""; dy = 0;
    el.style.transition = "";
    if (shut) closeSheet("#" + el.id);   // 先にたたむ指示を出してから
    el.style.transform = "";             // 手を離す。指の位置から続けてすべって消える
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
let popFor = null, popHideT = null;
const POP_EDGE = 12;   // 画面の端からあけておく余白
const POP_GAP = 9;     // ボタンとの間隔
const POP_FADE = 200;  // 片づけるまでの時間。style.css の .pop の 0.16s より少し長くしてある

function openPop(btn) {
  const src = document.getElementById(btn.dataset.help); if (!src) return;
  showPop(btn, src.innerHTML, true);
}
/* 中身と、どこにぶら下げるかを渡せば、この小窓はなんでも出せる。
   veil は「後ろ一面の受け皿」。押して閉じたい長押しのときは付け、
   離れれば消えるPCの重ね置きでは付けない（付けると下の日が押せなくなる）。 */
function showPop(anchor, html, veil) {
  const pop = $("#pop"), body = $("#popBody");
  body.innerHTML = html;
  // 複製した中身の id は落とす。元の要素と重複させないため。
  body.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  clearTimeout(popHideT);                 // 消えかけていたら引きとめる
  pop.hidden = false; $("#popVeil").hidden = !veil;
  if (popFor) markPop(popFor, false);
  popFor = anchor; markPop(anchor, true);
  placePop();                             // 場所を決めてから
  void pop.offsetWidth;                   // ここまでを一度描かせて（これが無いと出る動きが飛ぶ）
  pop.classList.add("on");                // ふわりと出す
}
function closePop() {
  if (!popFor) return;
  const pop = $("#pop");
  markPop(popFor, false); popFor = null;
  pop.classList.remove("on");
  $("#popVeil").hidden = true;            // 受け皿は先に外す。消えるのを待たずに下を押せるように
  clearTimeout(popHideT);
  popHideT = setTimeout(() => { pop.hidden = true; }, POP_FADE);
}
function markPop(btn, on) {
  if (btn.classList.contains("cell")) { btn.classList.toggle("held", on); return; }
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

/* ---------- 日を長押しして、その日の中身を見る ---------- */
/* 指では長押し、マウスでは重ねるだけ。押した日の上に小窓が出る。
   出たあとは、指を離さずになぞれば、指の下の日に小窓が付け替わる。離せば閉じる。
   開けるのは中身だけで、書きかえは今までどおり日をふつうに押して出す画面のほう。 */
const HOLD_MS = 420;    // これだけ押しつづけたら小窓を出す
const HOLD_SLOP = 10;   // 小窓が出る前に指がこれだけずれたら、なぞりとみなして取り消す
const HOVER_MS = 200;   // マウスを重ねてから出るまで
const HOLD_EAT = 400;   // 長押しを終えてから、この間に来た一押しは飲みこむ
let holdTimer = null, holdFrom = null, holding = false, holdKey = "", holdEndAt = 0;

function dayPopHtml(k) {
  const [y, m, dd] = k.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const holi = holidayName(d);
  const ev = (st.events[k] || []).slice().sort((a, b) => evKey(a).localeCompare(evKey(b)));
  return '<div class="daypop">' +
    '<div class="dpdate">' + y + "年" + m + "月" + dd + "日（" + DOW[d.getDay()] + "）</div>" +
    (holi ? '<div class="dpholi">' + esc(holi) + "</div>" : "") +
    (ev.length
      ? '<ul class="dplist">' + ev.map(e => '<li' + (e.important ? ' class="imp"' : "") + ">" +
          (evSpan(e) ? '<span class="dptime">' + esc(evSpan(e)) + "</span>" : "") +
          '<span class="dpname">' + esc(e.title) + "</span></li>").join("") + "</ul>"
      : '<div class="dpnone">予定なし</div>') +
    "</div>";
}
function stopHold() { clearTimeout(holdTimer); holdTimer = null; holdFrom = null; }
function dayCellOf(e) { return e.target.closest(".cell[data-act='day']"); }
/* 指の下を見る。触ったあとの pointermove は最初に押した日にしか届かない
   （端末が指をその要素に結びつけるため）ので、座標から引き直す。
   小窓が指の上に重なっていても、下に隠れている日まで見にいく。
   返すのは3通り。
     {cell}  … 日の上にいる
     {}      … マスとマスのすきま。ここで消すと、なぞるあいだ点滅するので何もしない
     {off:1} … 日から外れた（空きマスや、表の外）*/
function underFinger(x, y) {
  let gap = false;
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.closest) continue;
    const c = el.closest(".cell[data-act='day']");
    if (c) return { cell: c };
    if (el.classList.contains("pad")) return { off: 1 };   // 月の頭とお尻の空きマス
    if (el.id === "calGrid") gap = true;
  }
  return gap ? {} : { off: 1 };
}
function openDayPop(cell) {
  holdKey = cell.dataset.k;
  showPop(cell, dayPopHtml(holdKey), false);
}
function endHold() {
  stopHold();
  if (!holding) return;
  holding = false; holdKey = "";
  holdEndAt = Date.now();                       // 直後の一押しを飲みこむための目印
  closePop();                                   // なぞり終わりに最後の日が残らないように
}

const calGrid = $("#calGrid");
calGrid.addEventListener("pointerdown", e => {
  const cell = dayCellOf(e); if (!cell) return;
  holdFrom = { x: e.clientX, y: e.clientY };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null; holding = true;
    openDayPop(cell);
  }, HOLD_MS);
});
calGrid.addEventListener("pointermove", e => {
  if (holding) {                                // 出したあとは、指の下の日へ付け替える
    const hit = underFinger(e.clientX, e.clientY);
    if (hit.cell) {
      if (hit.cell.dataset.k !== holdKey) openDayPop(hit.cell);
    } else if (hit.off && holdKey) {
      holdKey = ""; closePop();                 // 日から外れたら消す。また乗れば出る
    }
    return;
  }
  if (!holdTimer || !holdFrom) return;
  if (Math.abs(e.clientX - holdFrom.x) > HOLD_SLOP ||
      Math.abs(e.clientY - holdFrom.y) > HOLD_SLOP) stopHold();
});
["pointerup", "pointercancel"].forEach(t => calGrid.addEventListener(t, endHold));
/* 長押しで小窓を出したときは、指を離したときの一押しをここで止める。
   止めないと、そのまま日の画面まで開いてしまう。
   指が別の日へ動いていると一押し自体が来ないこともあるので、
   目印は「立てっぱなしの旗」ではなく時刻にしてある（放っておいても消える）。 */
calGrid.addEventListener("click", e => {
  if (Date.now() - holdEndAt > HOLD_EAT) return;
  holdEndAt = 0;
  e.stopPropagation(); e.preventDefault();
}, true);

/* PCはマウスを重ねるだけ。受け皿は付けないので、そのまま日を押せる。 */
let hoverTimer = null;
calGrid.addEventListener("pointerover", e => {
  if (e.pointerType !== "mouse") return;
  const cell = dayCellOf(e); if (!cell) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showPop(cell, dayPopHtml(cell.dataset.k), false), HOVER_MS);
});
calGrid.addEventListener("pointerout", e => {
  if (e.pointerType !== "mouse") return;
  clearTimeout(hoverTimer);
  if (popFor && popFor.classList.contains("cell")) closePop();
});
window.addEventListener("resize", placePop);
window.addEventListener("scroll", placePop, true);

/* ---------- tabs ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.toggle("on", x === t));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
  closePop();
  $(".scroller").scrollTop = 0;                         // 転がるのはこの中なので、戻すのもここ
  $("main").classList.toggle("on-home", t.dataset.v === "home");   // ゲージとセリフの出し入れ
  closeSheets();                                        // 開きっぱなしのパネルはたたむ
  if (t.dataset.v === "set") { paintBackup(); paintPass(); }
  if (t.dataset.v === "notify") { paintNotify(); renderRem(); }
  if (t.dataset.v === "rec") { recOff = 0; recSel = null; renderRec(); }   // 開くたびに今日の週から
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

/* ---------- くりかえし通知 ---------- */
/* 予定と違って日付を持たず、決まりだけを持つ。鳴らす日は remDays が数える。 */
let rmEditing = null, rmDraft = null;
const ruleText = r => r.rule === "daily" ? "毎日"
  : r.rule === "week" ? DOW.filter((_, i) => r.days.includes(i)).join("・") + "曜"
  : r.n + "日おき";

function renderRem() {
  $("#remOff").hidden = canNotify();
  const list = st.reminders;
  $("#remList").innerHTML = list.length ? list.map(r => {
    const nx = remNext(r);
    return '<div class="row" data-act="remedit" data-id="' + esc(r.id) + '">' +
      '<div class="rowbody"><div class="rowtitle">' + esc(r.title) + "</div>" +
      '<div class="chips"><span class="chip time">' + esc(r.time) + "</span>" +
      '<span class="chip">' + esc(ruleText(r)) + "</span>" +
      (nx ? '<span class="chip">次は' + (nx.getMonth() + 1) + "/" + nx.getDate() + "</span>" : "") +
      "</div></div></div>";
  }).join("") : '<div class="empty">まだありません。</div>';
  $("#remList").style.display = "flex";
  $("#remList").style.flexDirection = "column";
  $("#remList").style.gap = "9px";
}

$("#rmDays").innerHTML = DOW.map((d, i) => '<button class="day" data-d="' + i + '">' + d + "</button>").join("");

function paintRm() {
  const r = rmDraft;
  $$("#rmRule .pill").forEach(p => p.classList.toggle("on", p.dataset.r === r.rule));
  $("#rmEveryWrap").hidden = r.rule !== "every";
  $("#rmDaysWrap").hidden = r.rule !== "week";
  $$("#rmDays .day").forEach(b => b.classList.toggle("on", r.days.includes(+b.dataset.d)));
  const nx = r.title || true ? remNext(r) : null;
  $("#rmNext").textContent = nx
    ? "次に知らせるのは " + (nx.getMonth() + 1) + "月" + nx.getDate() + "日 " + r.time + " です。"
    : "いまの決まりでは、この先30日は鳴りません。";
}
function openRem(id) {
  const src = id && st.reminders.find(x => x.id === id);
  rmEditing = id || null;
  rmDraft = src ? JSON.parse(JSON.stringify(src))
    : { id: uid(), title: "", time: "08:00", rule: "every", n: 2, from: keyOf(new Date()), days: [] };
  $("#rmHead").textContent = src ? "くりかえし通知" : "くりかえし通知を追加";
  $("#rmName").value = rmDraft.title;
  $("#rmTime").value = rmDraft.time;
  $("#rmN").value = rmDraft.n;
  $("#rmFrom").value = rmDraft.from;
  $("#rmDelete").hidden = !src;
  paintRm();
  openSheet("#sheetRem");
  if (!src) setTimeout(() => $("#rmName").focus(), 60);
}
/* 入力のたびに下書きへ写して、次に鳴る日を出しなおす */
function grabRm() {
  rmDraft.title = $("#rmName").value.trim();
  rmDraft.time = $("#rmTime").value || "08:00";
  rmDraft.n = Math.min(30, Math.max(2, Math.round(+$("#rmN").value || 2)));
  rmDraft.from = $("#rmFrom").value || keyOf(new Date());
}
["#rmName", "#rmTime", "#rmN", "#rmFrom"].forEach(sel =>
  $(sel).addEventListener("input", () => { grabRm(); paintRm(); }));
$("#rmRule").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b) return;
  grabRm(); rmDraft.rule = b.dataset.r;
  if (rmDraft.rule === "week" && !rmDraft.days.length) rmDraft.days = [new Date().getDay()];
  paintRm();
});
$("#rmDays").addEventListener("click", e => {
  const b = e.target.closest(".day"); if (!b) return;
  grabRm();
  const d = +b.dataset.d, i = rmDraft.days.indexOf(d);
  if (i < 0) rmDraft.days.push(d); else rmDraft.days.splice(i, 1);
  rmDraft.days.sort();
  paintRm();
});
$("#remAdd").addEventListener("click", () => openRem(null));
$("#remList").addEventListener("click", e => {
  const b = e.target.closest("[data-act='remedit']"); if (!b) return;
  openRem(b.dataset.id);
});
$("#rmCancel").addEventListener("click", () => closeSheet("#sheetRem"));
$("#rmSave").addEventListener("click", () => {
  grabRm();
  if (!rmDraft.title) { setMsg("名前を入れてください", true); return; }
  if (rmDraft.rule === "week" && !rmDraft.days.length) { setMsg("曜日をえらんでください", true); return; }
  const i = st.reminders.findIndex(x => x.id === rmEditing);
  if (i >= 0) st.reminders[i] = rmDraft; else st.reminders.push(rmDraft);
  save(); syncNow(); renderRem(); closeSheet("#sheetRem");
  setMsg(i >= 0 ? "変えました" : "追加しました");
});
let rmDelArm = false;
$("#rmDelete").addEventListener("click", e => {
  if (!rmDelArm) {
    rmDelArm = true; e.target.textContent = "もう一度おす";
    setTimeout(() => { if (rmDelArm) { rmDelArm = false; e.target.textContent = "この通知を消す"; } }, 3500);
    return;
  }
  rmDelArm = false; e.target.textContent = "この通知を消す";
  st.reminders = st.reminders.filter(x => x.id !== rmEditing);
  save(); renderRem(); closeSheet("#sheetRem"); setMsg("消しました");
});

/* ---------- 控えの文字（圧縮） ---------- */
/* 中身は同じで、文字数だけを減らす。JSONは同じ項目名を何度も書くので、
   よく縮む（貯まってくると8割ほど減る）。
   頭の CEL1 は「これは圧縮した控えです」という目印。
   古い控え（{ ではじまる生のJSON）も、これまでどおり読みこめる。 */
const BK_TAG = "CEL1";
const hasZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

function bytesToB64(u8) {
  let s2 = "";
  for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s2);
}
const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

async function packBackup(o) {
  const json = JSON.stringify(o);
  if (!hasZip) return json;                 // 圧縮を知らない端末では、これまでどおりの文字
  try {
    const cs = new CompressionStream("gzip");
    const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
    return BK_TAG + bytesToB64(new Uint8Array(buf));
  } catch (e) { return json; }
}
async function unpackBackup(text) {
  const t = String(text).trim();
  if (t.startsWith("{")) return JSON.parse(t);            // 昔の控え
  const body = t.startsWith(BK_TAG) ? t.slice(BK_TAG.length) : t;
  const ds = new DecompressionStream("gzip");
  const buf = await new Response(new Blob([b64ToBytes(body.replace(/\s+/g, ""))]).stream().pipeThrough(ds)).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}
/* 控えの欄を書きかえる。押している最中の欄は触らない。 */
function paintBackup() {
  const t = $("#backup");
  if (!t || document.activeElement === t) return;
  packBackup(st).then(s2 => { if (document.activeElement !== t) t.value = s2; });
}

/* ---------- settings ---------- */
$("#userName").addEventListener("input", e => { st.user = e.target.value; save(); });
$("#copyBk").addEventListener("click", async () => {
  const t = $("#backup");
  try { await navigator.clipboard.writeText(t.value); setMsg("コピーしました"); }
  catch (e) { t.removeAttribute("readonly"); t.select(); t.setSelectionRange(0, 999999); setMsg("選択しました。長押しでコピーしてください"); t.setAttribute("readonly", ""); }
});
$("#showRestore").addEventListener("click", () => { const b = $("#restoreBox"); b.hidden = !b.hidden; });
$("#doRestore").addEventListener("click", async () => {
  const keep = st;   // 失敗したときに戻すための控え
  try {
    const o = await unpackBackup($("#restoreIn").value);   // 圧縮したものも、昔の生のJSONも
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
  barDark = t === "dark";
  if (t === "auto" && window.matchMedia) barDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  paintBar();
}
/* iPhoneのステータスバーの色。ホーム画面に追加したアプリでは、この meta か
   ページの中身から色が決まる。下から出るシートを開いているあいだは、後ろを暗くする
   覆いと同じ色にそろえ、閉じたら元へ戻す。「閉じたら必ず塗り直させる」のが目的。
   右から出るパネルは画面いっぱいの別ページなので、暗くはしない。 */
let barDark = false;
function paintBar() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const dim = $$(".sheet.on:not(.side)").length > 0;
  m.setAttribute("content", barDark
    ? (dim ? "#090914" : "#0d1020")     // 覆い rgba(10,8,20,.5) を重ねた色
    : (dim ? "#7f7f88" : "#f3f5fc"));
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
  if ($("#remOff")) $("#remOff").hidden = canNotify();
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
    ? "予定とくりかえし通知を、時間になったら知らせます。"
    : "オンにすると、端末が一度だけ許可をたずねます。");
  test.hidden = !on;
  $("#notifyTest2").hidden = !on;
  paintPingLog();
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
$("#notifyTest2").addEventListener("click", async () => {
  testAt = Date.now() + 60 * 1000;
  $("#notifyTest2").disabled = true;
  const n = await syncNow();
  const g = readPingLog();
  if (g && g.err) { $("#notifyTest2").disabled = false; testAt = 0; setMsg("サーバーへ送れませんでした", true); return; }
  setMsg("1分後に鳴らします。アプリを閉じて待ってみてください。");
  setTimeout(() => { $("#notifyTest2").disabled = false; testAt = 0; }, 90 * 1000);
  return n;
});
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

/* くりかえし通知が次に鳴る日を、この先 REM_DAYS 日ぶん数える。
   n日おきは「起点の日から数えて n の倍数の日」。曜日えらびは、その曜日の日。 */
const REM_DAYS = 30;
function remDays(r, from) {
  const out = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const anchor = new Date(r.from + "T00:00");
  for (let i = 0; i < REM_DAYS; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    let hit = false;
    if (r.rule === "daily") hit = true;
    else if (r.rule === "week") hit = r.days.includes(d.getDay());
    else {
      const gap = Math.round((d - anchor) / 86400000);
      hit = gap >= 0 && gap % r.n === 0;
    }
    if (hit) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(),
      +r.time.slice(0, 2), +r.time.slice(3)));
  }
  return out;
}
/* 次に鳴る日時（過ぎたものは飛ばす）。無ければ null */
function remNext(r, now) {
  const t = (now || new Date()).getTime();
  return remDays(r, new Date(t)).find(d => d.getTime() > t) || null;
}

/* サーバーへ送った状況。この端末だけのことなので、バックアップ（st）には入れない。
   失敗しても前は何も出なかったので、ここに残して通知画面に見せる。 */
const PING_LOG = "celestia-ping-log";
function readPingLog() { try { return JSON.parse(localStorage.getItem(PING_LOG) || "null"); } catch (e) { return null; } }
function writePingLog(v) { try { localStorage.setItem(PING_LOG, JSON.stringify(v)); } catch (e) {} paintPingLog(); }
const whenText = d => (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
function paintPingLog() {
  const el = $("#pingState"); if (!el) return;
  const g = readPingLog();
  if (!canNotify()) { el.textContent = ""; return; }
  if (!g) { el.textContent = "まだサーバーへ送っていません。"; return; }
  if (g.err) { el.textContent = "送れませんでした（" + whenText(new Date(g.at)) + "）。電波のあるところで開き直すと、もう一度送ります。"; return; }
  el.textContent = g.n
    ? "サーバーに" + g.n + "件あずけています。次は " + whenText(new Date(g.next)) + "（送ったのは " + whenText(new Date(g.at)) + "）"
    : "いま鳴らす予定はありません（送ったのは " + whenText(new Date(g.at)) + "）";
}
/* サーバーを通して1分後に鳴らす試し。端末→サーバー→通知の全部を通る。 */
let testAt = 0;

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
  // くりかえし通知のぶんも同じ棚に並べる
  st.reminders.forEach(r => {
    remDays(r, new Date(now)).forEach(d => {
      if (d.getTime() > now) rows.push({ owner: owner, event_id: r.id,
        day_key: keyOf(d), fire_at: d.toISOString() });
    });
  });
  if (testAt > now) rows.push({ owner: owner, event_id: "test-" + testAt,
    day_key: keyOf(new Date(testAt)), fire_at: new Date(testAt).toISOString() });
  rows.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
  const send = rows.slice(0, 200);
  await sbWrite("pings?owner=eq." + owner, "DELETE");
  if (send.length) await sbWrite("pings", "POST", send);
  writePingLog({ at: Date.now(), n: send.length, next: send[0] ? send[0].fire_at : "" });
  return send.length;
}
/* いますぐ送る。失敗は捨てずに記録する。 */
function syncNow() {
  clearTimeout(pingTimer); pingTimer = null;
  if (!canNotify()) return Promise.resolve(0);
  return syncPings().catch(e => { writePingLog({ at: Date.now(), err: String(e && e.message || e) }); return 0; });
}
/* 保存のたびに呼ばれる。まとめて少し待ってから送る（打つたびに通信しないため）。 */
let pingTimer = null;
function pingsLater() {
  if (!canNotify()) return;
  clearTimeout(pingTimer);
  pingTimer = setTimeout(syncNow, 2000);
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
paintPass();
renderRem();
mirror();
paintNotify();
syncNow();
updateSpeech(new Date());
render();
let lastDay = keyOf(new Date());
setInterval(() => {
  const k = keyOf(new Date());
  if (k !== lastDay) { lastDay = k; const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); }
  updateSpeech(new Date());
  render();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // ほかのアプリへ移った・画面を消した＝ここが「閉じた」。開けてあった鍵はかけ直す。
    // iPhoneのホーム画面アプリは切りかえても動いたままなので、ここで戻さないと開きっぱなしになる。
    unlocked = false; memoSig = "";
    return;
  }
  updateSpeech(new Date()); render();
  syncNow();   // 戻ってきたら、端末の中身とサーバーを合わせ直す（離れる前の送り損ねもここで拾う）
});

/* ---------- service worker ---------- */
/* オフラインで開けるようにする。file: で直接開いたときは働かないので何もしない。 */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js")
    .then(reg => reg.update())
    .catch(() => {});
}
