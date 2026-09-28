// Envía notificaciones push cuando hay actividad en el feed.
// La llama la base de datos (pg_net) desde triggers en posts, post_comments y post_likes.
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

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (req.headers.get("x-notify-secret") !== c.webhook_secret) return new Response("forbidden", { status: 403 });
    const { table, record } = await req.json();

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
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push", code, (e as Error).message);
      }
    }));
    return new Response(String(sent));
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
