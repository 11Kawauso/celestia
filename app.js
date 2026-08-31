"use strict";
const LS = "questlog.v1";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, "0");
const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
/* キャラクターは全ユーザー共通で固定。ユーザーが変えられるのは自分の呼ばれ方だけ。 */
const CHARA = "セレスティア";

/* ---------- state ---------- */
function seed() {
  return {
    v: 2,
    chara: { level: 1, exp: 0 },
    user: "",
    missions: [
      { id: uid(), title: "6時に起きる", exp: 20, days: [0,1,2,3,4,5,6], mode: "before", time: "06:00" },
      { id: uid(), title: "ストレッチをする", exp: 10, days: [0,1,2,3,4,5,6], mode: "", time: "" },
      { id: uid(), title: "コードを書く", exp: 20, days: [1,2,3,4,5], mode: "", time: "" }
    ],
    goals: [
      { id: uid(), title: "アプリを完成させる", due: "", done: false, doneAt: "",
        steps: [
          { id: uid(), title: "つくるものを決める", done: false },
          { id: uid(), title: "画面をつくる", done: false },
          { id: uid(), title: "公開する", done: false }
        ] }
    ],
    events: {}, log: {}, theme: "auto"
  };
}
let st;
try {
  const raw = localStorage.getItem(LS);
  st = raw ? JSON.parse(raw) : seed();
} catch (e) { st = seed(); }
if (!st || !st.chara) st = seed();
normalize(st);

/* 古い保存データを今の形にそろえる。「やることリスト」は長期目標に置きかわったので捨てる。 */
function normalize(o) {
  o.chara = o.chara || { level: 1, exp: 0 };
  o.chara.level = o.chara.level || 1;
  o.chara.exp = o.chara.exp || 0;
  delete o.chara.name; delete o.chara.img;   // キャラ設定は廃止。名前は固定、絵は持たない
  o.user = typeof o.user === "string" ? o.user : "";
  delete o.help;
  o.missions = o.missions || [];
  o.goals = o.goals || [];
  o.goals.forEach(g => {
    g.steps = g.steps || [];
    g.steps.forEach(x => { x.id = x.id || uid(); x.done = !!x.done; });
    g.due = g.due || ""; g.done = !!g.done; g.doneAt = g.doneAt || "";
  });
  o.events = o.events || {}; o.log = o.log || {};
  o.theme = o.theme || "auto";
  delete o.todos;
  return o;
}

let saveWarned = false;
function save() {
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
  const you = (st.user || "").trim();
  $("#luSub").textContent = (you ? you + "、おめでとう ／ " : CHARA + " ／ ") + rankOf(st.chara.level);
  const el = $("#levelup"); el.classList.add("on");
  clearTimeout(luTimer); luTimer = setTimeout(() => el.classList.remove("on"), 1900);
}

/* ---------- mission helpers ---------- */
const doneOn = (id, k) => (st.log[k] || []).includes(id);
function toggleDone(id, k, on) {
  const arr = st.log[k] || (st.log[k] = []);
  const i = arr.indexOf(id);
  if (on && i < 0) arr.push(id);
  if (!on && i >= 0) arr.splice(i, 1);
  if (!arr.length) delete st.log[k];
}
function windowState(m, now) {
  if (!m.mode || !m.time) return "ok";
  const p = m.time.split(":");
  const t = (+p[0]) * 60 + (+p[1]);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (m.mode === "before") return cur <= t ? "ok" : "late";
  if (m.mode === "after") return cur >= t ? "ok" : "early";
  return "ok";
}
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
  $("#ringfill").setAttribute("stroke-dasharray", C.toFixed(1));
  $("#ringfill").setAttribute("stroke-dashoffset", (C * (1 - p)).toFixed(1));
  $("#expnow").textContent = c.exp + " / " + nd + " EXP";
  $("#expneed").textContent = "次のレベルまで あと " + (nd - c.exp);
  // today's missions
  const todays = st.missions.filter(m => m.days.includes(now.getDay()))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, "ja"));
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
  const ev = (st.events[tk] || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  $("#todayEventsSec").hidden = ev.length === 0;
  $("#todayEvents").innerHTML = ev.map(e =>
    '<div class="row"><div class="rowbody"><div class="rowtitle">' + esc(e.title) + '</div>' +
    (e.time ? '<div class="chips"><span class="chip time">' + esc(e.time) + "</span></div>" : "") +
    "</div></div>").join("");
  $("#todayEvents").style.display = "flex"; $("#todayEvents").style.flexDirection = "column"; $("#todayEvents").style.gap = "9px";

  renderGoals();
  renderCal();
  if ($("#userName").value !== st.user) $("#userName").value = st.user;
  if (document.activeElement !== $("#backup")) $("#backup").value = JSON.stringify(st);
}

