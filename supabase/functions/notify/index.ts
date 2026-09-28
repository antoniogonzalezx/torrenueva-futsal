// Envía notificaciones push:
//  · actividad del feed: la llama la base de datos (pg_net) desde triggers en posts, post_comments y post_likes;
//  · recordatorio de multas a punto de duplicarse: la llama pg_cron cada mañana con { type: "reminders" };
//  · quiniela: recordatorio a quien no la ha rellenado ({ type: "quiniela_reminder" }, pg_cron jueves y viernes)
//    y puntos de la jornada ({ type: "quiniela_results" }, la llama ffcm-sync después de leer los resultados).
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

const madridDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
const pts = (n: number) => `${n} punto${n === 1 ? "" : "s"}`;

async function pushTo(memberIds: string[], payload: (memberId: string) => string | null) {
  if (!memberIds.length) return 0;
  const { data: subs } = await db.from("push_subscriptions").select("*").in("member_id", memberIds);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => { const p = payload(s.member_id); if (p && await send(s, p)) sent++; }));
  return sent;
}

// Quiniela sin rellenar (pg_cron: jueves por la tarde y viernes por la mañana).
async function quinielaReminder() {
  const now = new Date();
  const { data: rounds } = await db.from("rounds").select("id,num,deadline,competitions(team_id)")
    .gt("deadline", now.toISOString()).lt("deadline", new Date(+now + 30 * 36e5).toISOString());
  let sent = 0;
  for (const r of rounds || []) {
    const teamId = (r.competitions as unknown as { team_id: string }).team_id;
    const [{ data: members }, { data: picks }] = await Promise.all([
      db.from("members").select("id").eq("team_id", teamId).eq("active", true).not("user_id", "is", null),
      db.from("picks").select("member_id").eq("round_id", r.id),
    ]);
    const done = new Set((picks || []).map((p) => p.member_id));
    const missing = (members || []).map((m) => m.id).filter((id) => !done.has(id));
    const today = new Date(r.deadline).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }) === madridDay();
    const payload = JSON.stringify({ title: `Quiniela · jornada ${r.num}`,
      body: `Cierra ${today ? "hoy" : "mañana"} a las 14:00 y aún no la has rellenado.`, url: "#liga", tag: `quiniela-${r.id}` });
    sent += await pushTo(missing, () => payload);
  }
  return new Response(String(sent));
}

// Puntos de la jornada (lo pide ffcm-sync cada noche; se manda una vez, en cuanto hay resultados tras el día de la jornada).
async function quinielaResults() {
  const { data: rounds } = await db.from("rounds").select("id,num,competition_id,competitions(team_id)")
    .is("notified_at", null).lte("match_date", madridDay(-1)).lt("deadline", new Date().toISOString());
  let sent = 0;
  for (const r of rounds || []) {
    const teamId = (r.competitions as unknown as { team_id: string }).team_id;
    const [{ data: fixtures }, { data: pp }, { data: members }] = await Promise.all([
      db.from("fixtures").select("id,home_goals,void,ours").eq("round_id", r.id),
      db.from("pick_points").select("member_id,points").eq("round_id", r.id),
      db.from("members").select("id,name,nickname").eq("team_id", teamId).eq("active", true),
    ]);
    const bet = (fixtures || []).filter((f) => !f.ours && !f.void);
    const played = bet.filter((f) => f.home_goals != null).length;
    if (!played) continue;   // la federación aún no ha subido nada: se reintenta la noche siguiente
    const tot = new Map<string, { p: number; hits: number }>();
    (pp || []).forEach((x) => {
      const t = tot.get(x.member_id) || { p: 0, hits: 0 };
      t.p += x.points || 0; if (x.points) t.hits++;
      tot.set(x.member_id, t);
    });
    const best = Math.max(0, ...[...tot.values()].map((t) => t.p));
    const leaders = [...tot].filter(([, t]) => t.p === best).map(([id]) => first(members?.find((m) => m.id === id)));
    const lead = !tot.size ? "Nadie la rellenó." : best ? `${leaders.length > 1 ? "Mejores" : "Mejor"}: ${leaders.join(", ")} con ${best}.` : "Nadie ha puntuado.";
    const left = bet.length - played ? ` Faltan ${bet.length - played} resultado${bet.length - played > 1 ? "s" : ""}.` : "";
    sent += await pushTo((members || []).map((m) => m.id), (id) => {
      const me = tot.get(id);
      const body = (me ? `Has sacado ${pts(me.p)} (${me.hits} acierto${me.hits === 1 ? "" : "s"}). ` : "") + lead + left;
      return JSON.stringify({ title: `Quiniela · resultados de la jornada ${r.num}`, body, url: "#liga", tag: `quiniela-${r.id}` });
    });
    await db.from("rounds").update({ notified_at: new Date().toISOString() }).eq("id", r.id);
  }
  return new Response(String(sent));
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (req.headers.get("x-notify-secret") !== c.webhook_secret) return new Response("forbidden", { status: 403 });
    const payloadIn = await req.json();
    if (payloadIn.type === "reminders") return await reminders();
    if (payloadIn.type === "quiniela_reminder") return await quinielaReminder();
    if (payloadIn.type === "quiniela_results") return await quinielaResults();
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
