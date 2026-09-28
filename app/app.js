/* ════════════════════════════════════════════════════════════
   Torrenueva FS · 2026/27
   Mismo código para los dos equipos; cada carpeta (senior/, juvenil/)
   define window.TEAM y es una PWA instalable por separado.
   ════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ── Configuración ─────────────────────────────── */
const TEAM = window.TEAM;
const SUPA_URL = 'https://cmfhosxslodnrxlpifrn.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZmhvc3hzbG9kbnJ4bHBpZnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NDY2NTQsImV4cCI6MjA4NzIyMjY1NH0.c4-Zb79UQhshpzQH79gIoro3IBKEliEjBMlhjypa_dc';
const VAPID_PUBLIC = 'BB5s9-dwtLPa1FTwItggZIFHsIWOApSZHyLmWFGEz5YQdv0CT8l52whYH0puXYX8_jl1Xh67dRX3qa4L10RhM_U';
const EMAIL_DOMAIN = 'jugadores.torrenuevafs.app';   // emails internos <id>@…; nunca se envía correo
const SEASON_START = '2026-07-01';
const FEED_PAGE = 15;
const STORAGE_QUOTA = 1024 ** 3;                    // 1 GB del plan gratuito, compartido por los dos equipos
// Tamaños de subida: una foto de perfil ronda 30–60 KB y una de partido 120–250 KB.
const IMG = { avatar: { side: 480, q: 0.8, square: true }, post: { side: 1280, q: 0.78 } };

const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: { storageKey: `tfs-${TEAM.slug}-auth`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const S = {
  me: null, team: null, members: [], fines: [], credit: [],
  posts: [], feedMore: false, channel: null, installEvt: null,
  hist: { tab: 'paid', who: '' },
};

/* ── Utilidades ────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const nfmt = n => { n = round2(+n || 0); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','); };
const eur = n => nfmt(n) + ' €';
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const store = {
  get(k) { try { return localStorage.getItem(`tfs-${TEAM.slug}-${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`tfs-${TEAM.slug}-${k}`, v); } catch {} },
};
const todayISO = () => new Date().toLocaleDateString('sv-SE');
const dayNum = iso => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 864e5);
const daysSince = iso => dayNum(todayISO()) - dayNum(iso);
const fmtDay = iso => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const monthKey = iso => { const s = new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} d`;
  return fmtDay(iso);
}
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const memberById = id => S.members.find(m => m.id === id);
const firstName = m => (m?.nickname || m?.name || '').split(' ')[0];
const isGK = m => m?.position === 'Portero';
const publicUrl = path => sb.storage.from('media').getPublicUrl(path).data.publicUrl;
const pathFromUrl = url => url?.split('/object/public/media/')[1] || null;

function mult(f) {
  if (f.kind !== 'multa') return 1;
  const d = daysSince(f.date);
  return d >= 29 ? 4 : d >= 15 ? 2 : 1;
}
const base = f => Math.max(0, f.amount - (f.credit_used || 0));
const due = f => base(f) * mult(f);
function nextJump(f) {
  if (f.kind !== 'multa') return null;
  const d = daysSince(f.date);
  if (d < 15) return { days: 15 - d, to: 2 };
  if (d < 29) return { days: 29 - d, to: 4 };
  return null;
}

let toastT;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  const map = {
    NOT_ALLOWED: 'No tienes permiso para hacer eso.', PLAYER_NOT_FOUND: 'Ese jugador ya no está en la plantilla.',
    FINE_NOT_FOUND: 'Esa multa ya no existe.', ALREADY_PAID: 'Esa multa ya estaba pagada.',
    BAD_AMOUNT: 'El importe tiene que ser mayor que 0.', CANNOT_RELEASE_SELF: 'No puedes liberar tu propia cuenta.',
    POST_NOT_FOUND: 'Esa publicación ya no existe.', FINE_POST: 'Las multas se borran desde la pantalla de Multas.',
    'row-level security': 'No tienes permiso para hacer eso.',
    'exceeded the maximum allowed size': 'La foto pesa demasiado. Prueba con otra.',
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (m.includes('23505') || m.includes('duplicate key')) return 'Ya hay un jugador con ese nombre.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Sin conexión. Inténtalo de nuevo.';
  return m;
}

/* ── Iconos (css.gg) ───────────────────────────── */
const icon = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">${window.ICONS[n]}</svg>`;
function avatar(m, cls = '') {
  if (!m) return `<span class="av ${cls}"></span>`;
  const inner = m.photo_url ? `<img src="${esc(m.photo_url)}" alt="" loading="lazy">` : esc(m.emoji || '⚽');
  return `<span class="av ${cls}">${inner}</span>`;
}
const multTag = mu => mu > 1 ? ` <span class="tag ${mu === 4 ? 'solid' : ''}">×${mu}</span>` : '';

/* ── Hojas ─────────────────────────────────────── */
function openSheet(html, { onClose } = {}) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
  scrim._onClose = onClose;
  document.body.appendChild(scrim);
  return scrim.firstElementChild;
}
function closeSheet(instant) {
  $$('.scrim').forEach(s => {
    s._onClose?.(); s._onClose = null;
    if (instant) return s.remove();
    s.classList.add('out'); setTimeout(() => s.remove(), 150);
  });
}
function confirmSheet({ title, text, ok = 'Confirmar' }) {
  return new Promise(res => {
    let done = false;
    const sh = openSheet(`<h2>${esc(title)}</h2><p class="lead">${text}</p>
      <button class="btn" data-ok>${esc(ok)}</button><div style="height:8px"></div><button class="btn soft" data-no>Cancelar</button>`,
      { onClose: () => { if (!done) res(false); } });
    $('[data-ok]', sh).onclick = () => { done = true; res(true); closeSheet(); };
    $('[data-no]', sh).onclick = () => closeSheet();
  });
}

/* ════════════════════════════════════════════════
   ARRANQUE
   ════════════════════════════════════════════════ */
async function boot() {
  document.documentElement.dataset.team = TEAM.slug;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  // No se llama a Supabase dentro del callback (puede bloquear el cliente): se difiere.
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') setTimeout(() => { teardown(); renderAuth(); }, 0); });
  addEventListener('hashchange', () => S.me && route());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.me) Promise.all([loadData(), loadFeed()]).then(() => refresh());
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterApp(); else renderAuth();
}
function teardown() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  Object.assign(S, { me: null, team: null, members: [], fines: [], credit: [], posts: [] });
}

/* ════════════════════════════════════════════════
   ACCESO
   ════════════════════════════════════════════════ */
async function renderAuth(mode = 'login') {
  closeSheet(true);
  $('#app').innerHTML = `<div class="auth">
    <section class="block">
      <div class="meta">${icon('arrow-right')}<span>Torrenueva FS</span><span>${esc(TEAM.label)} · ${esc(TEAM.season)}</span></div>
      <h1>Multas,<br>partidos<br>y equipo.</h1>
      <p>Solo para la plantilla del ${esc(TEAM.label.toLowerCase())}.</p>
    </section>
    <div class="inner">
      <div class="seg" role="group" aria-label="Acceso">
        <button type="button" data-mode="login" aria-pressed="${mode === 'login'}">Entrar</button>
        <button type="button" data-mode="signup" aria-pressed="${mode === 'signup'}">Crear cuenta</button>
      </div>
      <div id="auth-pane"><p class="label" style="padding:24px 0">Cargando plantilla…</p></div>
      ${installHint()}
    </div></div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  bindInstall($('#app'));
  const { data, error } = await sb.rpc('team_roster', { p_slug: TEAM.slug });
  if (error) {
    $('#auth-pane').innerHTML = `<p class="err" style="margin-top:20px">No se pudo cargar la plantilla. ${esc(errMsg(error))}</p><button class="btn line" id="retry">Reintentar</button>`;
    $('#retry').onclick = () => renderAuth(mode);
    return;
  }
  (mode === 'login' ? paneLogin : paneSignup)(data);
}
const pickGrid = (list, sel) => `<div class="pick">${list.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === sel}">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>`;
const emailFor = id => `${id}@${EMAIL_DOMAIN}`;

function paneLogin(roster) {
  const pane = $('#auth-pane');
  const list = roster.filter(p => p.claimed);
  if (!list.length) { pane.innerHTML = `<p class="note" style="margin-top:20px">Aún no se ha registrado nadie. Pulsa <b>Crear cuenta</b> y busca tu nombre.</p>`; return; }
  let sel = list.some(p => p.id === store.get('last')) ? store.get('last') : null;
  pane.innerHTML = `<div class="rowlabel" style="padding:24px 0 6px">${icon('arrow-right')}<span>¿Quién eres?</span><span>${list.length}</span></div>
    ${pickGrid(list, sel)}
    <form id="login-form" ${sel ? '' : 'hidden'}>
      <input type="text" id="login-user" autocomplete="username" hidden>
      <div class="field"><label for="login-pw">Contraseña</label><input class="input" type="password" id="login-pw" autocomplete="current-password" required minlength="6"></div>
      <p class="err" id="login-err"></p>
      <button class="btn" type="submit">Entrar</button>
    </form>`;
  const form = $('#login-form');
  const choose = id => {
    sel = id; $$('.pick button', pane).forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    $('#login-user').value = emailFor(id); form.hidden = false; $('#login-err').textContent = ''; $('#login-pw').focus();
  };
  if (sel) $('#login-user').value = emailFor(sel);
  $$('.pick button', pane).forEach(b => b.onclick = () => choose(b.dataset.id));
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: emailFor(sel), password: $('#login-pw').value });
    btn.disabled = false;
    if (error) { $('#login-err').textContent = /invalid/i.test(error.message) ? 'Contraseña incorrecta. Si no la recuerdas, pide a un admin que libere tu cuenta.' : errMsg(error); return; }
    store.set('last', sel);
    await enterApp();
  };
}

