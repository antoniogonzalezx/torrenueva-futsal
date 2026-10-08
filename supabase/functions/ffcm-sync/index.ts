// Lee resultados de ffcm.es, los guarda en public.fixtures y cierra la jornada de la quiniela.
//  · La llama el GitHub Action de los domingos a las 22:00 (cabecera x-notify-secret; un admin también puede, con su JWT).
//  · Después cierra la jornada jugada (lo que siga sin resultado queda anulado y se abre la siguiente)
//    y pide a «notify» el push con los puntos.
//  · ?debug=<jornada> devuelve el texto que se ha extraído de la página, para ajustar el lector.
//  · ffcm.es devuelve páginas vacías a los servidores de Supabase, así que las descarga un GitHub Action
//    (scripts/ffcm_fetch.mjs): pide { action: "plan" } → lista de URLs, las descarga y las manda en
//    { action: "ingest", pages: { url: html } }. Sin «pages», la función intenta descargarlas ella misma.
// Los partidos ya existen (los carga scripts/calendario_pdf.py): aquí solo se buscan por nombre de equipo,
// así que da igual cómo pinte la federación la tabla mientras local y visitante salgan en la misma fila.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const FFCM = "https://www.ffcm.es/pnfg/NPcd";
const PRIMARIA = 1000120;

type Comp = { id: string; team_id: string; ffcm_temporada: number; ffcm_competicion: number; ffcm_grupo: number };
type Round = { id: number; num: number; match_date: string; closed: boolean;
  ffcm_competicion: number | null; ffcm_grupo: number | null; ffcm_jornada: number | null };
type Fixture = { id: number; round_id: number; home: string; away: string; kickoff: string | null;
  home_goals: number | null; away_goals: number | null; status: string; ours: boolean; manual: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();

// Páginas de la federación: el calendario (toda la temporada con resultados, una sola página) y,
// si falta algo, la de resultados de la jornada. Una jornada puede leer de otra liga (rounds.ffcm_*):
// la jornada 0 del juvenil usa partidos del senior.
const pages = (c: Comp, r: Pick<Round, "num" | "ffcm_competicion" | "ffcm_grupo" | "ffcm_jornada">) => {
  const comp = r.ffcm_competicion ?? c.ffcm_competicion, grupo = r.ffcm_grupo ?? c.ffcm_grupo, jornada = r.ffcm_jornada ?? r.num;
  return [
    `${FFCM}/NFG_VisCalendario_Vis?cod_primaria=${PRIMARIA}&codtemporada=${c.ffcm_temporada}&codcompeticion=${comp}&codgrupo=${grupo}&CodJornada=1`,
    `${FFCM}/NFG_CmpJornada?cod_primaria=${PRIMARIA}&CodTemporada=${c.ffcm_temporada}&CodGrupo=${grupo}&CodCompeticion=${comp}&CodJornada=${jornada}`,
  ];
};

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36", "Accept-Language": "es-ES,es" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
  const cs = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] || /charset=["']?([\w-]+)/i.exec(head)?.[1] || "utf-8";
  return new TextDecoder(/utf-?8/i.test(cs) ? "utf-8" : "latin1").decode(buf);
}

// HTML → líneas de texto normalizado (una por fila de tabla o bloque).
function lines(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<i[^>]*fa-minus[^>]*>/gi, " - ")   // el guion entre los goles es un icono
    .replace(/<\/(tr|p|div|li|h\d|table|thead|tbody)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z])(acute|tilde|uml|grave|circ);/gi, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ")
    .split("\n").map(norm).filter((l) => l.replace(/[|\s]/g, ""));
}

// Hora de Madrid → instante UTC.
function madrid(y: number, mo: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = (t: string) => +p.find((x) => x.type === t)!.value;
  return new Date(guess - (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - guess)).toISOString();
}

// Busca el partido (local antes que visitante) en una línea o en hasta 4 líneas seguidas.
function find(ls: string[], f: Fixture) {
  const h = norm(f.home), a = norm(f.away);
  for (let w = 1; w <= 4; w++) {
    for (let i = 0; i + w <= ls.length; i++) {
      const t = ls.slice(i, i + w).join(" | ");
      if (t.length > 600) continue;
      const ih = t.indexOf(h), ia = t.indexOf(a, ih + h.length);
      if (ih < 0 || ia < 0) continue;
      // Quita los nombres para que no interfieran; lo que queda son fechas, horas, marcador y campo.
      const rest = t.slice(0, ih) + " | " + t.slice(ih + h.length, ia) + " | " + t.slice(ia + a.length);
      const date = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(rest);
      const time = /\b(\d{1,2})[:.h](\d{2})\b/.exec(rest.replace(/\d{1,2}[-/]\d{1,2}[-/]\d{4}/g, " "));
      const clean = rest.replace(/\d{1,2}[-/]\d{1,2}[-/]\d{4}/g, " ").replace(/\b\d{1,2}[:.h]\d{2}\b/g, " ");
      const score = /(?:^|[^\d])(\d{1,2})\s*\|?\s*[-–]\s*\|?\s*(\d{1,2})(?!\d)/.exec(clean);
      return {
        postponed: /APLAZAD|SUSPENDID/.test(rest),
        score: score ? [+score[1], +score[2]] as const : null,
        kickoff: date && time ? madrid(+date[3], +date[2], +date[1], +time[1], +time[2]) : null,
      };
    }
  }
  return null;
}