function missionRow(m, tk, now, dim) {
  const done = doneOn(m.id, tk);
  const w = dim ? "ok" : windowState(m, now);
  const s = streakOf(m);
  const chips = [];
  chips.push('<span class="chip">' + esc(daysLabel(m)) + "</span>");
  if (m.mode && m.time) {
    const lab = m.mode === "before" ? "〜" + m.time + " まで" : m.time + " から";
    const cls = (!done && w === "late") ? "chip late" : "chip time";
    chips.push('<span class="' + cls + '">' + esc(lab) + (!done && w === "late" ? "・時間切れ" : "") + "</span>");
  }
  if (s > 1) chips.push('<span class="chip fire">' + s + "日れんぞく</span>");
  const cls = "row" + (done ? " done" : "") + ((!done && w !== "ok") || dim ? " locked" : "");
  return '<div class="' + cls + '" data-m="' + m.id + '">' +
    '<button class="check" data-act="toggle" data-id="' + m.id + '" aria-label="達成"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>' +
    '<div class="rowbody"><div class="rowtitle">' + esc(m.title) + "</div>" +
    '<div class="chips">' + chips.join("") + "</div></div>" +
    '<span class="expbadge">+' + m.exp + "</span>" +
    '<button class="edit" data-act="edit" data-id="' + m.id + '" aria-label="編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button>' +
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
    '<button class="gstep' + (x.done ? " on" : "") + '" data-act="gstep" data-id="' + g.id + '" data-s="' + x.id + '">' +
    '<span class="gbox"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
    '<span class="gtxt">' + esc(x.title) + "</span></button>").join("");
  return '<div class="goal' + (g.done ? " done" : "") + '">' +
    '<div class="goalhead"><div class="goaltitle">' + esc(g.title) + "</div>" +
    '<button class="edit" data-act="gedit" data-id="' + g.id + '" aria-label="編集"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button></div>' +
    (chips.length ? '<div class="chips">' + chips.join("") + "</div>" : "") +
    (total ? '<div class="track"><div class="fill" style="width:' + Math.round(ratio * 100) + '%"></div></div>' : "") +
    (total ? '<div class="gsteps">' + steps + "</div>" : "") +
    '<button class="gfin' + (ready ? " ready" : "") + '" data-act="gdone" data-id="' + g.id + '">' +
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
    '<div class="dow ' + (i === 0 ? "n" : i === 6 ? "s" : "") + '">' + d + "</div>").join("");
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
    html += '<button class="cell' + (k === tk ? " now" : "") + '" data-act="day" data-k="' + k + '">' +
      '<span class="d">' + day + "</span>" +
      (hasEv || hasGoal ? '<span class="dots">' +
        (hasEv ? '<span class="dot"></span>' : "") +
        (hasGoal ? '<span class="dot due"></span>' : "") + "</span>" : "") +
      (doneN ? '<span class="mini"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>' : "") +
      "</button>";
  }
  $("#calGrid").innerHTML = html;
}

/* ---------- sheets ---------- */
function openSheet(id) { $("#scrim").classList.add("on"); $(id).classList.add("on"); }
function closeSheets() {
  $("#scrim").classList.remove("on");
  $("#sheetM").classList.remove("on"); $("#sheetD").classList.remove("on");
  $("#sheetG").classList.remove("on");
}
$("#scrim").addEventListener("click", closeSheets);