function paneSignup(roster) {
  const pane = $('#auth-pane');
  const list = roster.filter(p => !p.claimed);
  if (!list.length) { pane.innerHTML = `<p class="note" style="margin-top:20px">Toda la plantilla tiene ya cuenta. Si falta tu nombre, pide a un admin que te añada.</p>`; return; }
  let sel = null;
  pane.innerHTML = `<div class="rowlabel" style="padding:24px 0 6px">${icon('arrow-right')}<span>Busca tu nombre</span><span>${list.length} sin cuenta</span></div>
    ${pickGrid(list, null)}
    <form id="su-form" hidden>
      <input type="text" id="su-user" autocomplete="username" hidden>
      <p class="note acc" id="su-who"></p>
      <div class="field"><label for="su-code">Código del equipo</label><input class="input" id="su-code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Está en el grupo del equipo" required></div>
      <div class="field"><label for="su-pw">Contraseña</label><input class="input" type="password" id="su-pw" autocomplete="new-password" minlength="6" required placeholder="Mínimo 6 caracteres"></div>
      <div class="field"><label for="su-pw2">Repite la contraseña</label><input class="input" type="password" id="su-pw2" autocomplete="new-password" minlength="6" required></div>
      <p class="err" id="su-err"></p>
      <button class="btn" type="submit">Crear mi cuenta</button>
    </form>`;
  const form = $('#su-form');
  $$('.pick button', pane).forEach(b => b.onclick = () => {
    sel = b.dataset.id;
    $$('.pick button', pane).forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#su-who').innerHTML = `Vas a crear la cuenta de <b>${esc(list.find(x => x.id === sel).name)}</b>.`;
    $('#su-user').value = emailFor(sel); form.hidden = false; $('#su-err').textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('#su-err'), btn = $('button[type=submit]', form);
    const code = $('#su-code').value.trim().toUpperCase(), pw = $('#su-pw').value;
    if (pw !== $('#su-pw2').value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    btn.disabled = true;
    const fail = m => { err.textContent = m; btn.disabled = false; };
    const chk = await sb.rpc('check_join', { p_member: sel, p_code: code });
    if (chk.error) return fail(errMsg(chk.error));
    if (chk.data === 'bad_code') return fail('El código del equipo no es correcto.');
    if (chk.data === 'taken') return fail('Ese jugador ya tiene cuenta. Si eres tú, pide a un admin que la libere.');
    if (chk.data !== 'ok') return fail('Ese jugador ya no está en la plantilla.');
    const { data, error } = await sb.auth.signUp({ email: emailFor(sel), password: pw, options: { data: { member_id: sel, join_code: code } } });
    if (error) return fail(/already/i.test(error.message) ? 'Ese jugador ya tiene cuenta.' : /password/i.test(error.message) ? 'Contraseña demasiado débil: usa al menos 6 caracteres.' : errMsg(error));
    store.set('last', sel);
    if (!data.session) return fail('Cuenta creada, pero Supabase pide confirmar el email. Un admin debe desactivar «Confirm email» en Authentication → Sign In / Providers → Email.');
    await enterApp();
  };
}

function installHint() {
  if (standalone()) return '';
  const ios = isIOS();
  return `<div class="install">${icon('arrow-right')}<div class="grow">${ios ? 'Instálala: <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.' : 'Instálala en el móvil para abrirla como una app.'}</div>
    ${ios ? '' : '<button class="btn sm line" data-install>Instalar</button>'}</div>`;
}
function bindInstall(root) {
  const b = $('[data-install]', root); if (!b) return;
  b.onclick = async () => {
    if (!S.installEvt) return toast('Abre el menú del navegador y elige «Instalar app».');
    S.installEvt.prompt(); await S.installEvt.userChoice.catch(() => {}); S.installEvt = null;
  };
}

/* ════════════════════════════════════════════════
   APP
   ════════════════════════════════════════════════ */
async function enterApp() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return renderAuth();
  const { data: me, error } = await sb.from('members').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { renderAuth(); return toast(errMsg(error)); }
  if (!me) { await sb.auth.signOut(); return; }
  S.me = me;
  renderShell();
  await Promise.all([loadData(), loadFeed()]);
  subscribe();
  syncPush();
  route();
}

function renderShell() {
  $('#app').innerHTML = `<div class="app"><header class="head" id="head"></header><main class="scroll" id="view"></main></div>
    <nav class="tabs" aria-label="Secciones">
      ${tab('multas', 'Multas', 'euro')}${tab('feed', 'Feed', 'feed')}${tab('plantilla', 'Plantilla', 'user-list')}${tab('historial', 'Historial', 'time')}
    </nav>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  $('#view').addEventListener('scroll', e => $('#head').classList.toggle('line', e.target.scrollTop > 4), { passive: true });
  // La tab bar siempre manda: cierra cualquier hoja abierta y, si ya estás en esa pestaña, vuelve arriba.
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    closeSheet(true);
    if (location.hash === `#${t.dataset.tab}`) $('#view').scrollTo({ top: 0, behavior: 'smooth' });
  }));
}
const tab = (r, l, ic) => `<a class="tab" href="#${r}" data-tab="${r}">${icon(ic)}<span>${l}</span>${r === 'feed' ? '<i class="dot" id="feed-dot" hidden></i>' : ''}</a>`;

async function loadData() {
  const [m, f, c, t] = await Promise.all([
    sb.from('members').select('*').order('name'),
    sb.from('fines').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('credit_log').select('*').order('created_at', { ascending: false }).limit(300),
    sb.from('teams').select('*').maybeSingle(),
  ]);
  const err = m.error || f.error || c.error || t.error;
  if (err) return toast(errMsg(err));
  S.members = m.data; S.fines = f.data; S.credit = c.data; S.team = t.data;
  const me = S.members.find(x => x.id === S.me.id);
  if (!me || !me.active) return sb.auth.signOut();
  S.me = me;
}
const POST_SELECT = '*, post_likes(member_id), post_comments(count)';
async function loadFeed(more = false) {
  let q = sb.from('posts').select(POST_SELECT).order('id', { ascending: false }).limit(FEED_PAGE);
  if (more && S.posts.length) q = q.lt('id', S.posts.at(-1).id);
  const { data, error } = await q;
  if (error) return toast(errMsg(error));
  S.posts = more ? [...S.posts, ...data] : mergeFresh(data);
  S.feedMore = data.length === FEED_PAGE;
}
// Al recargar la primera página se conservan las páginas antiguas ya cargadas.
function mergeFresh(fresh) {
  const minId = fresh.at(-1)?.id ?? Infinity;
  return [...fresh, ...S.posts.filter(p => p.id < minId)];
}