async function isAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: m } = await db.from("members").select("is_admin,active").eq("user_id", data.user.id).maybeSingle();
  return !!(m?.is_admin && m.active);
}

async function secret() {
  const { data } = await db.from("app_secrets").select("value").eq("key", "webhook_secret").maybeSingle();
  return data?.value as string | undefined;
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const hook = await secret();
    const byCron = !!hook && req.headers.get("x-notify-secret") === hook;
    if (!byCron && !(await isAdmin(req))) return json({ error: "forbidden" }, 403);

    const debug = new URL(req.url).searchParams.get("debug");
    const input = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // plan: solo se apuntan las URLs; ingest: se usan las páginas que manda el GitHub Action.
    const planned: string[] | null = input.action === "plan" ? [] : null;
    const supplied: Record<string, string> | null = input.action === "ingest" && input.pages && typeof input.pages === "object" ? input.pages : null;
    let gotContent = false;   // solo se marca como actualizado si alguna página traía algo
    const cache = new Map<string, Promise<string>>();   // el calendario sirve para todas las jornadas
    const getPage = async (url: string) => {
      if (planned) { planned.push(url); return ""; }
      if (!cache.has(url)) cache.set(url, supplied ? Promise.resolve(String(supplied[url] ?? "")) : fetchText(url));
      const html = await cache.get(url)!;
      if (html.trim()) gotContent = true;
      return html;
    };
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
    const { data: comps, error } = await db.from("competitions").select("*").not("ffcm_competicion", "is", null);
    if (error) throw error;

    const report = [];
    for (const c of comps as Comp[]) {
      if (debug) {
        const out = [];
        for (const url of pages(c, { num: +debug, ffcm_competicion: null, ffcm_grupo: null, ffcm_jornada: null })) {
          try { out.push({ url, lines: lines(await getPage(url)) }); } catch (e) { out.push({ url, error: String(e) }); }
        }
        report.push({ competition: c.id, pages: out });
        continue;
      }
      // Jornadas sin cerrar que ya se han jugado (normalmente, la del sábado).
      const { data: rounds } = await db.from("rounds").select("id,num,match_date,closed,ffcm_competicion,ffcm_grupo,ffcm_jornada")
        .eq("competition_id", c.id).eq("closed", false).lte("match_date", today).order("match_date", { ascending: false });
      const { data: fixtures } = await db.from("fixtures").select("*").in("round_id", (rounds || []).map((r) => r.id));
      const pending = (r: Round) => (fixtures as Fixture[]).filter((f) => f.round_id === r.id && !f.manual);
      const todo = (rounds as Round[]).filter((r) => pending(r).length).slice(0, 6);

      for (const r of todo) {
        const want = pending(r);
        const res: Record<number, ReturnType<typeof find>> = {};
        const errors: string[] = [];
        for (const url of pages(c, r)) {
          if (!planned && want.every((f) => res[f.id]?.score || res[f.id]?.postponed)) break;
          try {
            const ls = lines(await getPage(url));
            for (const f of want) { const hit = find(ls, f); if (hit && (!res[f.id] || hit.score || hit.postponed)) res[f.id] = { ...hit, kickoff: hit.kickoff || res[f.id]?.kickoff || null }; }
          } catch (e) { errors.push(String(e)); }
        }
        let updated = 0;
        for (const f of want) {
          const hit = res[f.id]; if (!hit) continue;
          const row: Partial<Fixture> = {};
          if (hit.score && (hit.score[0] !== f.home_goals || hit.score[1] !== f.away_goals || f.status !== "played")) {
            Object.assign(row, { home_goals: hit.score[0], away_goals: hit.score[1], status: "played" });
          } else if (!hit.score && hit.postponed && f.status !== "postponed" && f.home_goals == null) row.status = "postponed";
          if (hit.kickoff && hit.kickoff !== (f.kickoff && new Date(f.kickoff).toISOString())) row.kickoff = hit.kickoff;
          if (!Object.keys(row).length) continue;
          const { error: e } = await db.from("fixtures").update(row).eq("id", f.id);
          if (e) errors.push(e.message); else updated++;
        }
        report.push({ round: r.num, wanted: want.length, found: Object.keys(res).length, updated,
          missing: want.filter((f) => !res[f.id]).map((f) => `${f.home} - ${f.away}`), errors });
      }
      if (gotContent) {
        await db.from("competitions").update({ synced_at: new Date().toISOString() }).eq("id", c.id);
      }
    }
    if (debug) return json(report);
    if (planned) return json({ urls: [...new Set(planned)] });

    // Cierra la jornada jugada y abre la siguiente; después, push con los puntos.
    await db.rpc("close_rounds");
    if (hook) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-notify-secret": hook },
        body: JSON.stringify({ type: "quiniela_results" }),
      }).catch((e) => console.error("notify", e));
    }
    console.log(JSON.stringify(report));
    return json(report);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
