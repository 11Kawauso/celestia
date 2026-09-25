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
const CHARA_IMG = "chara/celestia.jpg";
/* レベルの上限。ここまで来ると、セレスティアが本名を明かす（地上では天使はみな「セレスティア」と名乗り、
   個人の名は天界でしか使わない。名の由来はセラフィム＝熾天使）。 */
const MAX_LV = 100;
const TRUE_NAME = "セラ・セレスティア";
const charaName = lv => (lv >= MAX_LV ? TRUE_NAME : CHARA);

/* ---------- state ---------- */
function seed() {
  return {
    v: 2,
    chara: { level: 1, exp: 0 },
    user: "",
    missions: [
      wakeMission(uid(), WAKE_DEFAULT)
    ],
    goals: [], memo: [], reminders: [],
    events: {}, log: {}, mood: {}, theme: "auto", notify: false
  };
}
/* 保存データを今の形にそろえる。古い版から来たものも、手で書きかえられたものも
   ここを通る。中身は捨てずに、型だけを直す。ここで数値・日付・時刻をきちんと
   絞っておくことが、描画側が変なものを掴まない一番の守りになる。 */
/* 早起きミッションは4つの時刻からえらぶ。EXPは時刻で決まり、早いほど多い。
   タイトル・曜日・時間のしばりも時刻から自動で決まるので、保存時に組み立てる。 */
/* pt は「今週の早起き」の点数。その日に受け取ったときの時刻で決まる（st.wakeT に残す）。 */
const WAKE = [
  { time: "06:00", exp: 500, pt: 4 },
  { time: "07:00", exp: 350, pt: 3 },
  { time: "08:00", exp: 200, pt: 2 },
  { time: "09:00", exp: 100, pt: 1 }
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

/* その日の調子。その日はじめて開いたときに選んで、カレンダーに残す。
   自分で選ぶだけのものなので、EXPは付けない（押すだけでレベルが上がってしまうため）。
   img にセレスティアの顔の絵のパスを入れると、絵文字の代わりにそれが出る（例："chara/mood-best.png"）。
   k は保存に使う名前なので、あとから変えない。並びは画面の並び。 */
const MOOD = [
  { k: "best",   label: "最高", emoji: "😆", img: "" },
  { k: "good",   label: "良い", emoji: "🙂", img: "" },
  { k: "normal", label: "普通", emoji: "😐", img: "" },
  { k: "bad",    label: "悪い", emoji: "😞", img: "" },
  { k: "worst",  label: "最悪", emoji: "😫", img: "" },
  { k: "sick",   label: "病気", emoji: "🤒", img: "" }
];
const moodOf = k => MOOD.find(x => x.k === k) || null;
const MOOD_FROM = 5;   // 窓を自分から出すのは朝5時から（夜ふかしで0時をまたいだときに、翌日の調子を聞かないように）

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
    level: Math.min(MAX_LV, Math.max(1, Math.floor(asNum(c.level, 1)))),
    exp: asNum(c.level, 1) >= MAX_LV ? 0 : Math.max(0, Math.floor(asNum(c.exp, 0)))   // 上限ではEXPを溜めない
  };
  o.user = asStr(o.user).slice(0, 40);
  o.bdayGift = Math.max(0, Math.floor(asNum(o.bdayGift, 0)));   // 誕生日のプレゼントを最後に受け取った年
  o.birthday = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(o.birthday) ? o.birthday : "";   // "MM-DD"。年は持たない
  o.say = asStr(o.say);                      // 直前に言ったセリフ
  const sd = asObj(o.said); o.said = {};     // 場面ごとに、最後に出した日
  Object.keys(sd).forEach(k => { if (typeof sd[k] === "string") o.said[k] = sd[k]; });
  o.theme = ["auto", "dark", "light"].indexOf(o.theme) >= 0 ? o.theme : "auto";

  /* ミッションは早起きの1つだけ。自分で「やった」と申告するだけのミッションは、
     押すだけでレベルが上がってしまうので置かない（昔作ったものはここで捨てる。達成の記録は残る）。
     早起きは中身をすべて時刻から作り直す。手で書きかえられてもずれない。 */
  const wake = asArr(o.missions).map(asObj).find(m => m.type === "wake");
  o.missions = [wake ? wakeMission(asStr(wake.id) || uid(), asStr(wake.time)) : wakeMission(uid(), WAKE_DEFAULT)];

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

  /* メモ。タイトルと本文だけ。足した順に並べて持つ。
     昔の書庫にあったフォルダと画像は捨て、フォルダの中にあったメモは一覧にそのまま並べる。 */
  o.memo = asArr(o.memo).map(asObj).filter(m => !m.kind || m.kind === "note").map(m => ({
    id: asStr(m.id) || uid(),
    name: asStr(m.name).slice(0, 120),
    body: asStr(m.body),
    at: asDate(m.at)
  }));

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

  // その日の調子。日付 → MOOD の k。知らない値は捨てる
  const md0 = asObj(o.mood); o.mood = {};
  Object.keys(md0).forEach(k => { if (asDate(k) && moodOf(md0[k])) o.mood[k] = md0[k]; });
  o.moodAsked = asDate(o.moodAsked);   // 調子の窓を最後に自分から出した日（閉じられても、その日はもう出さない）
  o.epRead = asArr(o.epRead).filter(x => typeof x === "string");   // 最後まで読んだエピソードの id

  // 「今週の早起き」の報酬を受け取った週（その週の月曜の日付）
  o.wkClaim = asArr(o.wkClaim).map(asDate).filter(Boolean);
  // 早起きを受け取った日の、そのときの時刻（週の点数に使う）。これが無い昔の日は、いまの時刻で数える
  const wt = asObj(o.wakeT); o.wakeT = {};
  Object.keys(wt).forEach(k => { if (asDate(k) && WAKE.some(w => w.time === wt[k])) o.wakeT[k] = wt[k]; });

  /* 始めた日。記録タブの「◯日目」の起点。
     これを持っていない古いデータは、残っている記録のいちばん古い日を始めた日とみなす。 */
  const seen = Object.keys(o.log).concat(o.memo.map(m => m.at), o.goals.map(g => g.doneAt))
    .map(asDate).filter(Boolean);
  o.since = asDate(o.since) || seen.concat(keyOf(new Date())).sort()[0];

  o.notify = !!o.notify;      // 通知を使うか（端末の許可とは別に、こちらでも持つ）
  o.v = 2;
  delete o.todos; delete o.help; delete o.pass;   // pass は昔の書庫のパスワード
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
/* ランクは4つ。区切りは口調・呼び方の段階（notify-lines.js の tone）とそろえてある。
   並びは天使の位の順（大天使 < 力天使 < 熾天使）。最後の熾天使は、セラの名の由来。 */
function rankOf(lv) {
  if (lv >= 91) return "熾天使";
  if (lv >= 61) return "力天使";
  if (lv >= 31) return "大天使";
  return "見習い天使";
}
/* EXPを足す。上限（MAX_LV）に着いたら、それより上には上がらず、EXPも溜めない。
   戻り値は「この一回で上限に着いたか」。本名を明かすセリフに切りかえるのに使う。 */
function addExp(n) {
  const c = st.chara; c.exp += n; let up = 0;
  while (c.level < MAX_LV && c.exp >= need(c.level)) { c.exp -= need(c.level); c.level++; up++; }
  if (c.level >= MAX_LV) c.exp = 0;
  while (c.exp < 0 && c.level > 1) { c.level--; c.exp += need(c.level); }
  if (c.exp < 0) c.exp = 0;
  if (up > 0) levelUp();
  return up > 0 && c.level >= MAX_LV;
}
let luTimer = null;
function levelUp() {
  $("#luNum").textContent = st.chara.level;
  $("#luSub").textContent = st.chara.level >= MAX_LV
    ? "私の名は、セラ ／ " + rankOf(st.chara.level)   // 上限に着いたときだけ、本名を明かす
    : callName(st.chara.level) + "、おめでとう ／ " + rankOf(st.chara.level);
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

/* ---------- 今週の早起き ---------- */
/* 月〜日の7日ぶん早起きできたら、まとめて報酬。
   寝坊した日（今日が時間切れになったときも）がひとつでもあれば、その週はもう達成できない。
   始める前の日が混じる週も数えない。受け取った週は、その月曜の日付を st.wkClaim に残す。 */
/* 週の報酬は、7日ぶんの点数の合計（7〜28点）で決まる。
   毎日同じ時刻でそろえたときに 9時1000 / 8時2000 / 7時3500 / 6時5000 になるように決め、
   あいだの点数はその間をまっすぐつなぐ（10の位で丸める）。 */
const WEEK_EXP_AT = [[7, 1000], [14, 2000], [21, 3500], [28, 5000]];
function weekExp(pt) {
  for (let i = 1; i < WEEK_EXP_AT.length; i++) {
    const [p0, e0] = WEEK_EXP_AT[i - 1], [p1, e1] = WEEK_EXP_AT[i];
    if (pt <= p1) return Math.round((e0 + (e1 - e0) * (Math.max(pt, p0) - p0) / (p1 - p0)) / 10) * 10;
  }
  return WEEK_EXP_AT[WEEK_EXP_AT.length - 1][1];
}
const WEEK_MAX = weekExp(28);
const mondayOf = d => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - (m.getDay() + 6) % 7); return m; };
/* 1週ぶんの様子。days の s は done（起きた）／miss（寝坊）／today（今日、まだ間に合う）／
   future（これから）／pre（始める前）。state は受け取りボタンの状態（claimState と同じ言葉）。 */