let reloadT, feedT;
function subscribe() {
  const tid = S.me.team_id;
  const data = () => { clearTimeout(reloadT); reloadT = setTimeout(async () => { await loadData(); refresh(); }, 350); };
  const feed = () => { clearTimeout(feedT); feedT = setTimeout(async () => { await loadFeed(); refresh(); }, 350); };
  S.channel = sb.channel(`team-${tid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fines', filter: `team_id=eq.${tid}` }, () => { data(); feed(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `team_id=eq.${tid}` }, data)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `team_id=eq.${tid}` }, feed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, feed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments' }, feed)
    .subscribe();
}

/* ── Router ────────────────────────────────────── */
function current() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('jugador/')) return { name: 'jugador', id: h.slice(8) };
  return { name: ['feed', 'plantilla', 'historial'].includes(h) ? h : 'multas' };
}
function route() { closeSheet(true); refresh(true); }
function refresh(fresh = false) {
  const view = $('#view'); if (!S.me || !view) return;
  const r = current(), y = view.scrollTop;
  $$('.tab').forEach(t => t.removeAttribute('aria-current'));
  $(`.tab[data-tab="${r.name === 'jugador' ? 'plantilla' : r.name}"]`)?.setAttribute('aria-current', 'page');
  ({ multas: viewFines, feed: viewFeed, plantilla: viewSquad, historial: viewHistory, jugador: viewProfile })[r.name](view, r);
  view.scrollTop = fresh ? 0 : y;
  if (r.name === 'feed' && S.posts[0]) store.set('feed-seen', S.posts[0].id);
  const dot = $('#feed-dot');
  if (dot) dot.hidden = !S.posts.some(p => p.id > Number(store.get('feed-seen') || 0) && p.author_id !== S.me.id);
}
function header(title, { sub, back, action } = {}) {
  $('#head').innerHTML = `
    ${back ? `<button class="hbtn back" id="h-back" aria-label="Volver">${icon('chevron-left')}</button>` : ''}
    <h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${esc(title)}</h1>
    ${action ? `<button class="hbtn solid" id="h-act" aria-label="${esc(action.label)}">${icon('math-plus')}</button>` : ''}
    <button class="hbtn" id="h-me" aria-label="Mi cuenta">${avatar(S.me)}</button>`;
  $('#h-me').onclick = meSheet;
  if (action) $('#h-act').onclick = action.fn;
  if (back) $('#h-back').onclick = () => history.length > 1 ? history.back() : (location.hash = 'plantilla');
}
const rowLabel = (a, b = '') => `<div class="rowlabel">${icon('arrow-right')}<span>${a}</span><span>${b}</span></div>`;

/* ════════════════════════════════════════════════
   MULTAS
   ════════════════════════════════════════════════ */
function viewFines(view) {
  header('Multas', { sub: `${TEAM.label} · ${TEAM.season}`, action: { label: 'Nueva multa', fn: () => fineSheet() } });
  const pend = S.fines.filter(f => !f.paid);
  const total = pend.reduce((s, f) => s + due(f), 0);
  const groups = new Map();
  pend.forEach(f => { if (!groups.has(f.member_id)) groups.set(f.member_id, []); groups.get(f.member_id).push(f); });
  const ordered = [...groups].map(([id, ff]) => ({ m: memberById(id), ff, tot: ff.reduce((s, f) => s + due(f), 0) })).sort((a, b) => b.tot - a.tot);
  const x2 = pend.filter(f => mult(f) === 2).length, x4 = pend.filter(f => mult(f) === 4).length;
  const mine = groups.get(S.me.id) || [];
  const myDue = mine.reduce((s, f) => s + due(f), 0);

  view.innerHTML = `
    <section class="block" aria-label="Bote pendiente">
      <div class="meta">${icon('arrow-right')}<span>Bote pendiente</span><span>${plural(pend.length, 'multa', 'multas')}</span></div>
      <div class="amount big">${nfmt(total)}<small>€</small></div>
      <div class="facts"><span>${plural(groups.size, 'jugador debe', 'jugadores deben')}</span>${x2 ? `<span>${x2} a ×2</span>` : ''}${x4 ? `<span>${x4} a ×4</span>` : ''}</div>
    </section>
    <a class="item" href="#jugador/${S.me.id}">${avatar(S.me)}<div class="grow"><div class="t">Tú</div>
      <div class="s">${mine.length ? plural(mine.length, 'multa pendiente', 'multas pendientes') : 'Al día'}${+S.me.credit > 0 ? ` · saldo ${eur(S.me.credit)}` : ''}</div></div><span class="v">${eur(myDue)}</span></a>
    ${rowLabel('Pendientes', '×2 a los 15 días · ×4 a los 29')}
    ${ordered.length ? `<div class="list">${ordered.map(debtor).join('')}</div>` : `<div class="empty"><b>0 €</b>Nadie debe nada. De momento.</div>`}`;
  $$('[data-fine]', view).forEach(b => b.onclick = () => fineActions(b.dataset.fine));
}
function debtor({ m, ff, tot }) {
  return `<a class="group-h" href="#jugador/${m?.id}">${avatar(m)}<div class="grow"><div class="t">${esc(m?.name)}</div>
      <div class="label">${plural(ff.length, 'multa', 'multas')}${+m?.credit > 0 ? ` · saldo ${eur(m.credit)}` : ''}</div></div><span class="v">${eur(tot)}</span></a>
    ${ff.map(f => fineRow(f, true)).join('')}`;
}
function fineRow(f, indent = false) {
  const mu = mult(f), nj = nextJump(f);
  const bits = [fmtDay(f.date)];
  if (f.kind === 'cobro') bits.push('cobro');
  if (nj && nj.days <= 7) bits.push(`×${nj.to} en ${plural(nj.days, 'día', 'días')}`);
  return `<button class="item ${indent ? 'fine-row' : ''}" data-fine="${f.id}"><div class="grow"><div class="t">${esc(f.reason || 'Sin motivo')}${multTag(mu)}</div>
    <div class="s">${bits.map(esc).join(' · ')}${f.credit_used > 0 ? ` · ${eur(f.credit_used)} de saldo` : ''}</div></div>
    <span class="v">${mu > 1 ? `<small>${eur(base(f))}</small>` : ''}${eur(due(f))}</span></button>`;
}

function fineActions(id) {
  const f = S.fines.find(x => x.id === id); if (!f) return;
  const m = memberById(f.member_id);
  const sh = openSheet(`<h2>${esc(f.reason || 'Multa')}</h2><p class="lead">${esc(m?.name)} · ${fmtDay(f.date)} · ${f.paid ? `pagada el ${fmtDay(f.paid_at)}` : f.kind === 'cobro' ? 'cobro, no se duplica' : mult(f) > 1 ? `multa a ×${mult(f)}` : 'multa'}</p>
    <div class="menu">
      ${f.paid ? '' : `<button data-a="pay">${icon('check')}Marcar como pagada<span class="end">${eur(due(f))}</span></button>`}
      <button data-a="player">${icon('user-list')}Ver ficha de ${esc(firstName(m))}</button>
      ${f.paid ? '' : `<button data-a="del">${icon('trash')}Borrar multa</button>`}
    </div>`);
  $('[data-a=pay]', sh)?.addEventListener('click', () => paySheet(f));
  $('[data-a=player]', sh).onclick = () => { closeSheet(true); location.hash = `jugador/${f.member_id}`; };
  $('[data-a=del]', sh)?.addEventListener('click', async () => {
    if (!await confirmSheet({ title: 'Borrar multa', text: `«${esc(f.reason || 'multa')}» de ${esc(m?.name)}. También desaparece del feed. Si se usó saldo, se devuelve.`, ok: 'Borrar' })) return;
    const { error } = await sb.rpc('delete_fine', { p_fine: f.id });
    if (error) return toast(errMsg(error));
    toast('Multa borrada'); S.posts = S.posts.filter(p => p.fine_id !== f.id);
    await Promise.all([loadData(), loadFeed()]); refresh();
  });
}

function paySheet(f) {
  const m = memberById(f.member_id);
  const d = due(f), useC = Math.min(+m?.credit || 0, d), toPay = round2(d - useC);
  const sh = openSheet(`<h2>Pagar ${eur(toPay)}</h2><p class="lead">${esc(m?.name)} · ${esc(f.reason || 'multa')}</p>
    <div class="list" style="margin:0 calc(var(--gut) * -1) 20px">
      <div class="item"><div class="grow">Importe</div><span>${eur(base(f))}</span></div>
      ${mult(f) > 1 ? `<div class="item"><div class="grow">Duplicada ×${mult(f)}</div><span>${eur(d)}</span></div>` : ''}
      ${useC > 0 ? `<div class="item"><div class="grow">Saldo a favor</div><span>−${eur(useC)}</span></div>` : ''}
    </div>
    <div class="field"><label for="pay-cash">Dinero entregado (€)</label><input class="input" id="pay-cash" type="number" inputmode="decimal" min="0" step="0.5" value="${toPay}"></div>
    <p class="note acc" id="pay-extra" hidden></p><p class="err" id="pay-err"></p>
    <button class="btn" id="pay-ok">Confirmar pago</button>`);
  const inp = $('#pay-cash', sh), extra = $('#pay-extra', sh), err = $('#pay-err', sh), ok = $('#pay-ok', sh);
  const val = () => parseFloat(String(inp.value).replace(',', '.')) || 0;
  const upd = () => {
    const ex = round2(val() - toPay);
    extra.hidden = !(ex > 0); extra.textContent = `Sobran ${eur(ex)}: quedan como saldo de ${firstName(m)} para la próxima multa.`;
    err.textContent = val() < toPay ? `Faltan ${eur(toPay - val())} para saldarla.` : '';
    ok.disabled = val() < toPay;
  };
  inp.oninput = upd; upd();
  ok.onclick = async () => {
    ok.disabled = true;
    const { error } = await sb.rpc('pay_fine', { p_fine: f.id, p_cash: val() });
    if (error) { ok.disabled = false; err.textContent = errMsg(error); return; }
    closeSheet(); toast(`Pagada. ${firstName(m)} respira.`); await loadData(); refresh();
  };
}

const REASONS = ['Llegar tarde', 'Faltar a entreno', 'Olvidar equipación', 'Móvil en el vestuario', 'Tarjeta amarilla', 'Tarjeta roja'];
function fineSheet(preset) {
  const pls = S.members.filter(m => m.active);
  const sh = openSheet(`<h2>Nueva multa</h2><p class="lead">Sale en el feed. Si el jugador tiene saldo, se descuenta solo.</p>
    <form id="nf">
      <div class="field"><label for="nf-who">Jugador</label><select class="input" id="nf-who" required><option value="">Elige jugador</option>
        ${pls.map(p => `<option value="${p.id}" ${p.id === preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="nf-why">Motivo</label><input class="input" id="nf-why" maxlength="140" autocomplete="off" placeholder="¿Qué ha hecho?">
        <div class="chips">${REASONS.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      <div class="pair">
        <div class="field"><label for="nf-amt">Importe (€)</label><input class="input" id="nf-amt" type="number" inputmode="decimal" min="0.5" step="0.5" value="1" required></div>
        <div class="field"><label for="nf-date">Fecha</label><input class="input" id="nf-date" type="date" value="${todayISO()}" max="${todayISO()}" required></div>
      </div>
      <div class="field"><span class="label" style="color:var(--ink);font-weight:600">Tipo</span>
        <div class="seg"><button type="button" data-k="multa" aria-pressed="true">Multa · se duplica</button><button type="button" data-k="cobro" aria-pressed="false">Cobro · fijo</button></div></div>
      <p class="err" id="nf-err"></p>
      <button class="btn" type="submit">Poner multa</button>
    </form>`);
  let kind = 'multa';
  $$('[data-r]', sh).forEach(b => b.onclick = () => { $('#nf-why', sh).value = b.dataset.r; $$('[data-r]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $$('[data-k]', sh).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('[data-k]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#nf', sh).onsubmit = async e => {
    e.preventDefault();
    const who = $('#nf-who', sh).value, amt = parseFloat(String($('#nf-amt', sh).value).replace(',', '.'));
    if (!who) return $('#nf-err', sh).textContent = 'Elige a quién multar.';
    if (!(amt > 0)) return $('#nf-err', sh).textContent = 'El importe tiene que ser mayor que 0.';
    const btn = $('button[type=submit]', sh); btn.disabled = true;
    const { data, error } = await sb.rpc('add_fine', { p_member: who, p_amount: amt, p_reason: $('#nf-why', sh).value, p_date: $('#nf-date', sh).value, p_kind: kind });
    if (error) { btn.disabled = false; return $('#nf-err', sh).textContent = errMsg(error); }
    closeSheet();
    toast(data?.paid ? `Multa a ${firstName(memberById(who))}, pagada con su saldo` : `Multa a ${firstName(memberById(who))}: ${eur(amt)}`);
    await Promise.all([loadData(), loadFeed()]); refresh();
  };
}

/* ════════════════════════════════════════════════
   FEED
   ════════════════════════════════════════════════ */
function viewFeed(view) {
  header('Feed', { sub: 'Partidos y multas del equipo', action: { label: 'Publicar partido', fn: () => postSheet() } });
  if (!S.posts.length) {
    view.innerHTML = `<div class="empty"><b>Nada aún</b>Publica tu primer partido con el botón +. Las multas nuevas también salen aquí.</div>`;
    return;
  }
  view.innerHTML = S.posts.map(postCard).join('') +
    (S.feedMore ? `<div class="btns" style="padding-bottom:10px"><button class="btn line" id="more">Ver anteriores</button></div>` : '');
  bindPosts(view);
  $('#more', view)?.addEventListener('click', async e => { e.target.disabled = true; await loadFeed(true); refresh(); });
}
function postCard(p) {
  const pl = memberById(p.player_id), au = memberById(p.author_id);
  const likes = p.post_likes || [], liked = likes.some(l => l.member_id === S.me.id);
  const nComments = p.post_comments?.[0]?.count || 0;
  const canDelete = p.kind === 'match' && (p.author_id === S.me.id || p.player_id === S.me.id || S.me.is_admin);
  let bodyHtml = '';
  if (p.kind === 'match') {
    const stats = [];
    if (p.goals) stats.push([p.goals, p.goals === 1 ? 'gol' : 'goles']);
    if (p.assists) stats.push([p.assists, p.assists === 1 ? 'asistencia' : 'asistencias']);
    if (p.saves) stats.push([p.saves, p.saves === 1 ? 'parada' : 'paradas']);
    const res = p.score_for != null && p.score_against != null
      ? `<span class="tag ${p.score_for > p.score_against ? 'acc' : ''}">${p.score_for > p.score_against ? 'Victoria' : p.score_for < p.score_against ? 'Derrota' : 'Empate'} ${p.score_for}–${p.score_against}</span>` : '';
    const badges = [p.goals >= 3 && '<span class="tag acc">Hat-trick</span>', isGK(pl) && p.score_against === 0 && '<span class="tag acc">Portería a cero</span>'].filter(Boolean).join('');
    bodyHtml = `${stats.length ? `<div class="post-stats">${stats.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div>` : ''}
      <div class="post-match">${p.rival ? `vs ${esc(p.rival)}` : 'Partido'}${res}${badges}</div>
      ${p.body ? `<p class="post-body">${esc(p.body)}</p>` : ''}
      ${p.photo_path ? `<img class="post-photo" src="${esc(publicUrl(p.photo_path))}" alt="" loading="lazy" ${p.photo_w ? `width="${p.photo_w}" height="${p.photo_h}"` : ''}>` : ''}`;
  } else {
    const f = S.fines.find(x => x.id === p.fine_id);
    bodyHtml = f ? `<button class="post-fine" data-fine="${f.id}"><div class="grow" style="text-align:left"><div style="font-weight:600">${esc(f.reason || 'Sin motivo')}</div>
      <div class="label">${f.paid ? `Pagada el ${fmtDay(f.paid_at)}` : `Pendiente${mult(f) > 1 ? ` · ya va a ×${mult(f)}` : ''}`}${f.kind === 'cobro' ? ' · cobro' : ''}</div></div>
      <b>${eur(f.paid ? f.paid_total : due(f))}</b></button>` : '';
  }
  const title = p.kind === 'fine' ? `Multa para ${esc(pl?.name)}` : esc(pl?.name || '¿?');
  const by = p.author_id && p.author_id !== p.player_id ? ` · ${p.kind === 'fine' ? 'puesta' : 'publicado'} por ${esc(firstName(au))}` : '';
  const likers = likes.map(l => firstName(memberById(l.member_id))).filter(Boolean);
  return `<article class="post" data-post="${p.id}">
    <a class="post-h" href="#jugador/${p.player_id}">${avatar(pl)}<div class="grow"><div class="t">${title}</div><div class="s">${ago(p.created_at)}${by}</div></div></a>
    ${bodyHtml}
    <div class="post-actions">
      <button data-like class="${liked ? 'liked' : ''}" aria-pressed="${liked}" aria-label="Kudos">${icon('heart')}${likes.length || ''}</button>
      <button data-comments aria-label="Comentarios">${icon('comment')}${nComments || ''}</button>
      ${canDelete ? `<button class="more" data-more aria-label="Opciones">${icon('more-vertical-alt')}</button>` : ''}
    </div>
    ${likers.length ? `<div class="kudos-by">Kudos de ${esc(likers.slice(0, 3).join(', '))}${likers.length > 3 ? ` y ${likers.length - 3} más` : ''}</div>` : ''}
  </article>`;
}
function bindPosts(root) {
  $$('.post', root).forEach(el => {
    const id = Number(el.dataset.post);
    $('[data-like]', el).onclick = () => toggleLike(id);
    $('[data-comments]', el).onclick = () => commentsSheet(id);
    $('[data-more]', el)?.addEventListener('click', () => postMenu(id));
    $('[data-fine]', el)?.addEventListener('click', e => fineActions(e.currentTarget.dataset.fine));
    $('.post-photo', el)?.addEventListener('dblclick', () => toggleLike(id, true));
  });
}
async function toggleLike(id, onlyAdd = false) {
  const p = S.posts.find(x => x.id === id); if (!p) return;
  p.post_likes = p.post_likes || [];
  const liked = p.post_likes.some(l => l.member_id === S.me.id);
  if (liked && onlyAdd) return;
  // Respuesta inmediata; si falla, se deshace.
  p.post_likes = liked ? p.post_likes.filter(l => l.member_id !== S.me.id) : [...p.post_likes, { member_id: S.me.id }];
  refresh();
  const { error } = liked
    ? await sb.from('post_likes').delete().eq('post_id', id).eq('member_id', S.me.id)
    : await sb.from('post_likes').insert({ post_id: id, member_id: S.me.id, team_id: S.me.team_id });
  if (error) { toast(errMsg(error)); await loadFeed(); refresh(); }
}
function postMenu(id) {
  const p = S.posts.find(x => x.id === id); if (!p) return;
  const sh = openSheet(`<h2>Publicación</h2><p class="lead">Al borrarla se restan sus goles, asistencias y el partido de la ficha de ${esc(firstName(memberById(p.player_id)))}.</p>
    <div class="menu"><button data-del>${icon('trash')}Borrar publicación</button></div>`);
  $('[data-del]', sh).onclick = async () => {
    const { data: photo, error } = await sb.rpc('delete_post', { p_post: id });
    if (error) return toast(errMsg(error));
    if (photo) sb.storage.from('media').remove([photo]).catch(() => {});
    closeSheet(); toast('Publicación borrada');
    S.posts = S.posts.filter(x => x.id !== id);
    await loadData(); refresh();
  };
}
async function commentsSheet(id) {
  if (!S.posts.some(x => x.id === id)) return;
  const sh = openSheet(`<h2>Comentarios</h2><div id="c-list"><p class="label" style="padding:12px 0">Cargando…</p></div>
    <form class="comment-form" id="c-form"><textarea id="c-txt" rows="1" maxlength="500" placeholder="Escribe un comentario" aria-label="Comentario"></textarea>
      <button class="hbtn solid" aria-label="Enviar">${icon('arrow-right')}</button></form>`);
  const draw = async () => {
    const { data, error } = await sb.from('post_comments').select('*').eq('post_id', id).order('id');
    if (error) return toast(errMsg(error));
    $('#c-list', sh).innerHTML = data.length ? data.map(c => { const m = memberById(c.member_id);
      const mine = c.member_id === S.me.id || S.me.is_admin;
      return `<div class="comment">${avatar(m, 'sm')}<div class="grow"><div class="t">${esc(m?.name)}<span>${ago(c.created_at)}</span></div><p>${esc(c.body)}</p></div>
        ${mine ? `<button class="hbtn" data-cdel="${c.id}" aria-label="Borrar comentario">${icon('trash')}</button>` : ''}</div>`; }).join('')
      : `<p class="label" style="padding:12px 0">Sé el primero en comentar.</p>`;
    $$('[data-cdel]', sh).forEach(b => b.onclick = async () => {
      const { error: e2 } = await sb.from('post_comments').delete().eq('id', b.dataset.cdel);
      if (e2) return toast(errMsg(e2));
      draw(); loadFeed().then(() => refresh());
    });
  };
  draw();
  const ta = $('#c-txt', sh);
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  $('#c-form', sh).onsubmit = async e => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return;
    ta.value = ''; ta.oninput();
    const { error } = await sb.from('post_comments').insert({ post_id: id, member_id: S.me.id, team_id: S.me.team_id, body });
    if (error) { ta.value = body; return toast(errMsg(error)); }
    draw(); loadFeed().then(() => refresh());
  };
}

function postSheet() {
  const pls = S.members.filter(m => m.active && !['Entrenador', 'Staff'].includes(m.position));
  const def = pls.some(p => p.id === S.me.id) ? S.me.id : '';
  const vals = { goals: 0, assists: 0, saves: 0, goals_conceded: 0 };
  let photo = null;
  const sh = openSheet(`<h2>Publicar partido</h2><p class="lead">Se suma a las estadísticas del jugador. El equipo puede dar kudos y comentar.</p>
    <form id="np">
      <div class="field"><label for="np-who">Jugador</label><select class="input" id="np-who" required><option value="">Elige jugador</option>
        ${pls.map(p => `<option value="${p.id}" ${p.id === def ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="np-rival">Rival</label><input class="input" id="np-rival" maxlength="60" placeholder="Contra quién" required></div>
      <div class="field"><span class="label" style="color:var(--ink);font-weight:600">Resultado (opcional)</span>
        <div class="pair"><input class="input" id="np-for" type="number" inputmode="numeric" min="0" max="99" placeholder="Nosotros" aria-label="Goles del Torrenueva">
        <input class="input" id="np-against" type="number" inputmode="numeric" min="0" max="99" placeholder="Ellos" aria-label="Goles del rival"></div></div>
      <div class="steppers" id="np-steps"></div>
      <div class="field"><label for="np-body">Comentario</label><textarea class="input" id="np-body" maxlength="500" placeholder="Cómo fue"></textarea></div>
      <button type="button" class="photo-pick" id="np-photo">${icon('camera')}<span>Añadir foto</span></button>
      <input type="file" id="np-file" accept="image/*" hidden>
      <p class="err" id="np-err"></p>
      <button class="btn" type="submit">Publicar</button>
    </form>`);
  const steps = () => {
    const gk = isGK(memberById($('#np-who', sh).value));
    const list = [['goals', 'Goles'], ['assists', 'Asistencias'], ...(gk ? [['saves', 'Paradas'], ['goals_conceded', 'Encajados']] : [])];
    $('#np-steps', sh).innerHTML = list.map(([k, l]) => stepper(k, l, vals[k])).join('');
    bindSteppers(sh, vals);
  };
  $('#np-who', sh).onchange = steps; steps();
  $('#np-photo', sh).onclick = () => $('#np-file', sh).click();
  $('#np-file', sh).onchange = e => {
    photo = e.target.files[0] || null;
    $('#np-photo', sh).innerHTML = photo ? `<img src="${URL.createObjectURL(photo)}" alt=""><span>Foto lista · toca para cambiarla</span>` : `${icon('camera')}<span>Añadir foto</span>`;
  };
  $('#np', sh).onsubmit = async e => {
    e.preventDefault();
    const err = $('#np-err', sh), btn = $('button[type=submit]', sh);
    const who = $('#np-who', sh).value;
    if (!who) return err.textContent = 'Elige el jugador.';
    const num = id => { const v = $(id, sh).value; return v === '' ? null : Math.max(0, Math.min(99, parseInt(v, 10))); };
    btn.disabled = true; btn.textContent = photo ? 'Subiendo foto…' : 'Publicando…';
    let up = null;
    try { if (photo) up = await uploadImage(photo, 'posts', IMG.post); }
    catch (x) { btn.disabled = false; btn.textContent = 'Publicar'; return err.textContent = errMsg(x); }
    const { error } = await sb.rpc('create_match_post', {
      p_player: who, p_rival: $('#np-rival', sh).value, p_score_for: num('#np-for'), p_score_against: num('#np-against'),
      p_goals: vals.goals, p_assists: vals.assists, p_saves: vals.saves, p_conceded: vals.goals_conceded,
      p_body: $('#np-body', sh).value, p_photo_path: up?.path ?? null, p_photo_w: up?.w ?? null, p_photo_h: up?.h ?? null,
    });
    if (error) {
      if (up) sb.storage.from('media').remove([up.path]).catch(() => {});
      btn.disabled = false; btn.textContent = 'Publicar'; return err.textContent = errMsg(error);
    }
    closeSheet(); toast('Publicado');
    await Promise.all([loadData(), loadFeed()]);
    if (current().name !== 'feed') location.hash = 'feed'; else refresh(true);
  };
}
const stepper = (k, l, v) => `<div class="stepper"><span class="label">${l}</span><div class="ctl">
  <button type="button" data-dec="${k}" aria-label="Restar ${l}">−</button><output id="st-${k}">${v}</output><button type="button" data-inc="${k}" aria-label="Sumar ${l}">+</button></div></div>`;
function bindSteppers(root, vals) {
  $$('[data-inc]', root).forEach(b => b.onclick = () => { const k = b.dataset.inc; vals[k]++; $(`#st-${k}`, root).textContent = vals[k]; });
  $$('[data-dec]', root).forEach(b => b.onclick = () => { const k = b.dataset.dec; vals[k] = Math.max(0, vals[k] - 1); $(`#st-${k}`, root).textContent = vals[k]; });
}

/* ════════════════════════════════════════════════
   HISTORIAL
   ════════════════════════════════════════════════ */
function viewHistory(view) {
  header('Historial', { sub: 'Temporada ' + TEAM.season });
  const paid = S.fines.filter(f => f.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
  const season = paid.filter(f => (f.paid_at || '') >= SEASON_START);
  const sum = arr => arr.reduce((s, f) => s + (+f.paid_total || 0), 0);
  const thisMonth = monthKey(new Date().toISOString());
  const rank = {};
  season.forEach(f => rank[f.member_id] = (rank[f.member_id] || 0) + (+f.paid_total || 0));
  const top = Object.entries(rank).sort((a, b) => b[1] - a[1]).slice(0, 5), max = top[0]?.[1] || 1;
  const who = S.hist.who;

  view.innerHTML = `<div class="nums">
      <div><span class="label">Recaudado</span><b>${eur(sum(season))}</b></div>
      <div><span class="label">Este mes</span><b>${eur(sum(season.filter(f => monthKey(f.paid_at) === thisMonth)))}</b></div>
      <div><span class="label">Pagadas</span><b>${season.length}</b></div></div>
    ${top.length ? rowLabel('Más ha aportado', 'temporada') + `<div class="list">${top.map(([id, v]) => { const m = memberById(id);
      return `<a class="item" href="#jugador/${id}">${avatar(m, 'sm')}<div class="grow"><div class="t">${esc(m?.name)}</div><div class="bar"><i style="width:${Math.max(4, v / max * 100)}%"></i></div></div><span class="v">${eur(v)}</span></a>`; }).join('')}</div>` : ''}
    ${rowLabel('Movimientos')}
    <div style="padding:0 var(--gut)">
      <div class="seg"><button type="button" data-t="paid" aria-pressed="${S.hist.tab === 'paid'}">Multas pagadas</button><button type="button" data-t="credit" aria-pressed="${S.hist.tab === 'credit'}">Saldo a favor</button></div>
      <select class="input" id="h-who" aria-label="Filtrar por jugador" style="margin-top:10px"><option value="">Todo el equipo</option>
        ${S.members.map(m => `<option value="${m.id}" ${m.id === who ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    </div>
    <div id="h-list" style="margin-top:6px"></div>`;
  $$('[data-t]', view).forEach(b => b.onclick = () => { S.hist.tab = b.dataset.t; refresh(); });
  $('#h-who', view).onchange = e => { S.hist.who = e.target.value; refresh(); };
  const box = $('#h-list', view);
  if (S.hist.tab === 'paid') {
    const rows = paid.filter(f => !who || f.member_id === who);
    if (!rows.length) return box.innerHTML = `<div class="empty">Aún no hay multas pagadas${who ? ' de este jugador' : ''}.</div>`;
    const byMonth = new Map();
    rows.forEach(f => { const k = monthKey(f.paid_at); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(f); });
    box.innerHTML = [...byMonth].map(([k, ff]) => `<div class="month"><span>${esc(k)}</span><span>${eur(sum(ff))}</span></div>` + ff.map(f => { const m = memberById(f.member_id);
      return `<button class="item" data-fine="${f.id}">${avatar(m, 'sm')}<div class="grow"><div class="t">${esc(m?.name)} <span class="mute" style="font-weight:400">${esc(f.reason || 'sin motivo')}</span>${multTag(f.paid_mult)}</div>
        <div class="s">${f.kind === 'cobro' ? 'Cobro' : 'Multa'} del ${fmtDay(f.date)} · pagada el ${fmtDay(f.paid_at)}</div></div><span class="v">${eur(f.paid_total)}</span></button>`; }).join('')).join('');
    $$('[data-fine]', box).forEach(b => b.onclick = () => fineActions(b.dataset.fine));
  } else {
    const rows = S.credit.filter(c => !who || c.member_id === who);
    if (!rows.length) return box.innerHTML = `<div class="empty">Sin movimientos. Cuando alguien paga de más, aparece aquí.</div>`;
    box.innerHTML = `<div class="list">${rows.map(c => { const m = memberById(c.member_id);
      return `<div class="item">${avatar(m, 'sm')}<div class="grow"><div class="t">${esc(m?.name)}</div><div class="s">${esc(c.reason)} · ${fmtDay(c.created_at)}</div></div><span class="v">${c.delta > 0 ? '+' : '−'}${eur(Math.abs(c.delta))}</span></div>`; }).join('')}</div>`;
  }
}

/* ════════════════════════════════════════════════
   PLANTILLA Y FICHA
   ════════════════════════════════════════════════ */
const POSITIONS = ['Portero', 'Cierre', 'Ala', 'Pívot', 'Universal', 'Entrenador', 'Staff'];
const isStaff = m => ['Entrenador', 'Staff'].includes(m?.position);
function viewSquad(view) {
  const act = S.members.filter(m => m.active);
  header('Plantilla', { sub: `${act.length} en el ${TEAM.label.toLowerCase()}` });
  const sort = (a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999) || a.name.localeCompare(b.name, 'es');
  const gk = act.filter(isGK).sort(sort);
  const staff = act.filter(isStaff).sort(sort);
  const field = act.filter(m => !isGK(m) && !isStaff(m)).sort(sort);
  const players = [...gk, ...field];
  const lead = k => players.filter(m => m[k] > 0).sort((a, b) => b[k] - a[k])[0];
  const leader = (m, k, l) => `<a href="${m ? `#jugador/${m.id}` : '#plantilla'}"><span class="label">${l}</span><b>${m ? m[k] : 0}</b><span class="who">${m ? `${avatar(m, 'sm')}<span>${esc(m.name)}</span>` : '<span class="mute">Nadie aún</span>'}</span></a>`;
  const card = m => `<a class="pc" href="#jugador/${m.id}">${m.user_id ? '<i class="reg" title="Tiene cuenta"></i>' : ''}${m.dorsal != null ? `<span class="num">${m.dorsal}</span>` : ''}
    ${avatar(m)}<span class="n">${esc(m.name)}</span><span class="p">${esc(m.position || 'Jugador')}</span></a>`;
  const group = (t, list, add) => list.length || add ? rowLabel(t, list.length) + `<div class="squad">${list.map(card).join('')}${add ? `<button class="pc add" id="add-player">${icon('user-add')}Añadir jugador</button>` : ''}</div>` : '';
  view.innerHTML = `${rowLabel('Líderes', 'temporada')}<div class="leaders">${leader(lead('goals'), 'goals', 'Goles')}${leader(lead('assists'), 'assists', 'Asistencias')}</div>
    ${group('Porteros', gk)}${group('Jugadores', field, S.me.is_admin)}${group('Cuerpo técnico', staff)}
    <p class="label" style="padding:16px var(--gut)">El punto de color indica que ya tiene cuenta en la app: ${act.filter(m => m.user_id).length} de ${act.length}.</p>`;
  $('#add-player', view)?.addEventListener('click', () => memberSheet());
}

function viewProfile(view, r) {
  const m = memberById(r.id);
  header(m ? firstName(m) : 'Jugador', { back: true, sub: 'Plantilla' });
  if (!m) return view.innerHTML = `<div class="empty">Este jugador ya no está en la plantilla.</div>`;
  const pend = S.fines.filter(f => !f.paid && f.member_id === m.id);
  const paidSeason = S.fines.filter(f => f.paid && f.member_id === m.id && (f.paid_at || '') >= SEASON_START);
  const debt = pend.reduce((s, f) => s + due(f), 0);
  const admin = S.me.is_admin && m.id !== S.me.id;
  const gk = isGK(m);
  const perMatch = n => m.matches ? (n / m.matches).toFixed(2).replace('.', ',') : '—';
  const cells = isStaff(m) ? [] : gk
    ? [['Partidos', m.matches], ['Paradas', m.saves], ['Encajados', m.goals_conceded], ['Porterías a cero', m.clean_sheets], ['Encajados/partido', perMatch(m.goals_conceded)], ['MVP', m.mvps], ['Goles', m.goals], ['Asistencias', m.assists], ['Amarillas · rojas', `${m.yellow_cards} · ${m.red_cards}`]]
    : [['Partidos', m.matches], ['Goles', m.goals], ['Asistencias', m.assists], ['Goles/partido', perMatch(m.goals)], ['MVP', m.mvps], ['Amarillas · rojas', `${m.yellow_cards} · ${m.red_cards}`]];
  const posts = S.posts.filter(p => p.player_id === m.id && p.kind === 'match');

  view.innerHTML = `
    <section class="hero">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="Foto de ${esc(m.name)}">` : `<span class="emoji">${esc(m.emoji || '⚽')}</span>`}
      ${m.dorsal != null ? `<span class="dorsal" aria-label="Dorsal ${m.dorsal}">${m.dorsal}</span>` : ''}
      <button class="edit" id="photo-btn">${icon('camera')}${m.photo_url ? 'Cambiar foto' : 'Poner foto'}</button>
      <input type="file" id="photo-in" accept="image/*" hidden></section>
    <div class="id"><h2>${esc(m.name)}</h2><p>${esc(m.position || 'Jugador')}${m.nickname ? ` · «${esc(m.nickname)}»` : ''}${m.is_admin ? ' · <span class="tag">Admin</span>' : ''}</p></div>
    ${m.bio ? `<p class="bio">${esc(m.bio)}</p>` : ''}
    ${cells.length ? rowLabel('Estadísticas', gk ? 'portero' : 'temporada') + `<div class="nums">${cells.map(([l, v]) => `<div><span class="label">${l}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    <div class="btns"><button class="btn line" id="edit-btn">${icon('pen')}Editar ficha</button><button class="btn line" id="fine-btn">${icon('math-plus')}Multar</button></div>
    ${rowLabel('Caja')}
    <div class="nums"><div><span class="label">Debe</span><b>${eur(debt)}</b></div><div><span class="label">Ha pagado</span><b>${eur(paidSeason.reduce((s, f) => s + (+f.paid_total || 0), 0))}</b></div><div><span class="label">Saldo</span><b>${eur(m.credit)}</b></div></div>
    ${pend.length ? `<div class="list" style="border-top:0">${pend.map(f => fineRow(f)).join('')}</div>` : ''}
    ${posts.length ? rowLabel('Partidos publicados', posts.length) + `<div class="list">${posts.map(p => `<a class="item" href="#feed"><div class="grow"><div class="t">vs ${esc(p.rival || '—')}${p.goals >= 3 ? ' <span class="tag acc">Hat-trick</span>' : ''}</div>
      <div class="s">${[p.goals && plural(p.goals, 'gol', 'goles'), p.assists && plural(p.assists, 'asistencia', 'asistencias'), p.saves && plural(p.saves, 'parada', 'paradas')].filter(Boolean).join(' · ') || 'Sin datos'} · ${ago(p.created_at)}</div></div>
      <span class="label">${plural((p.post_likes || []).length, 'kudo', 'kudos')}</span></a>`).join('')}</div>` : ''}
    ${admin ? rowLabel('Admin') + `<div class="menu" style="margin:0">
      ${m.user_id ? `<button data-adm="release">${icon('lock')}Liberar cuenta<span class="end">olvidó la contraseña</span></button>` : ''}
      <button data-adm="admin">${icon('shield')}${m.is_admin ? 'Quitar admin' : 'Hacer admin'}</button>
      <button data-adm="off">${icon('user-remove')}Dar de baja</button></div>` : ''}
    <p class="label" style="padding:18px var(--gut)">${m.user_id ? 'Tiene cuenta en la app' : 'Aún no se ha registrado'} · ficha editada el ${fmtDay(m.updated_at)}</p>`;

  $$('[data-fine]', view).forEach(b => b.onclick = () => fineActions(b.dataset.fine));
  $('#edit-btn', view).onclick = () => memberSheet(m);
  $('#fine-btn', view).onclick = () => fineSheet(m.id);
  $('#photo-btn', view).onclick = () => $('#photo-in', view).click();
  $('#photo-in', view).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    toast('Subiendo foto…');
    try {
      const up = await uploadImage(file, 'avatars', IMG.avatar);
      const { error } = await sb.from('members').update({ photo_url: publicUrl(up.path) }).eq('id', m.id);
      if (error) { sb.storage.from('media').remove([up.path]).catch(() => {}); throw error; }
      const old = pathFromUrl(m.photo_url);
      if (old) sb.storage.from('media').remove([old]).catch(() => {});   // no acumular fotos viejas
      toast('Foto actualizada'); await loadData(); refresh();
    } catch (x) { toast(errMsg(x)); }
  };
  $$('[data-adm]', view).forEach(b => b.onclick = () => adminAction(b.dataset.adm, m));
}

async function adminAction(kind, m) {
  let error;
  if (kind === 'release') {
    if (!await confirmSheet({ title: 'Liberar cuenta', text: `${esc(m.name)} tendrá que volver a registrarse con el código del equipo. Sus multas y estadísticas se quedan.`, ok: 'Liberar' })) return;
    ({ error } = await sb.rpc('admin_release_member', { p_member: m.id })); if (!error) toast('Cuenta liberada');
  } else if (kind === 'admin') {
    ({ error } = await sb.rpc('admin_set_admin', { p_member: m.id, p_admin: !m.is_admin })); if (!error) toast(m.is_admin ? 'Ya no es admin' : 'Ahora es admin');
  } else {
    if (!await confirmSheet({ title: 'Dar de baja', text: `${esc(m.name)} sale de la plantilla y pierde el acceso. Su historial se conserva.`, ok: 'Dar de baja' })) return;
    ({ error } = await sb.rpc('admin_set_active', { p_member: m.id, p_active: false }));
    if (!error) { toast('Baja registrada'); location.hash = 'plantilla'; }
  }
  if (error) return toast(errMsg(error));
  await loadData(); refresh();
}

function memberSheet(m) {
  const isNew = !m;
  m = m || { name: '', nickname: '', emoji: '⚽', position: '', dorsal: null, bio: '' };
  const KEYS = [['matches', 'Partidos'], ['goals', 'Goles'], ['assists', 'Asistencias'], ['mvps', 'MVP'], ['yellow_cards', 'Amarillas'], ['red_cards', 'Rojas']];
  const GK = [['saves', 'Paradas'], ['goals_conceded', 'Encajados'], ['clean_sheets', 'A cero']];
  const vals = Object.fromEntries([...KEYS, ...GK].map(([k]) => [k, m[k] || 0]));
  const sh = openSheet(`<h2>${isNew ? 'Añadir jugador' : 'Editar ficha'}</h2>
    <p class="lead">${isNew ? 'Aparece en la plantilla y podrá crear su cuenta con el código del equipo.' : 'Cualquiera del equipo puede corregirla. Los partidos del feed ya suman solos.'}</p>
    <form id="mf">
      <div class="field"><label for="mf-name">Nombre</label><input class="input" id="mf-name" maxlength="40" required value="${esc(m.name)}"></div>
      <div class="pair"><div class="field"><label for="mf-nick">Apodo</label><input class="input" id="mf-nick" maxlength="40" value="${esc(m.nickname || '')}"></div>
        <div class="field"><label for="mf-emoji">Emoji</label><input class="input" id="mf-emoji" maxlength="16" value="${esc(m.emoji || '')}"></div></div>
      <div class="pair"><div class="field"><label for="mf-pos">Posición</label><select class="input" id="mf-pos"><option value="">Jugador</option>
          ${POSITIONS.map(p => `<option ${p === m.position ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field"><label for="mf-dorsal">Dorsal</label><input class="input" id="mf-dorsal" type="number" inputmode="numeric" min="0" max="99" value="${m.dorsal ?? ''}"></div></div>
      ${isNew ? '' : `<span class="label" style="color:var(--ink);font-weight:600">Estadísticas</span><div class="steppers" id="mf-steps" style="margin-top:8px"></div>
        <div class="field"><label for="mf-bio">Sobre él</label><textarea class="input" id="mf-bio" maxlength="280" placeholder="Pierna buena, frase mítica…">${esc(m.bio || '')}</textarea></div>
        ${m.photo_url ? '<button type="button" class="btn soft" id="mf-nophoto" style="margin-bottom:16px">Quitar foto</button>' : ''}`}
      <p class="err" id="mf-err"></p>
      <button class="btn" type="submit">${isNew ? 'Añadir a la plantilla' : 'Guardar'}</button>
    </form>`);
  const drawSteps = () => {
    const box = $('#mf-steps', sh); if (!box) return;
    box.innerHTML = [...KEYS, ...($('#mf-pos', sh).value === 'Portero' ? GK : [])].map(([k, l]) => stepper(k, l, vals[k])).join('');
    bindSteppers(box, vals);
  };
  $('#mf-pos', sh).onchange = drawSteps; drawSteps();
  let dropPhoto = false;
  $('#mf-nophoto', sh)?.addEventListener('click', e => { dropPhoto = true; e.target.textContent = 'La foto se quitará al guardar'; e.target.disabled = true; });
  $('#mf', sh).onsubmit = async e => {
    e.preventDefault();
    const d = $('#mf-dorsal', sh).value;
    const row = { name: $('#mf-name', sh).value.trim(), nickname: $('#mf-nick', sh).value.trim() || null, emoji: $('#mf-emoji', sh).value.trim() || '⚽',
      position: $('#mf-pos', sh).value || null, dorsal: d === '' ? null : Math.max(0, Math.min(99, parseInt(d, 10))) };
    if (!row.name) return $('#mf-err', sh).textContent = 'El nombre no puede ir vacío.';
    if (!isNew) { Object.assign(row, vals, { bio: $('#mf-bio', sh).value.trim() || null }); if (dropPhoto) row.photo_url = null; }
    const btn = $('button[type=submit]', sh); btn.disabled = true;
    const { data, error } = isNew
      ? await sb.from('members').insert({ ...row, team_id: S.me.team_id }).select('id').single()
      : await sb.from('members').update(row).eq('id', m.id).select('id').single();
    if (error) { btn.disabled = false; return $('#mf-err', sh).textContent = errMsg(error); }
    if (dropPhoto) { const old = pathFromUrl(m.photo_url); if (old) sb.storage.from('media').remove([old]).catch(() => {}); }
    closeSheet(); toast(isNew ? `${row.name} ya está en la plantilla` : 'Ficha guardada');
    await loadData();
    if (isNew) location.hash = `jugador/${data.id}`; else refresh();
  };
}

/* ── Mi cuenta ─────────────────────────────────── */
async function meSheet() {
  const me = S.me, pushOn = await pushState();
  const sh = openSheet(`<div style="display:flex;gap:14px;align-items:center;margin-bottom:20px">${avatar(me, 'lg')}
      <div><h2 style="margin:0">${esc(me.name)}</h2><p class="label">${esc(TEAM.name)} · ${esc(TEAM.season)}${me.is_admin ? ' · admin' : ''}</p></div></div>
    <div class="menu">
      <a href="#jugador/${me.id}" data-close>${icon('user-list')}Mi ficha</a>
      <button data-a="push">${icon('bell')}Notificaciones<span class="switch ${pushOn ? 'on' : ''}" role="switch" aria-checked="${pushOn}"></span></button>
      <button data-a="pw">${icon('key')}Cambiar contraseña</button>
      ${me.is_admin ? `<div class="item" style="padding-left:var(--gut)">${icon('image')}<div class="grow">Espacio de fotos<div class="s" id="st-use">Calculando…</div></div></div>` : ''}
      <button data-a="out">${icon('log-off')}Cerrar sesión</button>
    </div>${installHint()}`);
  bindInstall(sh);
  $('[data-close]', sh).onclick = () => closeSheet(true);
  $('[data-a=pw]', sh).onclick = passwordSheet;
  $('[data-a=out]', sh).onclick = async () => { closeSheet(true); await disablePush(true); await sb.auth.signOut(); };
  $('[data-a=push]', sh).onclick = async () => {
    const sw = $('.switch', sh), on = sw.classList.contains('on');
    const ok = on ? await disablePush() : await enablePush();
    if (ok) { sw.classList.toggle('on', !on); sw.setAttribute('aria-checked', !on); }
  };
  if (me.is_admin) {
    const { data } = await sb.rpc('storage_usage');
    const u = data?.[0], el = $('#st-use', sh);
    if (u && el) el.textContent = `${(u.bytes / 1048576).toFixed(1).replace('.', ',')} MB en ${plural(+u.files, 'foto', 'fotos')} · ${(u.bytes / STORAGE_QUOTA * 100).toFixed(1).replace('.', ',')} % de 1 GB`;
  }
}
function passwordSheet() {
  const sh = openSheet(`<h2>Contraseña</h2><p class="lead">Elige una nueva. Se cambia al momento.</p>
    <form id="pw"><input type="text" autocomplete="username" value="${esc(emailFor(S.me.id))}" hidden>
      <div class="field"><label for="pw1">Nueva contraseña</label><input class="input" id="pw1" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="field"><label for="pw2">Repítela</label><input class="input" id="pw2" type="password" minlength="6" autocomplete="new-password" required></div>
      <p class="err" id="pw-err"></p><button class="btn" type="submit">Cambiar contraseña</button></form>`);
  $('#pw', sh).onsubmit = async e => {
    e.preventDefault();
    if ($('#pw1', sh).value !== $('#pw2', sh).value) return $('#pw-err', sh).textContent = 'Las contraseñas no coinciden.';
    const { error } = await sb.auth.updateUser({ password: $('#pw1', sh).value });
    if (error) return $('#pw-err', sh).textContent = errMsg(error);
    closeSheet(); toast('Contraseña cambiada');
  };
}

/* ── Notificaciones push ───────────────────────── */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function pushSub() { if (!pushSupported()) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
async function pushState() {
  try { return Notification.permission === 'granted' && !!(await Promise.race([pushSub(), new Promise(r => setTimeout(() => r(null), 800))])); }
  catch { return false; }
}
function b64ToBytes(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function saveSub(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw error;
}
async function enablePush() {
  if (!pushSupported()) {
    toast(isIOS() && !standalone() ? 'En iPhone, primero instala la app (Compartir → Añadir a pantalla de inicio) y actívalas desde ahí.' : 'Este navegador no admite notificaciones.');
    return false;
  }
  try {
    if (await Notification.requestPermission() !== 'granted') { toast('Permiso denegado. Actívalo en los ajustes del móvil.'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    await saveSub(sub);
    toast('Notificaciones activadas');
    return true;
  } catch (e) { toast(errMsg(e)); return false; }
}
async function disablePush(silent) {
  try {
    const sub = await Promise.race([pushSub(), new Promise(r => setTimeout(() => r(null), 800))]); if (!sub) return true;
    await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
    if (!silent) toast('Notificaciones desactivadas');
    return true;
  } catch (e) { if (!silent) toast(errMsg(e)); return false; }
}
// Si ya había permiso, la suscripción se vuelve a asociar al jugador que ha entrado.
async function syncPush() { try { if (Notification.permission !== 'granted') return; const sub = await pushSub(); if (sub) await saveSub(sub); } catch {} }

/* ── Fotos: se comprimen en el móvil antes de subir ── */
async function uploadImage(file, folder, { side, q, square = false }) {
  const { blob, w, h, ext } = await compress(file, side, q, square);
  if (blob.size > 1.4 * 1048576) throw new Error('La foto pesa demasiado incluso comprimida. Prueba con otra.');
  const path = `${S.me.team_id}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return { path, w, h };
}
async function compress(file, side, q, square) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen. Prueba con otra.')); i.src = URL.createObjectURL(file); });
  }
  let sx = 0, sy = 0, cw = src.width, ch = src.height;
  if (square) { const s = Math.min(cw, ch); sx = (cw - s) / 2; sy = (ch - s) / 2; cw = ch = s; }
  const k = Math.min(1, side / Math.max(cw, ch)), w = Math.round(cw * k), h = Math.round(ch * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h); src.close?.();
  const toBlob = type => new Promise(r => cv.toBlob(r, type, q));
  // WebP pesa ~30 % menos; Safari que no lo codifica devuelve PNG, y entonces se usa JPEG.
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return { blob, w, h, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}

boot().catch(e => {
  console.error(e);
  $('#app').innerHTML = `<div style="padding:40px 20px"><p class="err">No se pudo arrancar la app: ${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">Recargar</button></div>`;
});
})();
