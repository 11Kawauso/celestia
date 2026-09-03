/* セレスティア — 通知の文面。

   ここはアプリ本体（app.js）と、通知を出す係（sw.js）の両方から読む。
   アプリが閉じていても sw.js だけで文章を組み立てられるように、
   この中では画面にも st にも一切さわらない。

   ・通知の1行目＝予定の名前、2行目＝下の表から選んだセリフ
   ・{you} は呼び方、{time} は開始時刻、{date} は日付に置きかわる
   ・各段階は配列。いくつ足してもよく、その中から1つがランダムに選ばれる
   ・文面を変えたいときは、この表だけ直せばよい */
const NOTIFY = {
  /* 口調の段階。app.js のセリフと同じ区切り（レベル＝親密度）。 */
  tone(lv) { return lv >= 35 ? 3 : lv >= 18 ? 2 : lv >= 6 ? 1 : 0; },
  you(lv, name) {
    const n = (name || "").trim(), t = this.tone(lv);
    if (t === 3) return "ご主人様";
    if (t === 2) return n || "あんた";     // 名前が未設定なら前の段階の呼び方
    if (t === 1) return "あんた";
    return "お前";
  },

  /* 場面は4つ。
       tomorrow  前の日に知らせる
       todayTime 当日に知らせる（開始時刻あり）
       todayAny  当日に知らせる（開始時刻なし）
       ahead     もっと前に知らせる（{date} が入る） */
  lines: {
    tomorrow: [
      ["明日だ。忘れるなよ、{you}。", "明日はこれがある。今日は早く寝ておけ。"],
      ["明日はこれがあるよ。支度はできてる？", "明日だよ、{you}。忘れないでね。"],
      ["{you}、明日はこれがあるよ。", "明日だね。ちゃんと覚えてた？"],
      ["{you}、明日はこちらのご予定がございます。", "明日でございます。お忘れなきよう。"]
    ],
    todayTime: [
      ["{time}からだ。そろそろ動け、{you}。", "あと少しで{time}だぞ。"],
      ["もうすぐ{time}だよ。そろそろ支度したら？", "{time}からだよ、{you}。"],
      ["{you}、{time}からだよ。そろそろだね。", "もうすぐ{time}。いってらっしゃい。"],
      ["{you}、まもなく{time}よりお約束のお時間です。", "{time}からでございます。お支度を。"]
    ],
    todayAny: [
      ["今日だ。忘れるなよ、{you}。", "今日はこれがある。やっておけ。"],
      ["今日はこれがあるよ。忘れてない？", "今日だよ、{you}。"],
      ["{you}、今日はこれがあるよ。", "今日だね。忘れないうちに。"],
      ["{you}、本日はこちらのご予定がございます。", "本日でございます。お忘れなきよう。"]
    ],
    ahead: [
      ["{date}だ。覚えておけ、{you}。", "{date}にこれがある。忘れるなよ。"],
      ["{date}にこれがあるよ。覚えておいてね。", "{date}だよ、{you}。"],
      ["{you}、{date}にこれがあるよ。", "{date}だね。覚えておいて。"],
      ["{you}、{date}にこちらのご予定がございます。", "{date}でございます。お心づもりを。"]
    ]
  },

  /* 知らせる日と、予定の日を見くらべて、どの場面かを決める。
     どちらも "YYYY-MM-DD" の文字。 */
  scene(notifyDay, eventDay, hasTime) {
    if (notifyDay === eventDay) return hasTime ? "todayTime" : "todayAny";
    const a = new Date(notifyDay + "T00:00"), b = new Date(eventDay + "T00:00");
    return Math.round((b - a) / 86400000) === 1 ? "tomorrow" : "ahead";
  },

  /* 通知の中身を作る。ev は { title, time, day }、notifyDay は知らせる日。 */
  make(ev, notifyDay, lv, name) {
    const sc = this.scene(notifyDay, ev.day, !!ev.time);
    const list = this.lines[sc][this.tone(lv)];
    const date = (+ev.day.slice(5, 7)) + "月" + (+ev.day.slice(8, 10)) + "日";
    const body = list[Math.floor(Math.random() * list.length)]
      .replace(/{you}/g, this.you(lv, name))
      .replace(/{time}/g, ev.time || "")
      .replace(/{date}/g, date);
    return { title: ev.title || "予定", body: body };
  }
};