function weekInfo(mon, now) {
  const w = st.missions.find(m => m.type === "wake"), tk = keyOf(now);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(d.getDate() + i);
    const k = keyOf(d);
    const s = k < st.since ? "pre"
      : doneOn(w.id, k) ? "done"
      : k < tk || (k === tk && claimState(w, now, false) === "late") ? "miss"
      : k === tk ? "today" : "future";
    days.push({ d: d, s: s, pt: s === "done" ? wakeAt(st.wakeT[k] || w.time).pt : 0 });
  }
  const mk = keyOf(mon), pt = days.reduce((a, x) => a + x.pt, 0);
  const state = st.wkClaim.includes(mk) ? "done"
    : days.every(x => x.s === "done") ? "ready"
    : days.some(x => x.s === "miss" || x.s === "pre") ? "late" : "lock";
  return { mk: mk, days: days, state: state, last: false, pt: pt, exp: weekExp(pt) };
}
/* 画面に出す週。先週をそろえたのに受け取り忘れていたら、月曜になってもそちらを先に出す */
function weekShown(now) {
  const mon = mondayOf(now), prev = new Date(mon);
  prev.setDate(prev.getDate() - 7);
  const lw = weekInfo(prev, now);
  if (lw.state === "ready") { lw.last = true; return lw; }
  return weekInfo(mon, now);
}
const WEEK_LABEL = { done: "受け取り済み", ready: "報酬を受け取る", late: "達成ならず", lock: "未クリア" };
function renderWeek(now) {
  const wk = weekShown(now);
  $("#weekTitle").textContent = wk.last ? "先週の早起き" : "今週の早起き";
  // そろったら、その週の点数での報酬。まだなら、いちばん多くもらえる額（6時で7日）
  $("#weekExp").textContent = wk.state === "ready" || wk.state === "done" ? "EXP+" + wk.exp : "最大 EXP+" + WEEK_MAX;
  // 起きた日は、その日の点数を金の丸に入れる
  $("#weekCells").innerHTML = wk.days.map(x =>
    '<div class="wkday ' + x.s + '"><span>' + DOW[x.d.getDay()] + "</span><i>" +
    (x.s === "done" ? x.pt : x.s === "miss" ? "×" : x.s === "pre" ? "−" : "") + "</i></div>").join("");
  const miss = wk.days.find(x => x.s === "miss");
  const left = wk.days.filter(x => x.s === "today" || x.s === "future").length;
  $("#weekMsg").textContent =
    wk.state === "done" ? "達成しました（" + wk.pt + "点）。また月曜から。"
    : wk.state === "ready" ? "7日そろいました。" + wk.pt + "点です。"
    : wk.state === "lock" ? "あと" + left + "日（いま" + wk.pt + "点）"
    : miss ? DOW[miss.d.getDay()] + "曜に寝坊したので、今週は達成できません。月曜からまた挑戦できます。"
    : "始める前の日があるので、今週は数えません。月曜から挑戦できます。";
  const b = $("#weekClaim");
  b.className = "claim " + wk.state;
  b.textContent = WEEK_LABEL[wk.state];
  b.dataset.wk = wk.mk;
}

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
/* レベル＝親密度。上がるほど呼び方と口調がやわらぐ。上限は Lv100（MAX_LV）。
   区切りは rankOf のランクの境目にそろえてある。
     0: Lv1-30   見習い天使  「貴様」・冷たく見張る
     1: Lv31-60  大天使      名前で呼ぶ・そっけないが認めている
     2: Lv61-90  力天使      「ご主人」・硬いまま尽くす
     3: Lv91-100 熾天使      「ご主人様」・丁寧だが短く静か（Lv100 で本名「セラ」を明かす）
   文面を変えたいときは下の SPEECH だけ直せばよい。{you} は呼び方、{n} は残りの数。 */
/* 段階と呼び方の決まりは notify-lines.js に置いてある。
   通知（アプリが閉じていても出る）と同じものを使いたいので、そちらを本家にした。 */
function toneOf(lv) { return NOTIFY.tone(lv); }
function callName(lv) { return NOTIFY.you(lv, st.user); }
/* しゃべる場面。押した瞬間に出るものと、アプリを開いたときに出るものがある。
   開いたときに出るものは「その日はじめて条件を満たしたとき」に一度だけ。
   重なった日は、この並びの上にあるものだけが出る（並べ替えれば優先順が変わる）。 */
const OPEN_SCENES = [
  "birthday",   //   設定した誕生日に、はじめて開いた（ほかの何よりも先）
  "streakLost", //   早起きが時間切れ。しかも前の日まで STREAK_MIN 日以上続いていた
  "lateRun",    //   早起きが時間切れ。しかも今日で LATE_MIN 日続けて寝坊
  "wakeLate",   // 2 早起きが時間切れになってから、はじめて開いた（上のどちらでもないとき）
  "night",      // 4 21時〜0時に、はじめて開いた
  "midnight",   // 5 1時〜5時に、はじめて開いた
  "holiday"     // 7 土日・祝日に、はじめて開いた
];

/* セリフ表。口調4段階 × 場面。
   ・各場面は配列。いくつ足してもよく、その中から1つがランダムに選ばれる
   ・{you} は呼び方（貴様／名前／ご主人／ご主人様）、{n} は残りの数に置きかわる
   ・場面のキー
       first        はじめてアプリを開いたとき（1度だけ）
       wakeClaim    1 早起きの報酬を受け取った
       missionClaim 3 早起き以外の報酬を受け取った（今は早起きしか無いので出ない。ミッションを足したときのために残してある）
       weekClaim      今週の早起き（月〜日の7日）の報酬を受け取った
       goalDone     6 目標を達成した
       wakeLate     2 早起きが時間切れ
       streakMark     早起きを受け取って、連続日数が STREAK_MARKS のどれかに届いた（{n} は連続日数）
       birthday       設定した誕生日
       birthdayGift   誕生日のプレゼント（EXP）を受け取った
       streakLost     早起きが STREAK_MIN 日以上続いていたのに、今日は時間切れ（{n} は途切れた連続日数）
       lateRun        今日で LATE_MIN 日以上続けて寝坊（{n} は続いている日数）
       night        4 夜（21時〜0時）
       midnight     5 夜中（1時〜5時）
       holiday      7 土日・祝日
       mood_best 〜 mood_sick  今日の調子を選んだ（キーの後ろは MOOD の k）
       more         受け取りのセリフの後ろに足す（残りがあるときだけ）
       trueName     Lv100 に着いて、本名を明かす（段階3にだけある。ほかの段階では着かないため） */