/* mission editor */
let editing = null, draft = null;
$("#mDays").innerHTML = DOW.map((d, i) => '<button class="day" data-d="' + i + '">' + d + "</button>").join("");
function paintDraft() {
  $("#mName").value = draft.title;
  $$("#mExp .pill").forEach(p => p.classList.toggle("on", +p.dataset.e === draft.exp));
  $$("#mDays .day").forEach(p => p.classList.toggle("on", draft.days.includes(+p.dataset.d)));
  $$("#mMode .pill").forEach(p => p.classList.toggle("on", p.dataset.m === (draft.mode || "")));
  $("#mTimeRow").hidden = !draft.mode;
  $("#mTime").value = draft.time || "06:00";
}
function openMission(m) {
  editing = m ? m.id : null;
  draft = m ? { title: m.title, exp: m.exp, days: m.days.slice(), mode: m.mode || "", time: m.time || "" }
            : { title: "", exp: 20, days: [0,1,2,3,4,5,6], mode: "", time: "" };
  $("#mTitle").textContent = m ? "ミッションを編集" : "ミッションを追加";
  $("#mDelete").hidden = !m;
  paintDraft(); openSheet("#sheetM");
}
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
  draft.mode = b.dataset.m; if (draft.mode && !draft.time) draft.time = "06:00";
  paintDraft();
});
$("#mTime").addEventListener("change", e => { draft.time = e.target.value; });
$("#mName").addEventListener("input", e => { draft.title = e.target.value; });
$("#mCancel").addEventListener("click", closeSheets);
$("#mSave").addEventListener("click", () => {
  const t = draft.title.trim();
  if (!t) { $("#mName").focus(); return; }
  if (!draft.days.length) draft.days = [0,1,2,3,4,5,6];
  if (editing) {
    const m = st.missions.find(x => x.id === editing);
    Object.assign(m, { title: t, exp: draft.exp, days: draft.days, mode: draft.mode, time: draft.mode ? draft.time : "" });
  } else {
    st.missions.push({ id: uid(), title: t, exp: draft.exp, days: draft.days, mode: draft.mode, time: draft.mode ? draft.time : "" });
  }
  save(); render(); closeSheets();
});
let delArm = false;
$("#mDelete").addEventListener("click", e => {
  if (!delArm) { delArm = true; e.target.textContent = "もう一度おすと消えます"; setTimeout(() => { delArm = false; e.target.textContent = "このミッションを消す"; }, 3000); return; }
  st.missions = st.missions.filter(m => m.id !== editing);
  Object.keys(st.log).forEach(k => { st.log[k] = st.log[k].filter(id => id !== editing); if (!st.log[k].length) delete st.log[k]; });
  delArm = false; e.target.textContent = "このミッションを消す";
  save(); render(); closeSheets();
});

