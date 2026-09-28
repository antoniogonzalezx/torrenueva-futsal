// Alta de un jugador: valida el código del equipo y crea la cuenta ya confirmada.
// Se hace en el servidor para no depender del ajuste «Confirm email» ni enviar correos:
// los emails de las cuentas son internos (<id-jugador>@<dominio>) y no existen.
// El trigger on_auth_user_created vuelve a validar el código y vincula la cuenta al jugador.
import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_DOMAIN = "jugadores.torrenuevafs.app";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  try {
    const { member_id, code, password } = await req.json();
    if (typeof member_id !== "string" || !UUID.test(member_id)) return reply(400, { error: "not_found" });
    if (typeof password !== "string" || password.length < 6 || password.length > 72) return reply(400, { error: "weak_password" });
    const joinCode = String(code ?? "").trim().toUpperCase();

    const { data: check, error: e1 } = await db.rpc("check_join", { p_member: member_id, p_code: joinCode });
    if (e1) throw e1;
    if (check !== "ok") return reply(400, { error: check });   // bad_code | taken | not_found

    const { error: e2 } = await db.auth.admin.createUser({
      email: `${member_id}@${EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { member_id, join_code: joinCode },
    });
    if (e2) {
      if (/already/i.test(e2.message)) return reply(400, { error: "taken" });
      throw e2;
    }
    return reply(200, { ok: true });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "server" });
  }
});