const SPEECH = [
  /* 声は設定集のセラに合わせる：短く、低く、言い切る（〜だ／〜ん／〜しろ）。マスクのせいで声が小さいので「……」が多い。
     「〜わ」「〜ね」「〜なさい」は使わない。段階が上がっても硬さは残し、近さは言葉の中身で出す。 */
  { /* 0 見習い天使（Lv1-30）：貴様・冷たく、見張る側 */
    first:        ["……私はセレスティア。今日から貴様を見ている。",
                   "貴様が今日からの主か。……精々、励め。"],
    birthday:     ["……今日は{you}の生まれた日か。祝ってやらんこともない。",
                   "誕生日か。……寿命がひとつ進んだな。大事に使え。"],
    birthdayGift: ["……受け取れ。私からだ。礼はいらん。",
                   "持っていけ。……今日だけだぞ。"],
    wakeClaim:    ["……起きたか。持っていけ。",
                   "朝に間に合ったか。……それでいい。"],
    streakMark:   ["……{n}日続けて起きたか。少しは、見どころがある。",
                   "{n}日連続だ。……悪くない。"],
    missionClaim: ["……それくらいは当然だ。",
                   "受け取れ。"],
    weekClaim:    ["……七日、一度も寝坊しなかったか。認めてやる。",
                   "一週間、欠かさず起きたか。……持っていけ。"],
    goalDone:     ["やり遂げたか。……貴様にしては上出来だ。",
                   "……まぐれでないと、次で示せ。"],
    wakeLate:     ["寝坊か。……天罰を与えるほどでもない。",
                   "……もう間に合わん。明日は起きろ。"],
    streakLost:   ["……{n}日続いていたのに、ここで寝坊か。",
                   "{n}日の積み重ねを、一晩で崩したな。……明日、また積め。"],
    lateRun:      ["{n}日続けて寝坊だ。……{you}、天罰が欲しいのか。",
                   "……これで{n}日目だ。いいかげんにしろ。"],
    night:        ["今日は終わりだ。明日は起きろ、{you}。",
                   "夜だ。……さっさと休め。"],
    midnight:     ["{you}、まだ起きているのか。……寿命を削るな。",
                   "こんな時間に何をしている。寝ろ。"],
    holiday:      ["休みか。……だらけるなよ。",
                   "休みだろうと、朝は来る。分かっているな、{you}。"],
    mood_best:    ["……そうか。浮かれて足をすくわれるなよ。"],
    mood_good:    ["悪くないか。……ならば、励め。"],
    mood_normal:  ["普通か。……それでいい。"],
    mood_bad:     ["……そういう日もある。倒れるなよ、{you}。"],
    mood_worst:   ["最悪か。……今日を越えれば、それでいい。"],
    mood_sick:    ["……病か。寿命を縮めるな。今日は寝ていろ。"],
    more:         ["……あと{n}つ残っている。"] },

  { /* 1 大天使（Lv31-60）：名前で呼ぶ・そっけないが、認めている */
    first:        ["……{you}、か。覚えておこう。"],
    birthday:     ["{you}、誕生日だな。……おめでとう。",
                   "今日は{you}の生まれた日か。……一年、よく生きた。"],
    birthdayGift: ["受け取れ、{you}。……私からの祝いだ。",
                   "……たいしたものではない。だが、受け取ってくれ。"],
    wakeClaim:    ["{you}。今朝も起きたか。……それでいい。",
                   "おはよう、{you}。受け取れ。"],
    streakMark:   ["{n}日続いたな、{you}。……よくやっている。",
                   "連続{n}日だ。……見ていたぞ。"],
    missionClaim: ["よくやった、{you}。",
                   "……悪くない。持っていけ。"],
    weekClaim:    ["一週間、毎朝起きたな。……少し、見直した。",
                   "七日続けたか、{you}。受け取れ。"],
    goalDone:     ["やり遂げたな、{you}。……見ていた。",
                   "……よくやった。今日は休め。"],
    wakeLate:     ["寝坊か、{you}。……明日がある。",
                   "間に合わなかったな。……気にしすぎるな。"],
    streakLost:   ["{n}日続いていたのにな、{you}。……惜しい。",
                   "……途切れたか。{n}日分は、無駄にはならん。"],
    lateRun:      ["{n}日続けて寝坊だぞ、{you}。……何かあったのか。",
                   "これで{n}日目だ。……明日こそ、起きろ。"],
    night:        ["今日はもう休め、{you}。明日の朝に会おう。",
                   "夜だ。……無理はするな。"],
    midnight:     ["{you}、まだ起きているのか。……体に障る。",
                   "夜更かしはやめろ。……いいから、寝ろ。"],
    holiday:      ["今日は休みか。……たまには、ゆっくりしろ。",
                   "休みでも朝は来るぞ、{you}。"],
    mood_best:    ["{you}、調子がいいのか。……何よりだ。"],
    mood_good:    ["良い朝か、{you}。……その調子でいけ。"],
    mood_normal:  ["普通か。……普通の日を重ねるのが、いちばん強い。"],
    mood_bad:     ["……調子が悪いか。今日は、できることだけやれ。"],
    mood_worst:   ["そうか、{you}。……今日は、自分を責めるな。"],
    mood_sick:    ["病気か、{you}。……休め。治すことだけ考えろ。"],
    more:         ["あと{n}つある。"] },

  { /* 2 力天使（Lv61-90）：ご主人・硬い口調のまま、仕える側として尽くす */
    first:        ["{you}。……これからも、そばにいる。"],
    birthday:     ["誕生日おめでとう、{you}。……この日に会えて、うれしい。",
                   "{you}が生まれた日だな。……祝わせてくれ。"],
    birthdayGift: ["{you}、これは私から。……生まれてきてくれて、ありがとう。",
                   "受け取ってくれ。……来年も、祝わせてほしい。"],
    wakeClaim:    ["{you}、朝だ。……よく起きた。",
                   "おはよう、{you}。今朝も会えたな。"],
    streakMark:   ["{n}日連続だ、{you}。……誇っていい。",
                   "{you}、{n}日続けて会えている。……うれしい。"],
    missionClaim: ["見事だ、{you}。",
                   "……さすがだ。受け取ってくれ。"],
    weekClaim:    ["一週間、欠かさず起きたな。……誇っていい、{you}。",
                   "毎朝、{you}に会えた七日だった。……悪くなかった。"],
    goalDone:     ["やり遂げたな、{you}。……ずっと見ていた。",
                   "おめでとう。……私も、うれしい。"],
    wakeLate:     ["{you}、寝坊か。……そんな日もある。",
                   "間に合わなかったな。……無理はするな。"],
    streakLost:   ["{n}日も続いていたのに……。{you}、疲れていたのか。",
                   "途切れたな。……だが、{n}日続けたのは本当だ。"],
    lateRun:      ["{you}、{n}日続けて起きられていない。……体の具合が悪いのか。",
                   "{n}日目だな。……責めはしない。明日、また会おう。"],
    night:        ["{you}、今日はもう休んでくれ。明日の朝、待っている。",
                   "おやすみ、{you}。……夜は、私が見張っておく。"],
    midnight:     ["{you}、まだ起きているのか。……頼むから、休んでくれ。",
                   "こんな時間まで……。心配になる。"],
    holiday:      ["今日は休みだな。{you}は、何をして過ごす？",
                   "休みの日にも来てくれたのか。……うれしい。"],
    mood_best:    ["{you}の調子がいいと、……私もうれしい。"],
    mood_good:    ["良かった、{you}。……今日もそばにいる。"],
    mood_normal:  ["普通の日か。……それも、大事な一日だ。"],
    mood_bad:     ["{you}、つらいのか。……無理はしないでくれ。"],
    mood_worst:   ["……そうか。今日は何もできなくても、責めはしない。"],
    mood_sick:    ["{you}、休んでくれ。……死神は、私が近づけさせん。"],
    more:         ["あと{n}つ受け取れる。"] },

  { /* 3 熾天使（Lv91-100）：ご主人様・丁寧だが、短く静か */
    first:        ["{you}。……この身、あなたのそばに。"],
    birthday:     ["{you}、お誕生日おめでとうございます。……あなたが生まれた日に、感謝を。",
                   "今日は{you}のお生まれになった日。……この一年も、おそばにおります。"],
    birthdayGift: ["{you}、私からの贈り物です。……どうか、お受け取りください。",
                   "ささやかですが、お納めください。……あなたが生まれた日に。"],
    trueName:     ["{you}……私の名は、セラ。セラ・セレスティアと申します。地上で名乗るのは、これが初めてです。"],
    wakeClaim:    ["{you}。……おはようございます。今朝もお見事です。",
                   "{you}、どうぞお受け取りください。"],
    streakMark:   ["{you}、{n}日続けてのお目覚め。……お見事です。",
                   "連続{n}日。……あなたの積み重ねを、誇りに思います。"],
    missionClaim: ["見事です、{you}。",
                   "……さすがです。お納めください。"],
    weekClaim:    ["{you}、七日間、一日も欠かさず。……ご立派です。",
                   "この七日のお姿、しかと見届けました。お納めください。"],
    goalDone:     ["{you}、成し遂げられましたね。……心から、お祝いします。",
                   "あなたの歩みを、ずっと見ておりました。……おめでとうございます。"],
    wakeLate:     ["{you}、今朝はお休みでしたね。……お疲れが出たのでしょう。",
                   "今朝は間に合いませんでしたね。……お気になさらず。"],
    streakLost:   ["{n}日続けてこられたのに……。{you}、どうかご無理なさらず。",
                   "……途切れてしまいましたね。{n}日のお姿は、私が覚えております。"],
    lateRun:      ["{you}、{n}日続けてお休みになっていますね。……お体が心配です。",
                   "……{n}日目です。私はここで、お待ちしております。"],
    night:        ["{you}、今日はもうお休みください。夜は、私がお守りします。",
                   "おやすみなさいませ、{you}。また明日の朝に。"],
    midnight:     ["{you}、まだ起きていらしたのですか。……どうか、お休みください。",
                   "こんな時間まで……。お体に障ります。"],
    holiday:      ["{you}、今日はお休みですね。……ごゆるりと。",
                   "お休みの日にもお会いできて、うれしく思います。"],
    mood_best:    ["{you}、何よりです。……そのお顔が見られて、うれしく思います。"],
    mood_good:    ["それは良かった。……今日も、おそばに。"],
    mood_normal:  ["穏やかな一日になりますように、{you}。"],
    mood_bad:     ["{you}、ご無理なさらず。……私がついております。"],
    mood_worst:   ["……おつらいのですね。今日は、ただ息をしていてくだされば十分です。"],
    mood_sick:    ["{you}、どうかお休みください。……死神は、一歩も近づけさせません。"],
    more:         ["あと{n}つ、お受け取りいただけます。"] }
];

/* いま条件を満たしていて、その日まだ出していない場面を、優先順に並べて返す。 */
/* 寝坊のセリフを出し分けるしきい値。どちらも、ここを変えれば出る頻度が変わる。 */
const STREAK_MIN = 3;   // これだけ続いていた早起きが途切れたら streakLost
const LATE_MIN = 3;     // 今日を含めてこれだけ続けて寝坊したら lateRun
/* 今日を含めて、何日続けて早起きを逃しているか（始めた日より前は数えない） */
function lateRunOf(m, now) {
  const d = new Date(now); let n = 0;
  for (let i = 0; i < 400; i++) {
    const k = keyOf(d);
    if (k < st.since || doneOn(m.id, k)) break;
    n++; d.setDate(d.getDate() - 1);
  }
  return n;
}
/* 早起きの連続が、この日数に届いたら褒める */
const STREAK_MARKS = [7, 14, 30, 50, 100, 200, 365, 500, 730, 1000];
/* 今日が誕生日か。2月29日生まれは、うるう年でない年は2月28日に祝う */
function isBirthday(now) {
  if (!st.birthday) return false;
  const md = pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  if (md === st.birthday) return true;
  const y = now.getFullYear(), leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return st.birthday === "02-29" && md === "02-28" && !leap;
}
/* 誕生日のプレゼント。その日のあいだだけ、セリフの右端にボタンが出る。
   受け取れるのは1年に1回（誕生日の設定を毎日「今日」に変えて、何度ももらえないように）。 */