/* day sheet */
let dayKey = null;
function openDay(k) {
  dayKey = k;
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  $("#dTitle").textContent = m + "月" + d + "日（" + DOW[dt.getDay()] + "）";
  paintDay(); $("#dEvName").value = ""; $("#dEvTime").value = "";
  openSheet("#sheetD");
}
function paintDay() {
  const k = dayKey, [y, mo, d] = k.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const ev = (st.events[k] || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  $("#dEvents").innerHTML = ev.length ? ev.map(e =>
    '<div class="row"><div class="rowbody"><div class="rowtitle">' + esc(e.title) + "</div>" +
    (e.time ? '<div class="chips"><span class="chip time">' + esc(e.time) + "</span></div>" : "") + "</div>" +
    '<button class="del" data-act="evdel" data-id="' + e.id + '" aria-label="削除"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg></button></div>'
  ).join("") : '<div class="empty">予定なし</div>';

  const gd = st.goals.filter(g => g.due === k);
  $("#dGoalsWrap").hidden = gd.length === 0;
  $("#dGoals").innerHTML = gd.map(g =>
    '<div class="row' + (g.done ? " done" : "") + '"><div class="rowbody">' +
    '<div class="rowtitle">' + esc(g.title) + "</div>" +
    '<div class="chips"><span class="chip ' + (g.done ? "ok" : "time") + '">' +
    (g.done ? "達成ずみ" : "この日が期限") + "</span></div></div></div>").join("");

  const sched = st.missions.filter(m => m.days.includes(dt.getDay()));
  $("#dMissions").innerHTML = sched.length ? sched.map(m => {
    const done = doneOn(m.id, k);
    return '<div class="row' + (done ? " done" : "") + '">' +
      '<div class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<div class="rowbody"><div class="rowtitle">' + esc(m.title) + "</div></div>" +
      '<span class="expbadge">' + (done ? "達成" : "—") + "</span></div>";
  }).join("") : '<div class="empty">この曜日のミッションはありません</div>';
}
$("#dEvAdd").addEventListener("click", () => {
  const t = $("#dEvName").value.trim(); if (!t) return;
  (st.events[dayKey] || (st.events[dayKey] = [])).push({ id: uid(), title: t, time: $("#dEvTime").value });
  $("#dEvName").value = ""; $("#dEvTime").value = "";
  save(); paintDay(); renderCal(); render();
});
$("#dClose").addEventListener("click", closeSheets);
$("#dEvents").addEventListener("click", e => {
  const b = e.target.closest('[data-act="evdel"]'); if (!b) return;
  st.events[dayKey] = (st.events[dayKey] || []).filter(x => x.id !== b.dataset.id);
  if (!st.events[dayKey].length) delete st.events[dayKey];
  save(); paintDay(); renderCal(); render();
});

/* ---------- global clicks ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "toggle") {
    const m = st.missions.find(x => x.id === id); if (!m) return;
    const now = new Date(), tk = keyOf(now);
    const done = doneOn(m.id, tk);
    if (!done) {
      if (!m.days.includes(now.getDay())) { return; }
      const w = windowState(m, now);
      if (w !== "ok") { flash(b); return; }
      toggleDone(m.id, tk, true); addExp(m.exp);
    } else { toggleDone(m.id, tk, false); addExp(-m.exp); }
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
    save(); render();
  }
  if (act === "day") { openDay(b.dataset.k); }
  if (act === "help") {
    const t = document.getElementById(b.dataset.help); if (!t) return;
    const on = t.classList.toggle("on");
    b.classList.toggle("on", on);
    b.setAttribute("aria-expanded", on ? "true" : "false");
    b.setAttribute("aria-label", on ? "説明をかくす" : "説明を見る");
  }
});
function flash(el) {
  const row = el.closest(".row"); if (!row) return;
  row.animate([{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }], { duration: 260 });
}

/* ---------- tabs ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.toggle("on", x === t));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
  window.scrollTo(0, 0);
  if (t.dataset.v === "set") $("#backup").value = JSON.stringify(st);
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
$("#gCancel").addEventListener("click", closeSheets);
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
  save(); render(); closeSheets();
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
  save(); render(); closeSheets();
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
  try {
    const o = JSON.parse($("#restoreIn").value);
    if (!o || !o.chara) throw new Error("bad");
    st = normalize(o);
    save(); applyTheme(); render(); setMsg("読みこみました");
    $("#restoreIn").value = ""; $("#restoreBox").hidden = true;
  } catch (e) { setMsg("読みこめませんでした。文字が途中で切れていないか確認してください。", true); }
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
render();
let lastDay = keyOf(new Date());
setInterval(() => {
  const k = keyOf(new Date());
  if (k !== lastDay) { lastDay = k; const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); }
  render();
}, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

/* ---------- service worker ---------- */
(function () {
  const s = $("#swState");
  if (!("serviceWorker" in navigator)) { s.textContent = "オフライン対応：この環境では使えません"; return; }
  if (location.protocol === "file:") { s.textContent = "オフライン対応：ファイルを直接開いた状態では働きません（サーバー上でのみ有効）"; return; }
  navigator.serviceWorker.register("sw.js").then(reg => {
    s.textContent = "オフライン対応：有効（電波がなくても開けます）";
    reg.update();
  }).catch(() => { s.textContent = "オフライン対応：登録できませんでした"; });
})();
