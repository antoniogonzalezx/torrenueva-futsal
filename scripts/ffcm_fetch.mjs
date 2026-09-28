// Descarga de ffcm.es las páginas que pide la edge function ffcm-sync y se las manda para que las procese.
// Hace falta porque ffcm.es devuelve páginas vacías a los servidores de Supabase. Lo ejecuta un GitHub Action cada noche.
//
//   SUPABASE_URL=… SYNC_SECRET=… node scripts/ffcm_fetch.mjs   sincroniza (SYNC_SECRET = app_secrets.webhook_secret)
//   node scripts/ffcm_fetch.mjs --probe                        solo comprueba si ffcm.es responde desde esta máquina
const PROBE = 'https://www.ffcm.es/pnfg/NPcd/NFG_VisCalendario_Vis?cod_primaria=1000120&codtemporada=22&codcompeticion=22916226&codgrupo=23193707&CodJornada=1';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
};
const { SUPABASE_URL, SYNC_SECRET } = process.env;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// La web abre sesión (JSESSIONID) en la primera visita: si la página llega vacía, se repite con la cookie.
let cookie = '';
async function get(url) {
  for (let i = 0; i < 2; i++) {
    const res = await fetch(url, { headers: { ...HEADERS, ...(cookie && { Cookie: cookie }) } });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length || !set.length) return decode(buf, res.headers.get('content-type'));
  }
  return '';
}
function decode(buf, type) {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const cs = /charset=["']?([\w-]+)/i.exec(type || '')?.[1] || /charset=["']?([\w-]+)/i.exec(head)?.[1] || 'utf-8';
  return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'latin1').decode(buf);
}
const text = html => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function call(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ffcm-sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-notify-secret': SYNC_SECRET }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ffcm-sync ${res.status}: ${await res.text()}`);
  return res.json();
}

if (process.argv.includes('--probe') || !SYNC_SECRET) {
  const html = await get(PROBE);
  console.log(`ffcm.es: ${html.length} caracteres`);
  console.log(text(html).slice(0, 2000));
  if (!html.length) { console.error('ffcm.es ha devuelto una página vacía: también bloquea esta máquina.'); process.exit(1); }
  process.exit(0);
}

const { urls } = await call({ action: 'plan' });
const pages = {};
for (const url of urls) {
  try { pages[url] = await get(url); console.log(`${String(pages[url].length).padStart(7)}  ${url}`); }
  catch (e) { console.log(`  error  ${e.message}`); }
  await sleep(800);
}
if (urls.length && !Object.values(pages).some(Boolean)) {
  console.error('ffcm.es ha devuelto páginas vacías: no se actualiza nada.');
  process.exit(1);
}
console.log(JSON.stringify(await call({ action: 'ingest', pages }), null, 1));