const BDAY_GIFT = 1000;
const giftReady = now => isBirthday(now) && st.bdayGift !== now.getFullYear();
let sceneN = {};   // 場面ごとの {n}（途切れた日数・寝坊の日数）。scenesDue が入れる
function scenesDue(now) {
  const w = st.missions.find(m => m.type === "wake");
  const h = now.getHours(), dow = now.getDay();
  const late = !!w && claimState(w, now, false) === "late";
  // 今日は受け取っていないので、streakOf は「きのうまで何日続いていたか」を返す
  const was = late ? streakOf(w) : 0, run = late ? lateRunOf(w, now) : 0;
  sceneN = { streakLost: was, lateRun: run };
  const due = {
    birthday: isBirthday(now),
    streakLost: late && was >= STREAK_MIN,
    lateRun:  late && run >= LATE_MIN,
    wakeLate: late,
    night:    h >= 21,               // 21時〜0時
    midnight: h >= 1 && h < 5,       // 1時〜5時
    holiday:  dow === 0 || dow === 6 || !!holidayName(now)
  };
  const today = keyOf(now);
  return OPEN_SCENES.filter(k => due[k] && st.said[k] !== today);
}
/* セリフを1つ選んで覚える。次の場面が来るまでこれが出つづける。 */
function say(scene, now, tail, n) {
  const lv = st.chara.level;
  const list = SPEECH[toneOf(lv)][scene];
  if (!list || !list.length) return;
  let line = list[Math.floor(Math.random() * list.length)] + (tail || "");
  st.say = line.replace(/\{you\}/g, callName(lv)).replace(/\{n\}/g, n == null ? "" : n);
  st.said[scene] = keyOf(now);
  save();
}
/* いま受け取れる報酬の数（今日のミッション＋今週の早起き）。
   ホーム右上のミッションボタンと、受け取りのセリフの「あと◯つ」で使う。 */
const readyCount = now => st.missions
  .filter(m => m.days.includes(now.getDay()))
  .filter(m => claimState(m, now, false) === "ready").length +
  (weekShown(now).state === "ready" ? 1 : 0);   // 日曜の早起きで、週の報酬も受け取れるようになる
/* 受け取りのセリフに足す「あと◯つ」。残っていなければ空。 */
function moreTail(now) {
  const left = readyCount(now);
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
  say(due[0], now, "", sceneN[due[0]]);
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
  $("#cname").textContent = charaName(c.level);   // Lv100 で本名になる
  $("#rank").textContent = rankOf(c.level);
  $("#lvnum").textContent = c.level;
  const nd = need(c.level);
  const C = 2 * Math.PI * 47;
  const maxed = c.level >= MAX_LV;
  const p = maxed ? 1 : Math.max(0, Math.min(1, c.exp / nd));   // 上限では輪を満たしたままにする
  // 輪は大（パネルの中）と小（ホーム右上）のふたつ。どちらも同じ値で動かす
  $$(".rfill").forEach(r => {
    r.setAttribute("stroke-dasharray", C.toFixed(1));
    r.setAttribute("stroke-dashoffset", (C * (1 - p)).toFixed(1));
  });
  $("#minilv").textContent = c.level;
  // 棘は、輪の光が自分の位置を通りすぎたぶんだけ金色になる（レベルが上がればまた消える）
  $$(".spikes path").forEach(sp => sp.classList.toggle("on", p >= +sp.dataset.at));
  $("#expnow").textContent = maxed ? "MAX" : c.exp + " / " + nd + " EXP";
  $("#expneed").textContent = maxed ? "最大レベル" : "次のレベルまで あと " + (nd - c.exp);

  // キャラの絵とセリフ
  // 枠の高さは絵に合わせて決まるので、毎分の描き直しで作り直さない（一瞬つぶれて画面が跳ねる）
  const pt = $("#portrait");
  if (pt.dataset.img !== CHARA_IMG) {
    pt.dataset.img = CHARA_IMG;
    pt.classList.toggle("hasimg", !!CHARA_IMG);
    pt.innerHTML = CHARA_IMG
      ? '<img src="' + esc(CHARA_IMG) + '" alt="' + CHARA + '">'
      : '<span class="rune">' + CHARA[0] + "</span>";
  }
  $("#speech").textContent = st.say;
  $("#giftBtn").hidden = !giftReady(now);
  // 受け取れる報酬があるときだけ、ゲージの下にミッションボタンを出す（毎分の描き直しで、朝5時になれば出る）
  $("#openMission").hidden = !readyCount(now);
  // 読めるようになったのにまだ読んでいないエピソードがあれば、ボタンに赤い点
  $("#openEpisode").classList.toggle("new", EPISODES.some(epNew));
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
    : '<div class="empty">今日のミッションはありません。</div>';
  ml.style.display = "flex"; ml.style.flexDirection = "column"; ml.style.gap = "9px";
  renderWeek(now);

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
  paintBday(); paintBdayLock();
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

/* ---------- カレンダー ---------- */
/* 月は横一列の帯に並べてあり、指でなぞると端末のスクロールそのままに流れる。
   強くはらえば勢いで何か月か進み、止まるときは月の区切りにぴたりと合う（style.css の scroll-snap）。
   並べるのは今月の前後 CAL_SPAN か月ずつ。中身を描くのは見ている月のまわり（前後 CAL_NEAR）だけで、
   ほかは近づいたときに描く。見出し「2026年 9月」と曜日も月ごとに持つので、いっしょに流れる。 */
const CAL_SPAN = 24, CAL_NEAR = 2;
const calStrip = $("#calStrip");
let calBase = null, calIdx = CAL_SPAN, calVer = 0;   // calBase は帯の左端の月。calVer が変わったら描き直す
let calY, calM;
const calMonthAt = i => { const d = new Date(calBase.getFullYear(), calBase.getMonth() + i, 1); return [d.getFullYear(), d.getMonth()]; };
const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
/* 帯を作り直す。今月をまん中に置く（起動したときと、日付が変わったとき） */
function buildCal() {
  const n = new Date();
  calBase = new Date(n.getFullYear(), n.getMonth() - CAL_SPAN, 1);
  let html = "";
  for (let i = 0; i <= CAL_SPAN * 2; i++) html += '<div class="calpage" data-i="' + i + '"></div>';
  calStrip.innerHTML = html;
  calIdx = CAL_SPAN; [calY, calM] = calMonthAt(calIdx);
  calVer++;
  drawCalNear();
  calToIdx(calIdx, false);
}
/* 見ている月の位置へ帯を合わせる。タブを開いたとき、幅が変わったとき、‹ › で送るとき */
function calToIdx(i, smooth) {
  i = Math.max(0, Math.min(CAL_SPAN * 2, i));
  const w = calStrip.clientWidth; if (!w) return;   // タブが隠れているあいだは幅が無い。開いたときに合わせる
  calStrip.scrollTo({ left: i * w, behavior: smooth ? "smooth" : "auto" });
}
/* 見ている月のまわりで、古くなっている月だけ描き直す */
function drawCalNear() {
  for (let i = calIdx - CAL_NEAR; i <= calIdx + CAL_NEAR; i++) {
    const p = calStrip.children[i];
    if (!p || +p.dataset.v === calVer) continue;
    const [y, m] = calMonthAt(i);
    p.innerHTML = calPageHtml(y, m);
    p.dataset.v = calVer;
  }
}
/* データが変わったとき（予定を足した、受け取ったなど）に呼ぶ。遠くの月は近づいたときに描き直す */
function renderCal() {
  if (!calBase) { buildCal(); return; }
  calVer++;
  drawCalNear();
}
const CAL_DOW = DOW.map((d, i) =>
  '<div class="dow ' + (i === 0 ? "sun" : i === 6 ? "sat" : "") + '">' + d + "</div>").join("");
/* 1か月ぶん。見出し・曜日・日のマス（いつも6行42マス） */
function calPageHtml(calY, calM) {
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
    const mo = moodOf(st.mood[k]);
    html += '<button class="cell' + (k === tk ? " now" : "") + '" data-act="day" data-k="' + k + '">' +
      '<span class="d' + dc + '">' + day + "</span>" +
      (dots ? '<span class="dots">' + dots + "</span>" : "") +
      (mo ? moodFace(mo, "cmood") : "") +
      (doneN ? '<span class="mini"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>' : "") +
      "</button>";
  }
  // 月によって行数が変わると下のヘルプボタンが動くので、いつも6行（42マス）にそろえる
  for (let i = first.getDay() + last.getDate(); i < 42; i++) html += '<div class="cell pad"></div>';
  return '<div class="calmon">' + calY + "年 " + (calM + 1) + "月</div>" +
    '<div><div class="grid">' + CAL_DOW + '</div><div class="grid calgrid" style="margin-top:4px">' + html + "</div></div>";
}
/* 流れているあいだ、いま見ている月（calY / calM）を追いかけ、近くの月を描いておく */
calStrip.addEventListener("scroll", () => {
  const w = calStrip.clientWidth; if (!w) return;
  const i = Math.round(calStrip.scrollLeft / w);
  if (i === calIdx) return;
  calIdx = i; [calY, calM] = calMonthAt(i);
  closePop();
  drawCalNear();
}, { passive: true });
window.addEventListener("resize", () => calToIdx(calIdx, false));
$("#prevM").addEventListener("click", () => calToIdx(calIdx - 1, !reduceMotion()));
$("#nextM").addEventListener("click", () => calToIdx(calIdx + 1, !reduceMotion()));

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
    return '<button class="rbar' + (pre ? " pre" : "") + '" data-k="' + k + '"' +
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
  const b = k && $('#recBars .rbar[data-k="' + k + '"]');
  $("#recBars").classList.toggle("picking", !!b);
  $$("#recBars .rbar").forEach(x => x.classList.toggle("sel", x === b));
  $("#recPick").innerHTML = b
    ? esc(b.getAttribute("aria-label")).replace(/(\d+)回$/, "<b>$1</b>回")
    : "この30日で <b>" + recTotal + "</b>回";
}
$("#recBars").addEventListener("click", e => {
  const b = e.target.closest(".rbar"); if (!b || b.disabled) return;
  recSel = recSel === b.dataset.k ? null : b.dataset.k;   // 同じ棒をもう一度おすと戻る
  paintRecPick();
});
// マウスは乗せるだけで見られるように。離れたら、押して選んだ棒（無ければ合計）に戻る
$("#recBars").addEventListener("pointerover", e => {
  if (e.pointerType !== "mouse") return;
  const b = e.target.closest(".rbar");
  recHover = b && !b.disabled ? b.dataset.k : null; paintRecPick();
});
$("#recBars").addEventListener("pointerleave", e => {
  if (e.pointerType !== "mouse") return;
  recHover = null; paintRecPick();
});
$("#recPrev").addEventListener("click", () => { recOff += 7; recSel = null; renderRec(); });
$("#recNext").addEventListener("click", () => { recOff = Math.max(0, recOff - 7); recSel = null; renderRec(); });

