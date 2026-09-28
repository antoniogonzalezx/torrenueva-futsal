// Envía notificaciones push:
//  · actividad del feed: la llama la base de datos (pg_net) desde triggers en posts, post_comments y post_likes;
//  · recordatorio de multas a punto de duplicarse: la llama pg_cron cada mañana con { type: "reminders" }.
// Las claves VAPID y el secreto del webhook viven en public.app_secrets (sin acceso para anon/authenticated).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.from("app_secrets").select("key,value");
  if (error) throw error;
  cfg = Object.fromEntries(data.map((r) => [r.key, r.value]));
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

const eur = (n: number) => (Number.isInteger(+n) ? String(+n) : (+n).toFixed(2).replace(".", ",")) + " €";
const first = (m?: { name: string; nickname?: string | null }) => (m?.nickname || m?.name || "").split(" ")[0];

async function send(s: { id: number; endpoint: string; p256dh: string; auth: string }, payload: string) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    else console.error("push", code, (e as Error).message);
    return false;
  }
}

// Recordatorio diario (pg_cron): multas que se duplican (×2) o cuadruplican (×4) dentro de 2 días.
// Solo se cuentan los días exactos 13 y 27, así cada multa avisa una vez por salto.
async function reminders() {
  const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const { data: fines, error } = await db.from("fines").select("member_id,amount,credit_used,reason,date")
    .eq("paid", false).eq("kind", "multa").in("date", [day(13), day(27)]);
  if (error) throw error;
  if (!fines?.length) return new Response("0");

  const byMember = new Map<string, typeof fines>();
  fines.forEach((f) => byMember.set(f.member_id, [...(byMember.get(f.member_id) || []), f]));
  const { data: subs } = await db.from("push_subscriptions").select("*").in("member_id", [...byMember.keys()]);
  const when = new Date(Date.now() + 2 * 864e5).toLocaleDateString("es-ES", { weekday: "long", timeZone: "Europe/Madrid" });

  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    const ff = byMember.get(s.member_id)!;
    const base = (f: (typeof ff)[0]) => Math.max(0, +f.amount - +f.credit_used);
    const now = ff.reduce((t, f) => t + base(f) * (f.date === day(27) ? 2 : 1), 0);
    const next = ff.reduce((t, f) => t + base(f) * (f.date === day(27) ? 4 : 2), 0);
    const title = ff.length === 1 ? "Tu multa se duplica en 2 días" : `${ff.length} multas se duplican en 2 días`;
    const body = `${ff.length === 1 ? (ff[0].reason || "Multa") + ": " : ""}${eur(now)} → ${eur(next)} el ${when}. Págala antes.`;
    if (await send(s, JSON.stringify({ title, body, url: "#multas", tag: "reminder" }))) sent++;
  }));
  return new Response(String(sent));
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (req.headers.get("x-notify-secret") !== c.webhook_secret) return new Response("forbidden", { status: 403 });
    const payloadIn = await req.json();
    if (payloadIn.type === "reminders") return await reminders();
    const { table, record } = payloadIn;

    const post = table === "posts" ? record
      : (await db.from("posts").select("*").eq("id", record.post_id).maybeSingle()).data;
    if (!post) return new Response("no post");
    const ids = [post.author_id, post.player_id, record.member_id].filter(Boolean);
    const { data: people } = await db.from("members").select("id,name,nickname").in("id", ids);
    const who = (id: string) => people?.find((p) => p.id === id);

    let actor: string, targets: string[] | "team", title: string, body: string;
    if (table === "posts" && post.kind === "match") {
      actor = post.author_id; targets = "team";
      const stats = [post.goals && `${post.goals} gol${post.goals > 1 ? "es" : ""}`, post.assists && `${post.assists} asist.`,
        post.saves && `${post.saves} paradas`].filter(Boolean).join(" · ");
      title = `${who(post.player_id)?.name}${stats ? " · " + stats : ""}`;
      body = [post.rival && `vs ${post.rival}`, post.score_for != null && `${post.score_for}–${post.score_against}`, post.body].filter(Boolean).join(" · ") || "Nuevo partido en el feed";
    } else if (table === "posts" && post.kind === "fine") {
      actor = post.author_id; targets = "team";
      const { data: f } = await db.from("fines").select("amount,reason").eq("id", post.fine_id).maybeSingle();
      title = `Multa para ${who(post.player_id)?.name}`;
      body = f ? `${eur(f.amount)} · ${f.reason || "sin motivo"}` : "Nueva multa";
    } else if (table === "post_comments") {
      actor = record.member_id; targets = [post.author_id, post.player_id];
      title = `${first(who(record.member_id))} ha comentado`;
      body = record.body.slice(0, 140);
    } else if (table === "post_likes") {
      if (post.kind !== "match") return new Response("skip");
      actor = record.member_id; targets = [post.player_id];
      title = `Kudos de ${first(who(record.member_id))}`;
      body = post.rival ? `Por tu partido contra ${post.rival}` : "Por tu partido";
    } else return new Response("skip");

    let q = db.from("push_subscriptions").select("*").eq("team_id", post.team_id);
    if (actor) q = q.neq("member_id", actor);
    if (targets !== "team") q = q.in("member_id", [...new Set(targets.filter((t) => t && t !== actor))]);
    const { data: subs } = await q;
    if (!subs?.length) return new Response("0");

    const payload = JSON.stringify({ title, body, url: "#feed"  /* el service worker la resuelve contra su scope */, tag: `post-${post.id}` });
    let sent = 0;
    await Promise.all(subs.map(async (s) => { if (await send(s, payload)) sent++; }));
    return new Response(String(sent));
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
