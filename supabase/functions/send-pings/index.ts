// セレスティア — 鳴らす時刻が来た予定を、端末へ送る係。
//
// 1分ごとに cron（pg_cron）から叩かれる。
// この関数が知っているのは「どの端末の、どの番号の予定か」だけで、
// 予定の名前もレベルも知らない。文面は端末側（sw.js）が組み立てる。
//
// 使う秘密：VAPID_PUBLIC / VAPID_PRIVATE（Edge Functions の Secrets に入れておく）
//           SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は自動で入っている。

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// 送り主の連絡先。個人のメールではなく、アプリの置き場所を書いておく。
webpush.setVapidDetails(
  "https://11kawauso.github.io/celestia/",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

Deno.serve(async () => {
  const now = new Date().toISOString();

  // 時刻が来たものを集める
  const { data: due, error } = await db
    .from("pings").select("owner,event_id,day_key").lte("fire_at", now).limit(200);
  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ sent: 0 });

  // その端末の宛先をまとめて引く
  const owners = [...new Set(due.map((d) => d.owner))];
  const { data: devs } = await db.from("devices").select("owner,sub").in("owner", owners);
  const subOf = new Map((devs ?? []).map((d) => [d.owner, d.sub]));

  let sent = 0;
  const gone: string[] = [];   // 宛先が無くなった端末（消し直しが要る）

  for (const p of due) {
    const sub = subOf.get(p.owner);
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify({ id: p.event_id, k: p.day_key }));
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) gone.push(p.owner);   // 消された端末
    }
  }

  // 送ったぶんは片づける。宛先が無くなった端末も消す。
  await db.from("pings").delete().lte("fire_at", now);
  if (gone.length) await db.from("devices").delete().in("owner", gone);

  return json({ sent, due: due.length, gone: gone.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