/* ---------- メモ ---------- */
/* タイトルと本文だけのメモ。押すと編集の窓が開き、消すのもその窓から。 */
let mEditing = null;
const ICO_NOTE = '<svg viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h4"/></svg>';
const memoOf = id => st.memo.find(x => x.id === id);

function renderMemo() {
  const list = st.memo.slice().reverse();   // 足した順に持っているので、逆にすれば新しいものが上
  $("#memoList").innerHTML = list.length ? list.map(m =>
    '<div class="row" data-id="' + esc(m.id) + '">' +
    '<span class="mico">' + ICO_NOTE + "</span>" +
    '<div class="rowbody"><div class="rowtitle">' + esc(m.name || "名前のないメモ") + "</div>" +
    (m.body ? '<div class="mbody">' + esc(m.body) + "</div>" : "") +
    "</div></div>").join("") : '<div class="empty">まだメモはありません。</div>';
}

function openMemoEdit(id) {
  const m = id ? memoOf(id) : null;
  mEditing = m ? m.id : null;
  $("#mmHead").textContent = m ? "メモ" : "メモを書く";
  $("#mmName").value = m ? m.name : "";
  $("#mmBody").value = m ? m.body : "";
  $("#mmDelete").hidden = !m;
  openSheet("#sheetMEdit");
  if (!m) setTimeout(() => $("#mmName").focus(), 60);
}
$("#memoAdd").addEventListener("click", () => openMemoEdit(null));
$("#memoList").addEventListener("click", e => {
  const r = e.target.closest(".row[data-id]"); if (r) openMemoEdit(r.dataset.id);
});
$("#mmCancel").addEventListener("click", () => closeSheet("#sheetMEdit"));
$("#mmSave").addEventListener("click", () => {
  const name = $("#mmName").value.trim(), body = $("#mmBody").value;
  if (!name && !body) return;                          // どちらも空なら何もしない
  const m = mEditing && memoOf(mEditing);
  if (m) { m.name = name; m.body = body; }
  else st.memo.push({ id: uid(), name: name, body: body, at: keyOf(new Date()) });
  save(); renderMemo(); closeSheet("#sheetMEdit");
});
/* 消す前に確認の小窓を出す（アプリのほかの場所と同じやり方）。 */
$("#mmDelete").addEventListener("click", () => {
  const m = memoOf(mEditing); if (!m) return;
  askConfirm("このメモを消しますか", m.name || "名前のないメモ", () => {
    st.memo = st.memo.filter(x => x.id !== m.id);
    save(); renderMemo(); closeSheet("#sheetMEdit");
  });
});

/* ---------- 今日の調子 ---------- */
/* その日はじめて開いたとき（朝5時から）に、真ん中の窓で聞く。閉じられたら、その日はもう聞かない。
   選びそこねた日や選び直したい日は、カレンダーの日の画面からいつでも選べる（先の日は選べない）。 */
const moodFace = (mo, cls) => mo.img
  ? '<img class="mface ' + cls + '" src="' + esc(mo.img) + '" alt="">'
  : '<span class="mface ' + cls + '" aria-hidden="true">' + mo.emoji + "</span>";
const moodButtons = cur => MOOD.map(mo =>
  '<button class="moodbtn' + (mo.k === cur ? " on" : "") + '" data-mood="' + mo.k + '" aria-pressed="' + (mo.k === cur) + '">' +
  moodFace(mo, "") + "<span>" + mo.label + "</span></button>").join("");

function maybeAskMood(now) {
  const k = keyOf(now);
  if (keepOld || st.mood[k] || st.moodAsked === k || now.getHours() < MOOD_FROM) return;
  if ($(".sheet.on")) return;            // 何か開いて触っている途中なら割りこまない（次の機会に聞く）
  st.moodAsked = k; save();
  $("#moodPick").innerHTML = moodButtons("");
  openSheet("#sheetMood");
}
/* 調子を決める（null なら消す）。今日の分を決めたときだけ、セレスティアがひとこと返す。
   ただし、はじめて開いた日は最初のあいさつを残したいので、返さない。 */
function setMood(k, v) {
  const now = new Date();
  if (v) st.mood[k] = v; else delete st.mood[k];
  if (v && k === keyOf(now) && st.said.first !== k) say("mood_" + v, now);
  save(); render();
}
$("#moodPick").addEventListener("click", e => {
  const b = e.target.closest("[data-mood]"); if (!b) return;
  setMood(keyOf(new Date()), b.dataset.mood);
  closeSheet("#sheetMood");
});
$("#moodLater").addEventListener("click", () => closeSheet("#sheetMood"));
$("#dMood").addEventListener("click", e => {
  const b = e.target.closest("[data-mood]"); if (!b) return;
  setMood(dayKey, st.mood[dayKey] === b.dataset.mood ? null : b.dataset.mood);   // 同じものをもう一度押すと消える
  paintDay();
});

/* ---------- エピソード ---------- */
/* セラとの短い日常会話。レベルが lv に届くと読めるようになる。何度でも読み返せる。
   EXPは付けない。最後まで読んだものだけ st.epRead に残し、「NEW」と赤い点を消す。
   id は既読の記録に使うので、あとから変えない（題や中身は自由に直してよい）。
   読む画面の絵は2枚重ね。どちらも省いてよい。
     bg    うしろの背景（例：bg: "bg/room.jpg"）。省くと無地
     chara その前に立つセレスティア（例：chara: "chara/ep-suki.png"）。省くとホームと同じ絵

   steps は上から順に進む。1つは次のどれか。
     { say: "セリフ", face: "表情のメモ" }   セラが話す。face は省いてよい。書くとセリフの下に小さく出る。
                                             {name} はユーザーの名前（決めていなければ「貴様」）
     { ask: [ { label: "選択肢", then: [ …steps… ] }, … ] }
                                             選択肢を出す。選んだものの then を話してから、次の段へ進む
     { name: { reply: "{name}だ。", then: [ …steps… ], none: { label: "名乗らない。", then: [ …steps… ] } } }
                                             ユーザーが名乗る。名前を決めてあれば reply のボタンが1つだけ出る。
                                             決めていなければ入力欄が出て、ここで決めた名前が設定の「あなたの名前」になる。
                                             none を書くと、決めていない人に「名乗らない」も出す（省いてよい）
   段の書き方は Lv1-30 の口調（SPEECH の 0 番）に合わせてある。 */
const EPISODES = [
  { id: "hello", lv: 1, title: "出会い", steps: [
    { say: "私はセレスティアだ。貴様の名は。" },
    { name: {
      reply: "{name}だ。",
      then: [
        { say: "……ふん。" },
        { say: "覚えておいてやる。" } ]
    } },
    { say: "今日から、貴様を見ている。……精々、朝は起きることだ。" }
  ] },
  { id: "breakfast", lv: 10, title: "朝ご飯", steps: [
    { say: "おい。貴様、朝ご飯は食べたか。" },
    { ask: [
      { label: "食べた。", then: [
        { say: "……そうか。" } ] },
      { label: "食べてない。", then: [
        { say: "………なぜ食わない。", face: "困惑。呆れ。" },
        { say: "朝に食わんと、昼まで持たん。……人間は脆い。" } ] }
    ] },
    { say: "……それだけだ。行け。" }
  ] },
  { id: "umbrella", lv: 20, title: "傘", steps: [
    { say: "……貴様。今日は外に出るのか。" },
    { ask: [
      { label: "出る。", then: [
        { say: "午後から降る。……傘を持っていけ。" } ] },
      { label: "出ない。", then: [
        { say: "……一日中、家か。", face: "呆れ。" },
        { say: "たまには日の光を浴びろ。……寿命が縮む。" } ] }
    ] },
    { say: "……勘違いするな。心配しているわけではない。" },
    { say: "見張りの仕事だ。" }
  ] },
  /* Lv31 から名前で呼ぶようになる（呼び方は notify-lines.js の you）。その手前の話 */
  { id: "name", lv: 30, title: "名前", steps: [
    { say: "……貴様。" },
    { say: "貴様を名で呼ぶかどうか、……考えていた。" },
    { ask: [
      { label: "呼んでいいよ。", then: [
        { say: "……急かすな。", face: "目をそらす。" },
        { say: "決めるのは私だ。" } ] },
      { label: "貴様のままでいい。", then: [
        { say: "………", face: "少しむっとする。" },
        { say: "……そうか。好きにしろ。" } ] }
    ] },
    { say: "……もう少しだけ、見てから決める。" }
  ] },
  /* ここから下はユーザーが書いたもの（2026-09-25）。「// 絵：」は、あとで描く顔の絵のメモ */
  /* 名前で呼ぶ段（Lv31-60）の話 */
  { id: "suki", lv: 45, title: "好きか", steps: [
    { say: "お…おい。私のこと…好きか…？", face: "顔を赤くして、少しだけ上目遣い。" },   // 絵：顔を赤くして少しだけ上目遣い
    { ask: [
      { label: "好き。", then: [
        { say: "っ………………。ん……", face: "顔を赤くして目を逸らす。" } ] },          // 絵：顔を赤くして目を逸らす
      { label: "嫌い。", then: [
        { say: "…………………そ…そうか…", face: "少しだけ目を逸らす。" } ] }             // 絵：少しだけ目を逸らす
    ] }
  ] },
  /* ご主人と呼ぶ段（Lv61-90）の話 */
  { id: "sowasowa", lv: 75, title: "そわそわ", steps: [
    { say: "………………………", face: "そわそわしている。落ち着きがない。" },               // 絵：頬を赤くしてきょろきょろしている
    { ask: [
      { label: "かわいい。", then: [
        { say: "かっ………かわいい…！？……うぅ………", face: "びっくりして赤面。" } ] },    // 絵：びっくり＋赤面
      { label: "きれい。", then: [
        { say: "っ…………。きれい………。う…うれしい…ぞ…", face: "もじもじ。赤面して上目遣い。" } ] },   // 絵：もじもじ＋赤面＋上目遣い
      { label: "エロい。", then: [
        { say: "っ…！！！………もう……ご主人ったら…！", face: "赤面して照れる。" } ] }     // 絵：赤面照れ
    ] }
  ] }
];
const epOf = id => EPISODES.find(x => x.id === id);
const epOpen = ep => st.chara.level >= ep.lv;
const epNew = ep => epOpen(ep) && !st.epRead.includes(ep.id);
/* 話し手の名。本名を明かすのは Lv100 なので、それまでは地上の名乗り */
const epSpeaker = () => (st.chara.level >= MAX_LV ? "セラ" : CHARA);

function renderEpList() {
  $("#epList").innerHTML = EPISODES.slice().sort((a, b) => a.lv - b.lv).map(ep => epOpen(ep)
    ? '<button class="row eprow" data-ep="' + esc(ep.id) + '"><div class="rowbody">' +
      '<div class="rowtitle">' + esc(ep.title) + "</div>" +
      '<div class="chips"><span class="chip">Lv' + ep.lv + "</span>" +
      (epNew(ep) ? '<span class="chip imp">NEW</span>' : "") + "</div></div></button>"
    : '<div class="row locked"><div class="rowbody"><div class="rowtitle">？？？</div>' +
      '<div class="chips"><span class="chip">Lv' + ep.lv + "で解放</span></div></div></div>"
  ).join("") || '<div class="empty">エピソードはまだありません。</div>';
}
$("#epList").addEventListener("click", e => {
  const b = e.target.closest("[data-ep]"); if (b) openEp(b.dataset.ep);
});

/* 読む画面。背景はその話の絵（無ければホームと同じ絵）、会話は下の半透明の面に下から積む。
   epQueue はこれから話す段。選んだ選択肢の then は、この頭に差しこむ。
   会話のいちばん下には「しっぽ」（#epTail）があり、いま待っているものをそこに出す。
   epWait はそれが何か（next＝タップで次へ／ask＝選択肢／name＝名乗る／end＝おわり）。
   選択肢も名前の入力も、あなたの側（右）の吹き出しとして出す。 */
let epNow = null, epQueue = [], epWait = "", epAsk = null, epName = null;
const epText = t => t.replace(/\{name\}/g, st.user || "貴様");
function openEp(id) {
  const ep = epOf(id); if (!ep || !epOpen(ep)) return;
  epNow = ep; epQueue = ep.steps.slice();
  $("#epTitle").textContent = ep.title;
  epPic("#epScene", ep.bg || "");
  epPic("#epChara", ep.chara || CHARA_IMG);
  $("#epLog").innerHTML = '<div class="eptail" id="epTail"></div>';
  openSheet("#sheetEp");
  epStep();
}
/* 絵を差しかえる。パスが空なら隠す */
function epPic(sel, src) {
  const img = $(sel);
  img.hidden = !src;
  if (src && img.getAttribute("src") !== src) img.src = src;
}
const epScroll = () => { const log = $("#epLog"); log.scrollTop = log.scrollHeight; };
/* 会話を1つ足す（しっぽの手前に） */
function epAdd(html) { $("#epTail").insertAdjacentHTML("beforebegin", html); epScroll(); }
function epTail(html) { $("#epTail").innerHTML = html; epScroll(); }
/* 次の段を1つ話す。話したあと、すぐ後ろが選択肢や名乗りならそのまま出す */
function epStep() {
  const s = epQueue.shift();
  if (s && s.say != null) {
    // 名前と表情のメモも吹き出しの中に入れる（絵の上に直に置くと読みにくいため）
    epAdd('<div class="epline"><div class="epsay"><div class="epwho">' + esc(epSpeaker()) + "</div>" +
      esc(epText(s.say)) +
      (s.face ? '<div class="epface">（' + esc(s.face.replace(/。$/, "")) + "）</div>" : "") + "</div></div>");
  } else if (s && (s.ask || s.name)) { epQueue.unshift(s); }   // 頭がいきなり選択肢や名乗りのとき
  const nx = epQueue[0];
  if (nx && nx.ask) {
    epQueue.shift(); epAsk = nx.ask; epWait = "ask";
    epTail('<div class="epopts">' + nx.ask.map((c, i) =>
      '<button class="epopt" data-c="' + i + '">' + esc(c.label) + "</button>").join("") + "</div>");
  } else if (nx && nx.name) {
    epQueue.shift(); epName = nx.name; epWait = "name";
    // 名前を決めてあれば、名乗る吹き出しが1つだけ。決めていなければ、吹き出しの中の欄で決める
    epTail('<div class="epopts">' + (st.user
      ? '<button class="epopt" data-nm="say">' + esc(epText(epName.reply || "{name}だ。")) + "</button>"
      : '<div class="epnamebox"><input id="epNameIn" placeholder="あなたの名前" maxlength="20" enterkeyhint="done" autocomplete="off" aria-label="あなたの名前">' +
        '<button class="epsend" data-nm="set">名乗る</button></div>' +
        (epName.none ? '<button class="epopt" data-nm="none">' + esc(epName.none.label || "名乗らない。") + "</button>" : "") +
        '<div class="epnote">ここで決めた名前は、設定の「あなたの名前」になります。あとから変えられます。</div>') +
      "</div>");
  } else if (nx) {
    epWait = "next";
    epTail('<div class="ephint">タップで次へ</div>');
  } else {
    epWait = "end";
    epTail('<button class="epend" id="epEnd">おわり</button>');
  }
}
function epEnd() {
  if (epNow && !st.epRead.includes(epNow.id)) { st.epRead.push(epNow.id); save(); render(); }
  renderEpList();
  closeSheet("#sheetEp");
}
/* 押したところで受け持ちを分ける。選択肢・名乗り・おわりはそのボタンで、
   それ以外（絵でも会話でも）を押したら次へ進む。上の×は別に受ける */
$("#sheetEp").addEventListener("click", e => {
  if (e.target.closest(".sidehead")) return;
  const c = e.target.closest("[data-c]");
  if (c && epWait === "ask") {
    const pick = epAsk[+c.dataset.c]; if (!pick) return;
    epAdd('<div class="epme">' + esc(pick.label) + "</div>");
    epQueue = (pick.then || []).concat(epQueue);
    epAsk = null; epStep();
    return;
  }
  const nm = e.target.closest("[data-nm]");
  if (nm && epWait === "name") { epNamed(nm.dataset.nm); return; }
  if (e.target.closest("#epEnd") && epWait === "end") { epEnd(); return; }
  if (epWait === "next") epStep();
});
/* 名乗った（say＝決めてある名前で／set＝入力欄の名前を決めて／none＝名乗らない） */
function epNamed(how) {
  const n = epName; if (!n) return;
  let then = n.then || [];
  if (how === "set") {
    const v = $("#epNameIn").value.trim().slice(0, 20);
    if (!v) { $("#epNameIn").focus(); return; }
    st.user = v; save(); render();   // 設定の「あなたの名前」にも入る
    $("#epNameIn").blur();
  }
  if (how === "none") {
    epAdd('<div class="epme">' + esc(n.none.label || "名乗らない。") + "</div>");
    then = n.none.then || [];
  } else {
    epAdd('<div class="epme">' + esc(epText(n.reply || "{name}だ。")) + "</div>");
  }
  epQueue = then.concat(epQueue);
  epName = null; epStep();
}
$("#epLog").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "epNameIn" && !e.isComposing) { e.preventDefault(); epNamed("set"); }
});
$("#epClose").addEventListener("click", () => closeSheet("#sheetEp"));   // 途中で閉じたら既読にしない

/* ---------- sheets ---------- */
/* 真ん中に出る窓（.sheet の side でないもの）を開いているあいだは、透明な幕で後ろを押せなくする。
   幕に色は付けない。暗くするのは窓のまわりの影だけ（style.css の .sheet を見よ）。
   画面全体を暗くすると、iPhone が上端に接した幕の色を時計のところに拾い、
   閉じたあとも遅れて点滅するように戻るため（theme-color を変えなくても起きた）。
   右から出るパネルは画面いっぱいの別ページなので、幕は要らない。 */
function paintScrim() { $("#scrim").classList.toggle("on", $$(".sheet.on:not(.side)").length > 0); }
function openSheet(id) { $(id).classList.add("on"); paintScrim(); paintBar(); }
/* 1枚だけ閉じる。ミッションを保存したときに、その下のステータス画面まで
   一緒に閉じてしまわないように、閉じるのは自分の分だけにする。 */
function closeSheet(id) {
  $(id).classList.remove("on");
  if (id === "#sheetC") confirmClosed();
  paintScrim(); paintBar();
}
function closeSheets() {                       // 全部たたむ（タブを移ったときなど）
  $$(".sheet").forEach(x => x.classList.remove("on"));
  confirmClosed();
  paintScrim(); paintBar();
}
/* シートの外を押したら閉じる。閉じるのはいちばん手前の1枚だけなので、
   ステータス画面の上でミッションを編集していても、後ろまでは消えない。
   つかまえるのは capture（降りてくる途中）。この時点ではまだ押した先の処理が
   走っていないので、「開くための一押し」で開いたそばから閉じることがない。
   閉じるときはその一押しをここで止める。うしろのボタンまで押されないように。 */
document.addEventListener("click", e => {
  // 真ん中の窓のほうが手前。右から出るパネルどうし（エピソードの一覧と読む画面）は、あとに書いたほうが手前
  const top = $(".sheet.on:not(.side)") || $$(".sheet.on.side").pop();
  if (!top || e.target.closest(".pop,.popveil")) return;
  if (e.target.closest(".sheet") === top) return;            // 中を押したときは閉じない
  e.stopPropagation(); e.preventDefault();
  closeSheet("#" + top.id);
}, true);
/* 右上の小さいゲージ＝レベルとミッションの入口 */
$("#openStatus").addEventListener("click", () => openSheet("#sheetS"));
$("#openMission").addEventListener("click", () => openSheet("#sheetS"));   // 行き先は同じ画面（ミッションはこの中）
/* エピソードは、ゲージの下のボタンから開く（中身は下の「エピソード」の段） */
$("#openEpisode").addEventListener("click", () => { renderEpList(); openSheet("#sheetE"); });
$("#eClose").addEventListener("click", () => closeSheet("#sheetE"));
$("#sClose").addEventListener("click", () => closeSheet("#sheetS"));

/* mission editor */
/* 直せるのは早起きの時刻だけ。追加も削除もない */
let editing = null, wakeDraft = WAKE_DEFAULT;
$("#mWakeTime").innerHTML = WAKE.map(w =>
  '<button class="pill" data-t="' + w.time + '">' + wakeHour(w.time) +
  '時<span class="pexp">EXP+' + w.exp + "</span></button>").join("");

/* 朝の受け取れる時間（5時〜いちばん遅い9時）のあいだは、時刻を変えられない。
   起きた時間を見てから、その朝の目標を選び直せないようにするため（前の晩までに決めておく）。 */
const WAKE_LOCK_TO = Math.max(...WAKE.map(w => hm(w.time)));
const wakeLocked = () => { const d = new Date(), cur = d.getHours() * 60 + d.getMinutes(); return cur >= CLAIM_FROM && cur < WAKE_LOCK_TO; };
function paintDraft() {
  const lock = wakeLocked();
  $$("#mWakeTime .pill").forEach(p => { p.classList.toggle("on", p.dataset.t === wakeDraft); p.disabled = lock; });
  $("#mSave").disabled = lock;
  $("#mLockNote").hidden = !lock;
}
function openMission(m) {
  editing = m.id;
  wakeDraft = wakeAt(m.time).time;
  paintDraft(); openSheet("#sheetM");
}
$("#mWakeTime").addEventListener("click", e => {
  const b = e.target.closest(".pill"); if (!b || b.disabled) return;
  wakeDraft = b.dataset.t; paintDraft();
});
$("#mCancel").addEventListener("click", () => closeSheet("#sheetM"));
$("#mSave").addEventListener("click", () => {
  if (wakeLocked()) { paintDraft(); return; }   // 開いたまま5時をまたいだとき
  const m = st.missions.find(x => x.id === editing);
  if (m) Object.assign(m, wakeMission(m.id, wakeDraft));
  save(); render(); closeSheet("#sheetM");
});
/* 確認の小窓。消す前に一度だけ止める。中身を差しかえて他でも使える。 */
/* opt は省いてよい。{ yes: "決める"（ボタンの文字。ふだんは「消す」）, warn: true（説明を赤字に）,
   no: 関数（「やめる」や外を押して閉じたときに呼ぶ）} */
let confirmFn = null, confirmNo = null;
function askConfirm(title, name, fn, opt) {
  opt = opt || {};
  $("#cTitle").textContent = title;
  $("#cName").textContent = name;
  $("#cName").classList.toggle("warn", !!opt.warn);
  $("#cYes").textContent = opt.yes || "消す";
  confirmFn = fn; confirmNo = opt.no || null;
  openSheet("#sheetC");
}
/* 「決める」を押さずに確認の窓が閉じた（やめる・外を押した・タブを移った） */
function confirmClosed() {
  const f = confirmNo; confirmNo = null; confirmFn = null;
  if (f) f();
}
$("#cNo").addEventListener("click", () => closeSheet("#sheetC"));
$("#cYes").addEventListener("click", () => {
  const fn = confirmFn; confirmFn = null; confirmNo = null;
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

  // 調子は今日までの日だけ。先の日はまだ分からないので出さない
  $("#dMoodWrap").hidden = k > keyOf(new Date());
  $("#dMood").innerHTML = moodButtons(st.mood[k] || "");

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

/* 真ん中の窓は、iPhoneのキーボードが出たら、見えている範囲の真ん中へ寄せる。
   キーボードは画面を縮めずに上から重なるだけなので、そのままだと窓の下半分（保存ボタンなど）が隠れる。
   見えている範囲の高さと位置を CSS に渡し、style.css の .sheet がそれで置き場所を決める。 */
if (window.visualViewport) {
  const vv = window.visualViewport, root = document.documentElement;
  const fitVV = () => {
    root.style.setProperty("--vvh", vv.height + "px");
    root.style.setProperty("--vvt", vv.offsetTop + "px");
  };
  vv.addEventListener("resize", fitVV);
  vv.addEventListener("scroll", fitVV);
  fitVV();
}

/* ---------- global clicks ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "claim") {
    const m = st.missions.find(x => x.id === id); if (!m) return;
    const now = new Date();
    if (claimState(m, now, !m.days.includes(now.getDay())) !== "ready") { flash(b); return; }
    toggleDone(m.id, keyOf(now), true);                  // 受け取ったら取り消せない
    if (m.type === "wake") st.wakeT[keyOf(now)] = m.time;   // 週の点数は、受け取ったときの時刻で決まる
    const run = m.type === "wake" ? streakOf(m) : 0;      // 今日を含めた連続日数
    if (addExp(m.exp)) say("trueName", now);             // この一回で Lv100 に着いた
    else if (STREAK_MARKS.includes(run)) say("streakMark", now, moreTail(now), run);   // 連続の節目
    else say(m.type === "wake" ? "wakeClaim" : "missionClaim", now, moreTail(now));
    save(); render();
  }
  if (act === "weekclaim") {
    const now = new Date(), wk = weekShown(now);
    // 押すまでのあいだに日付がまたいで、別の週に変わっていたら受け取らない
    if (wk.state !== "ready" || wk.mk !== b.dataset.wk) { flash(b); return; }
    st.wkClaim.push(wk.mk);
    if (addExp(wk.exp)) say("trueName", now);
    else say("weekClaim", now, moreTail(now));
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
document.addEventListener("keydown", e => { if (e.key === "Escape") { closePop(); closeViewer(); } });

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
  const holi = holidayName(d), mo = moodOf(st.mood[k]);
  const ev = (st.events[k] || []).slice().sort((a, b) => evKey(a).localeCompare(evKey(b)));
  return '<div class="daypop">' +
    '<div class="dpdate">' + y + "年" + m + "月" + dd + "日（" + DOW[d.getDay()] + "）</div>" +
    (holi ? '<div class="dpholi">' + esc(holi) + "</div>" : "") +
    (mo ? '<div class="dpmood">' + moodFace(mo, "dpface") + "調子：" + mo.label + "</div>" : "") +
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
    if (el.classList.contains("calgrid")) gap = true;
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

const calGrid = calStrip;   // 日のマスの受け持ちは、月の帯全体でまとめて受ける
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
/* 長押しの小窓が出ているあいだは、横に動かしても帯を流さない（日を渡り歩くための動き）。
   小窓は動かずに押しつづけたときだけ出るので、この時点ではまだ流れはじめていない。 */
calGrid.addEventListener("touchmove", e => { if (holding && e.cancelable) e.preventDefault(); }, { passive: false });
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
  const again = t.classList.contains("on");             // いま開いているタブをもう一度押した
  $$(".tab").forEach(x => x.classList.toggle("on", x === t));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
  closePop();
  $(".scroller").scrollTop = 0;                         // 転がるのはこの中なので、戻すのもここ
  $("main").classList.toggle("on-home", t.dataset.v === "home");   // ゲージとセリフの出し入れ
  closeSheets();                                        // 開きっぱなしのパネルはたたむ
  if (t.dataset.v === "set") paintBackup();
  if (t.dataset.v === "cal") {                          // 開くたびに今月から（前に見ていた月には戻さない）
    const n = new Date();
    // 開いたまま押しなおしたときは、今月まで流して戻す。別のタブから来たときは一瞬で合わせる
    calToIdx((n.getFullYear() - calBase.getFullYear()) * 12 + n.getMonth() - calBase.getMonth(), again && !reduceMotion());
  }
  if (t.dataset.v === "notify") { paintNotify(); renderRem(); }
  if (t.dataset.v === "rec") { recOff = 0; recSel = null; renderRec(); }   // 開くたびに今日の週から
}));

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
$("#gDelete").addEventListener("click", () => {
  const g = st.goals.find(x => x.id === gediting); if (!g) return;
  askConfirm("この目標を消しますか", g.title, () => {
    st.goals = st.goals.filter(x => x.id !== g.id);
    save(); render(); closeSheet("#sheetG");
  });
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
$("#rmDelete").addEventListener("click", () => {
  const r = st.reminders.find(x => x.id === rmEditing); if (!r) return;
  askConfirm("この通知を消しますか", r.title, () => {
    st.reminders = st.reminders.filter(x => x.id !== r.id);
    save(); renderRem(); closeSheet("#sheetRem"); setMsg("消しました");
  });
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
$("#giftBtn").addEventListener("click", () => {
  const now = new Date();
  if (!giftReady(now)) { render(); return; }     // 日付をまたいでいたら、もう受け取れない
  st.bdayGift = now.getFullYear();
  if (addExp(BDAY_GIFT)) say("trueName", now);   // この一回で Lv100 に着いた
  else say("birthdayGift", now);
  save(); render();
});
/* 誕生日は月と日だけ。どちらかが空なら「決めていない」 */
$("#bdMonth").innerHTML = '<option value="">月</option>' +
  Array.from({ length: 12 }, (_, i) => '<option value="' + pad(i + 1) + '">' + (i + 1) + "月</option>").join("");
$("#bdDay").innerHTML = '<option value="">日</option>' +
  Array.from({ length: 31 }, (_, i) => '<option value="' + pad(i + 1) + '">' + (i + 1) + "日</option>").join("");
function paintBday() {
  // 毎分の描き直しでも呼ばれる。決める前は、選んでいる途中（確認の窓を開いているあいだも）を触らない。
  // 決めてあった誕生日が「やりなおし」や読みこみで消えたときだけ、欄を空に戻す
  if (!st.birthday && !$("#bdMonth").disabled) return;
  const [m, d] = st.birthday ? st.birthday.split("-") : ["", ""];
  $("#bdMonth").value = m; $("#bdDay").value = d;
}
/* 一度決めたら変えられない（毎日「今日」に変えて、プレゼントを何度ももらえないように） */
function paintBdayLock() {
  const fixed = !!st.birthday;
  $("#bdMonth").disabled = $("#bdDay").disabled = fixed;
  $("#bdLocked").hidden = !fixed;
}
["#bdMonth", "#bdDay"].forEach(id => $(id).addEventListener("change", () => {
  if (st.birthday) { paintBday(); paintBdayLock(); return; }   // 決めたあとは変えられない
  const m = $("#bdMonth").value; let d = $("#bdDay").value;
  if (!m || !d) return;                                       // 片方だけ選んだ途中
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+m - 1];   // 2月は29日まで選べる
  if (+d > max) { d = pad(max); $("#bdDay").value = d; }
  askConfirm("誕生日を " + (+m) + "月" + (+d) + "日 に決めますか", "一度決めると、あとから変えられません。", () => {
    st.birthday = m + "-" + d;
    save(); paintBday(); paintBdayLock();
    setMsg("誕生日を決めました");
  }, { yes: "決める", warn: true, no: () => { $("#bdDay").value = ""; } });   // やめたら日だけ選び直し
}));
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
$("#wipe").addEventListener("click", () => {
  askConfirm("ぜんぶ消して最初からにしますか",
    "レベル・記録・予定・目標・メモがすべて消えます。元には戻せません。", () => {
      st = normalize(seed());
      save(); applyTheme(); render(); setMsg("最初にもどしました");
    });
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
/* iPhoneのステータスバーの色。テーマの地の色にそろえるだけで、窓を開いても変えない。
   （実機で確かめたところ、いまのiPhoneはこの meta より、上端に接した固定の部品の色を拾う。
   窓を開いても上端には何も置かないので、時計のところはいつも地の色のまま。） */
let barDark = false;
function paintBar() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", barDark ? "#0d1020" : "#f3f5fc");
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
  if (g.err) {
    // 「→」があるのはサーバーまで届いて断られたとき（sbWrite のエラー）。電波のせいではないので、中身を見せる
    el.textContent = g.err.includes(" → ")
      ? "サーバーに断られました（" + whenText(new Date(g.at)) + "）：" + g.err.split(" → ").pop().slice(0, 160)
      : "送れませんでした（" + whenText(new Date(g.at)) + "）。電波のあるところで開き直すと、もう一度送ります。";
    return;
  }
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
  // くりかえし通知のぶんも同じ棚に並べる。
  // 棚（pings）は「持ち主＋番号」が重なると受けつけない決まりなので、番号に日付を足して1行ずつ変える。
  // 重なった1行のせいで全部が断られ、ふつうの予定まで鳴らなくなっていた。sw.js は @ より前で引く。
  st.reminders.forEach(r => {
    remDays(r, new Date(now)).forEach(d => {
      if (d.getTime() > now) rows.push({ owner: owner, event_id: r.id + "@" + keyOf(d),
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

/* ---------- キャラを全画面で見る ---------- */
/* 左上のボタンで、キャラの絵だけを画面いっぱいに出す。どこを押しても戻る。
   絵がまだ無いあいだ（「セ」の仮枠）は、ボタンごと出さない。 */
function openViewer() {
  if (!CHARA_IMG) return;
  const img = $("#viewerImg");
  if (img.getAttribute("src") !== CHARA_IMG) { img.src = CHARA_IMG; img.alt = CHARA; }
  $("#viewer").classList.add("on");
}
function closeViewer() { $("#viewer").classList.remove("on"); }
$("#fullBtn").hidden = !CHARA_IMG;
$("#fullBtn").addEventListener("click", openViewer);
$("#viewer").addEventListener("click", closeViewer);

/* ---------- boot ---------- */
// 昔の書庫が画像を入れていた置き場。もう使わないので、残っていれば片づける
try { if (window.indexedDB) indexedDB.deleteDatabase("celestia-files"); } catch (e) {}
applyTheme();
renderRem();
mirror();
paintNotify();
syncNow();
updateSpeech(new Date());
render();
maybeAskMood(new Date());
let lastDay = keyOf(new Date());
setInterval(() => {
  const k = keyOf(new Date());
  if (k !== lastDay) { lastDay = k; buildCal(); }   // 日付が変わったら、今月をまん中に並べ直す
  updateSpeech(new Date());
  render();
  maybeAskMood(new Date());   // 開いたまま朝5時をまたいだとき
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  updateSpeech(new Date()); render();
  maybeAskMood(new Date());
  syncNow();   // 戻ってきたら、端末の中身とサーバーを合わせ直す（離れる前の送り損ねもここで拾う）
});

/* ---------- service worker ---------- */
/* オフラインで開けるようにする。file: で直接開いたときは働かないので何もしない。 */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js")
    .then(reg => reg.update())
    .catch(() => {});
}
