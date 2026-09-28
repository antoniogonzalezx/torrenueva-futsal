/* ════════════════════════════════════════════════════════════
   Torrenueva FS · app de multas 2026/27
   Un único código para los dos equipos; cada carpeta (senior/, juvenil/)
   define window.TEAM y es una PWA instalable por separado.
   ════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ── Configuración ─────────────────────────────── */
const TEAM = window.TEAM;
const SUPA_URL = 'https://cmfhosxslodnrxlpifrn.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZmhvc3hzbG9kbnJ4bHBpZnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NDY2NTQsImV4cCI6MjA4NzIyMjY1NH0.c4-Zb79UQhshpzQH79gIoro3IBKEliEjBMlhjypa_dc';
const EMAIL_DOMAIN = 'jugadores.torrenuevafs.app';   // emails internos: <id-jugador>@… (nunca se envía correo)
const GIPHY_KEY = '';                               // opcional: clave gratuita de developers.giphy.com para buscar GIFs
const SEASON_START = '2026-07-01';
const MSG_PAGE = 60;

const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: { storageKey: `tfs-${TEAM.slug}-auth`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const S = {
  me: null, team: null, members: [], fines: [], credit: [],
  msgs: [], hasOlder: false, channel: null, installEvt: null,
  hist: { tab: 'paid', who: '' },
};

/* ── Utilidades ────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const nfmt = n => { n = round2(n); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','); };
const eur = n => nfmt(n) + ' €';
const store = {
  get(k) { try { return localStorage.getItem(`tfs-${TEAM.slug}-${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`tfs-${TEAM.slug}-${k}`, v); } catch {} },
};
const todayISO = () => new Date().toLocaleDateString('sv-SE');
const dayNum = iso => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 864e5);
const daysSince = iso => dayNum(todayISO()) - dayNum(iso);
const fmtDay = iso => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const monthKey = iso => new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const memberById = id => S.members.find(m => m.id === id);
const firstName = m => (m?.nickname || m?.name || '').split(' ')[0];

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
    FINE_NOT_FOUND: 'Esa multa ya no existe. Desliza para recargar.', ALREADY_PAID: 'Esa multa ya estaba pagada.',
    BAD_AMOUNT: 'El importe tiene que ser mayor que 0.', CANNOT_RELEASE_SELF: 'No puedes liberar tu propia cuenta.',
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (m.includes('23505') || m.includes('duplicate key')) return 'Ya hay un jugador con ese nombre.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Sin conexión. Inténtalo de nuevo.';
  return m;
}

/* ── Iconos (trazo 2px, 24×24) ─────────────────── */
const I = {
  fines: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  squad: '<path d="M9 3.5 4 6l1.8 4.5L8 9.8V20.5h8V9.8l2.2.7L20 6l-5-2.5a3 3 0 0 1-6 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8.5h3l1.8-3h6.4l1.8 3h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  send: '<path d="M5 12h13M12.5 6l6 6-6 6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-4.5-4.5-9 8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9.5 7V4h5v3M6 7l1 13h10l1-13"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l3 3"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.6 3.2 7.8 7.5 9 4.3-1.2 7.5-4.4 7.5-9V6z"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9.2a3.5 3.5 0 1 0 0 5.6M7.5 11h5.5M7.5 13h5.5"/>',
  unlink: '<path d="M9 15l6-6M10.5 6.5l1-1a4 4 0 0 1 5.7 5.7l-1 1M13.5 17.5l-1 1a4 4 0 0 1-5.7-5.7l1-1"/><path d="M4 4l16 16"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4M5.5 11.5v9h13v-9"/>',
};
const icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${I[n]}</svg>`;

function avatar(m, cls = '') {
  if (!m) return `<span class="av ${cls}">👤</span>`;
  const inner = m.photo_url ? `<img src="${esc(m.photo_url)}" alt="" loading="lazy">` : esc(m.emoji || '⚽');
  return `<span class="av ${cls}">${inner}</span>`;
}
const cardIcon = mu => mu === 4 ? '<i class="rcard r"></i>' : mu === 2 ? '<i class="rcard y"></i>' : '';

/* ── Sheets ────────────────────────────────────── */
function openSheet(html, { onClose } = {}) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
  scrim._onClose = onClose;
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';
  return scrim.firstElementChild;
}
function closeSheet(instant) {
  $$('.scrim').forEach(s => {
    s._onClose?.();
    if (instant) { s.remove(); return; }
    s.classList.add('closing');
    setTimeout(() => s.remove(), 170);
  });
  document.body.style.overflow = '';
}
function confirmSheet({ title, text, ok = 'Confirmar', danger = false }) {
  return new Promise(res => {
    let done = false;
    const sh = openSheet(`<h3>${esc(title)}</h3><p class="sub">${text}</p>
      <div class="actions"><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button>
      <button class="btn ghost" data-cancel>Cancelar</button></div>`, { onClose: () => { if (!done) res(false); } });
    $('[data-ok]', sh).onclick = () => { done = true; res(true); closeSheet(); };
    $('[data-cancel]', sh).onclick = () => closeSheet();
  });
}

/* ════════════════════════════════════════════════
   ARRANQUE
   ════════════════════════════════════════════════ */
async function boot() {
  document.documentElement.dataset.team = TEAM.slug;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

  // No llamar a Supabase dentro del callback (puede bloquear el cliente): se difiere.
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'SIGNED_OUT') setTimeout(() => { teardown(); renderAuth(); }, 0);
  });
  addEventListener('hashchange', () => S.me && route());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.me) { loadData().then(() => refreshView()); catchUpMsgs(); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterApp(); else renderAuth();
}

function teardown() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  Object.assign(S, { me: null, team: null, members: [], fines: [], credit: [], msgs: [] });
}

/* ════════════════════════════════════════════════
   ACCESO: entrar / crear cuenta
   ════════════════════════════════════════════════ */
async function renderAuth(mode = 'login', notice = '') {
  closeSheet(true);
  const app = $('#app');
  app.innerHTML = `<div class="auth">
    <header class="auth-hero">
      <span class="eyebrow">Temporada ${esc(TEAM.season)} · ${esc(TEAM.label)}</span>
      <h1>Torrenueva<span>${TEAM.slug === 'juvenil' ? 'FS Juvenil' : 'Futsal'}</span></h1>
      <p>Multas, plantilla y chat del vestuario. Solo para el equipo.</p>
    </header>
    <div class="auth-body">
      <div class="seg" role="group" aria-label="Acceso">
        <button type="button" data-mode="login" aria-pressed="${mode === 'login'}">Entrar</button>
        <button type="button" data-mode="signup" aria-pressed="${mode === 'signup'}">Crear cuenta</button>
      </div>
      <div id="auth-pane"><p class="tiny" style="padding:24px 4px">Cargando plantilla…</p></div>
      ${installHint()}
    </div></div>`;
  $$('[data-mode]', app).forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  bindInstall(app);

  let roster;
  try {
    const { data, error } = await sb.rpc('team_roster', { p_slug: TEAM.slug });
    if (error) throw error;
    roster = data;
  } catch (e) {
    $('#auth-pane').innerHTML = `<p class="err" style="margin-top:18px">No se pudo cargar la plantilla. ${esc(errMsg(e))}</p>
      <button class="btn ghost" id="retry">Reintentar</button>`;
    $('#retry').onclick = () => renderAuth(mode);
    return;
  }
  (mode === 'login' ? paneLogin : paneSignup)(roster, notice);
}

function pickGrid(list, selected) {
  return `<div class="pick" role="group">${list.map(p => `
    <button type="button" data-id="${p.id}" aria-pressed="${p.id === selected}">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>`;
}

function paneLogin(roster, notice) {
  const pane = $('#auth-pane');
  const list = roster.filter(p => p.claimed);
  if (!list.length) {
    pane.innerHTML = `<div class="note" style="margin-top:18px">Todavía no se ha registrado nadie. Pulsa <b>Crear cuenta</b> y busca tu nombre.</div>`;
    return;
  }
  let sel = list.some(p => p.id === store.get('last')) ? store.get('last') : null;
  pane.innerHTML = `${notice ? `<div class="note ok" style="margin-top:16px">${notice}</div>` : ''}
    <p class="lbl" style="margin-top:20px">¿Quién eres?</p>${pickGrid(list, sel)}
    <form class="pw-box" id="login-form" ${sel ? '' : 'hidden'} autocomplete="on">
      <input type="text" name="username" id="login-user" autocomplete="username" hidden>
      <div class="field"><label for="login-pw">Contraseña</label>
        <input class="input" type="password" id="login-pw" autocomplete="current-password" required minlength="6"></div>
      <p class="err" id="login-err"></p>
      <button class="btn" type="submit">Entrar</button>
    </form>`;
  const form = $('#login-form');
  const choose = id => {
    sel = id;
    $$('.pick button', pane).forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    $('#login-user').value = emailFor(id);
    form.hidden = false; $('#login-err').textContent = '';
    $('#login-pw').focus();
  };
  if (sel) $('#login-user').value = emailFor(sel);
  $$('.pick button', pane).forEach(b => b.onclick = () => choose(b.dataset.id));
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email: emailFor(sel), password: $('#login-pw').value });
    if (error) {
      btn.disabled = false; btn.textContent = 'Entrar';
      $('#login-err').textContent = /invalid/i.test(error.message) ? 'Contraseña incorrecta. Si no la recuerdas, pide a un admin que libere tu cuenta.' : errMsg(error);
      return;
    }
    store.set('last', sel);
    await enterApp();
  };
}

function paneSignup(roster) {
  const pane = $('#auth-pane');
  const list = roster.filter(p => !p.claimed);
  if (!list.length) {
    pane.innerHTML = `<div class="note" style="margin-top:18px">Todos los jugadores de la plantilla ya tienen cuenta. Si falta tu nombre, pide a un compañero que te añada desde <b>Plantilla</b>.</div>`;
    return;
  }
  let sel = null;
  pane.innerHTML = `<p class="lbl" style="margin-top:20px">Busca tu nombre</p>${pickGrid(list, null)}
    <form class="pw-box" id="signup-form" hidden autocomplete="on">
      <input type="text" name="username" id="su-user" autocomplete="username" hidden>
      <div class="note" id="su-who"></div>
      <div class="field"><label for="su-code">Código del equipo</label>
        <input class="input" id="su-code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Te lo pasan por el grupo" required></div>
      <div class="field"><label for="su-pw">Contraseña nueva</label>
        <input class="input" type="password" id="su-pw" autocomplete="new-password" minlength="6" required placeholder="Mínimo 6 caracteres"></div>
      <div class="field"><label for="su-pw2">Repite la contraseña</label>
        <input class="input" type="password" id="su-pw2" autocomplete="new-password" minlength="6" required></div>
      <p class="err" id="su-err"></p>
      <button class="btn" type="submit">Crear mi cuenta</button>
    </form>`;
  const form = $('#signup-form');
  $$('.pick button', pane).forEach(b => b.onclick = () => {
    sel = b.dataset.id;
    $$('.pick button', pane).forEach(x => x.setAttribute('aria-pressed', x === b));
    const p = list.find(x => x.id === sel);
    $('#su-who').innerHTML = `Vas a crear la cuenta de <b>${esc(p.name)}</b>. Solo tú deberías usarla.`;
    $('#su-user').value = emailFor(sel);
    form.hidden = false; $('#su-err').textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('#su-err'), btn = $('button[type=submit]', form);
    const code = $('#su-code').value.trim().toUpperCase(), pw = $('#su-pw').value;
    if (pw !== $('#su-pw2').value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    btn.disabled = true; btn.textContent = 'Creando cuenta…';
    const fail = m => { err.textContent = m; btn.disabled = false; btn.textContent = 'Crear mi cuenta'; };
    const chk = await sb.rpc('check_join', { p_member: sel, p_code: code });
    if (chk.error) return fail(errMsg(chk.error));
    if (chk.data === 'bad_code') return fail('El código del equipo no es correcto.');
    if (chk.data === 'taken') return fail('Ese jugador ya tiene cuenta. Si eres tú, pide a un admin que la libere.');
    if (chk.data !== 'ok') return fail('Ese jugador ya no está en la plantilla.');
    const { data, error } = await sb.auth.signUp({ email: emailFor(sel), password: pw, options: { data: { member_id: sel, join_code: code } } });
    if (error) return fail(/already/i.test(error.message) ? 'Ese jugador ya tiene cuenta.' : /password/i.test(error.message) ? 'La contraseña es demasiado débil. Usa al menos 6 caracteres.' : errMsg(error));
    store.set('last', sel);
    if (!data.session) {
      // El proyecto tiene activada la confirmación por email: la cuenta existe pero no puede entrar aún.
      return fail('Cuenta creada, pero Supabase pide confirmar el email. Un admin debe desactivar «Confirm email» en Authentication → Sign In / Providers → Email.');
    }
    await enterApp();
  };
}
const emailFor = id => `${id}@${EMAIL_DOMAIN}`;

function installHint() {
  if (standalone()) return '';
  const ios = isIOS();
  return `<div class="install" id="install-hint">${icon(ios ? 'share' : 'download')}
    <div class="grow">${ios ? 'Instálala: pulsa <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.' : 'Instala la app en tu móvil para abrirla como una app más.'}</div>
    ${ios ? '' : '<button class="btn sm" style="width:auto" data-install>Instalar</button>'}</div>`;
}
function bindInstall(root) {
  const b = $('[data-install]', root); if (!b) return;
  b.onclick = async () => {
    if (!S.installEvt) { toast('Abre el menú del navegador y elige «Instalar app».'); return; }
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
  if (error) { renderAuth('login'); toast(errMsg(error)); return; }
  if (!me) { await sb.auth.signOut(); return renderAuth('login'); }
  S.me = me;
  renderShell();
  await Promise.all([loadData(), loadMsgs()]);
  subscribe();
  route();
}

function renderShell() {
  $('#app').innerHTML = `<div class="shell">
    <header class="top" id="top"></header>
    <main class="view" id="view"></main>
    <nav class="tabs" aria-label="Secciones">
      ${tab('multas', 'Multas', 'fines')}${tab('chat', 'Chat', 'chat')}${tab('historial', 'Historial', 'history')}${tab('plantilla', 'Plantilla', 'squad')}
    </nav>
    <button class="fab" id="fab" hidden>${icon('plus')}Multa</button>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>`;
  $('#fab').onclick = () => fineSheet();
  addEventListener('scroll', () => $('#top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
}
const tab = (r, l, ic) => `<a class="tab" href="#${r}" data-tab="${r}">${icon(ic)}<span>${l}</span>${r === 'chat' ? '<span class="badge" id="chat-badge" hidden></span>' : ''}</a>`;

async function loadData() {
  const [m, f, c, t] = await Promise.all([
    sb.from('members').select('*').order('name'),
    sb.from('fines').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('credit_log').select('*').order('created_at', { ascending: false }).limit(300),
    sb.from('teams').select('*').maybeSingle(),
  ]);
  const err = m.error || f.error || c.error || t.error;
  if (err) { toast(errMsg(err)); return; }
  S.members = m.data; S.fines = f.data; S.credit = c.data; S.team = t.data;
  const me = S.members.find(x => x.id === S.me.id);
  if (!me || !me.active) { await sb.auth.signOut(); return; }
  S.me = me;
}

let reloadT;
function scheduleReload() {
  clearTimeout(reloadT);
  reloadT = setTimeout(async () => { await loadData(); refreshView(); }, 350);
}
function subscribe() {
  const tid = S.me.team_id;
  S.channel = sb.channel(`team-${tid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fines', filter: `team_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `team_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${tid}` }, p => addMsgs([p.new]))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => removeMsg(p.old?.id))
    .subscribe();
}

/* ── Router ────────────────────────────────────── */
function current() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('jugador/')) return { name: 'jugador', id: h.slice(8) };
  return { name: ['chat', 'historial', 'plantilla'].includes(h) ? h : 'multas' };
}
function route() { closeSheet(true); scrollTo(0, 0); refreshView(true); }

function refreshView(fresh = false) {
  if (!S.me || !$('#view')) return;
  const r = current();
  const view = $('#view');
  if (r.name === 'chat' && !fresh) { updateBadge(); return; }   // el chat se actualiza por su cuenta
  const y = scrollY;
  view.className = 'view' + (r.name === 'chat' ? ' chat-mode' : '');
  $$('.tab').forEach(t => t.toggleAttribute('aria-current', false));
  $(`.tab[data-tab="${r.name === 'jugador' ? 'plantilla' : r.name}"]`)?.setAttribute('aria-current', 'page');
  $('#fab').hidden = r.name !== 'multas';
  ({ multas: viewFines, chat: viewChat, historial: viewHistory, plantilla: viewSquad, jugador: viewProfile })[r.name](view, r);
  if (!fresh) scrollTo(0, y);
  if (fresh) view.style.animation = 'none', view.offsetHeight, view.style.animation = '';
  updateBadge();
}

function header(title, { back = false, eyebrow } = {}) {
  const me = S.me;
  $('#top').innerHTML = `
    ${back ? `<button class="icon-btn" id="back" aria-label="Volver">${icon('back')}</button>` : ''}
    <div class="top-title"><span class="eyebrow">${esc(eyebrow || `${TEAM.label} · ${TEAM.season}`)}</span><h1>${esc(title)}</h1></div>
    <button class="icon-btn me-btn" id="me-btn" aria-label="Mi cuenta">${avatar(me, 'sm')}</button>`;
  $('#me-btn').onclick = meSheet;
  if (back) $('#back').onclick = () => history.length > 1 ? history.back() : (location.hash = 'plantilla');
}

/* ════════════════════════════════════════════════
   MULTAS (pantalla principal)
   ════════════════════════════════════════════════ */
function viewFines(view) {
  header('Multas');
  const pend = S.fines.filter(f => !f.paid);
  const total = pend.reduce((s, f) => s + due(f), 0);
  const groups = new Map();
  pend.forEach(f => { if (!groups.has(f.member_id)) groups.set(f.member_id, []); groups.get(f.member_id).push(f); });
  const ordered = [...groups.entries()].map(([id, ff]) => ({ m: memberById(id), ff, tot: ff.reduce((s, f) => s + due(f), 0), mx: Math.max(...ff.map(mult)) }))
    .sort((a, b) => b.tot - a.tot);
  const y = pend.filter(f => mult(f) === 2).length, r = pend.filter(f => mult(f) === 4).length;
  const creditTot = S.members.reduce((s, m) => s + Number(m.credit || 0), 0);
  const mine = groups.get(S.me.id) || [];
  const myDue = mine.reduce((s, f) => s + due(f), 0);

  view.innerHTML = `
    <section class="board" aria-label="Resumen">
      <span class="eyebrow">Bote pendiente</span>
      <div class="board-amt"><span class="num">${nfmt(total)}</span><span class="cur">€</span></div>
      <div class="board-sub">${pend.length} multa${pend.length !== 1 ? 's' : ''} · ${groups.size} jugador${groups.size !== 1 ? 'es' : ''} con deuda</div>
      <div class="board-chips">
        ${y ? `<span class="bchip"><i class="rcard y"></i><b>${y}</b> a ×2</span>` : ''}
        ${r ? `<span class="bchip"><i class="rcard r"></i><b>${r}</b> a ×4</span>` : ''}
        ${creditTot > 0 ? `<span class="bchip">Saldo a favor <b>${eur(creditTot)}</b></span>` : ''}
        ${!y && !r ? '<span class="bchip">Ninguna duplicada</span>' : ''}
      </div>
    </section>
    <a class="mine" href="#jugador/${S.me.id}">${avatar(S.me)}
      <div class="grow"><strong>Tu cuenta</strong><div class="tiny">${mine.length ? `${mine.length} pendiente${mine.length !== 1 ? 's' : ''}` : 'Al día'}${Number(S.me.credit) > 0 ? ` · saldo ${eur(S.me.credit)}` : ''}</div></div>
      <span class="num ${myDue ? '' : 'zero'}">${eur(myDue)}</span></a>
    <div class="sec"><h2>Pendientes</h2><span class="tiny">×2 a los 15 días · ×4 a los 29</span></div>
    ${ordered.length ? ordered.map(debtorCard).join('') : `<div class="empty"><div class="num">0 €</div><p>Nadie debe nada. De momento.</p></div>`}`;
  $$('[data-fine]', view).forEach(b => b.onclick = () => fineActions(b.dataset.fine));
}

function debtorCard({ m, ff, tot, mx }) {
  const cls = mx === 4 ? 'hot' : mx === 2 ? 'warm' : '';
  return `<article class="debtor ${cls}">
    <a class="debtor-h" href="#jugador/${m?.id}">${avatar(m)}
      <div class="grow"><div class="name">${esc(m?.name || '¿?')}</div>
        <div class="meta">${ff.length} multa${ff.length !== 1 ? 's' : ''}${Number(m?.credit) > 0 ? ` · saldo ${eur(m.credit)}` : ''}</div></div>
      <span class="num tot">${eur(tot)}</span></a>
    ${ff.map(fineRow).join('')}
  </article>`;
}
function fineRow(f) {
  const mu = mult(f), nj = nextJump(f);
  const when = [fmtDay(f.date)];
  if (nj && nj.days <= 7) when.push(`×${nj.to} en ${nj.days} día${nj.days !== 1 ? 's' : ''}`);
  return `<button class="fine" data-fine="${f.id}">
    <div class="grow"><div class="why">${esc(f.reason || 'Sin motivo')}</div>
      <div class="when">${cardIcon(mu)}${when.map(esc).join(' · ')}${f.kind === 'cobro' ? ' <span class="tag">cobro</span>' : ''}${f.credit_used > 0 ? ' <span class="tag ok">saldo</span>' : ''}</div></div>
    <div class="amt"><span class="num">${eur(due(f))}</span>${mu > 1 || f.credit_used > 0 ? `<s>${eur(f.amount)}</s>` : ''}</div>
  </button>`;
}

function fineActions(id) {
  const f = S.fines.find(x => x.id === id); if (!f) return;
  const m = memberById(f.member_id);
  const sh = openSheet(`<h3>${esc(f.reason || 'Multa')}</h3>
    <p class="sub">${esc(m?.name)} · ${fmtDay(f.date)} · ${f.kind === 'cobro' ? 'cobro, no se duplica' : mult(f) > 1 ? `multa a ×${mult(f)}` : 'multa'}</p>
    <div class="actions">
      <button class="action" data-a="pay">${icon('coin')}<span>Marcar como pagada · ${eur(due(f))}</span></button>
      <button class="action" data-a="player">${icon('user')}<span>Ver ficha de ${esc(firstName(m))}</span></button>
      <button class="action danger" data-a="del">${icon('trash')}<span>Borrar multa</span></button>
    </div>`);
  $('[data-a=pay]', sh).onclick = () => paySheet(f);
  $('[data-a=player]', sh).onclick = () => { closeSheet(true); location.hash = `jugador/${f.member_id}`; };
  $('[data-a=del]', sh).onclick = async () => {
    if (!await confirmSheet({ title: 'Borrar multa', text: `Se borra «${esc(f.reason || 'multa')}» de ${esc(m?.name)}. Si se había usado saldo, se le devuelve.`, ok: 'Borrar', danger: true })) return;
    const { error } = await sb.rpc('delete_fine', { p_fine: f.id });
    if (error) return toast(errMsg(error));
    toast('Multa borrada'); await loadData(); refreshView();
  };
}

function paySheet(f) {
  const m = memberById(f.member_id);
  const d = due(f), credit = Number(m?.credit || 0), useC = Math.min(credit, d), toPay = round2(d - useC);
  const sh = openSheet(`<h3>Pagar</h3><p class="sub">${esc(m?.name)} · ${esc(f.reason || 'multa')}</p>
    <div class="pay-lines">
      <div><span>Importe</span><span>${eur(base(f))}</span></div>
      ${mult(f) > 1 ? `<div><span>${cardIcon(mult(f))} Duplicada ×${mult(f)}</span><span>${eur(d)}</span></div>` : ''}
      ${useC > 0 ? `<div><span>Saldo a favor aplicado</span><span>−${eur(useC)}</span></div>` : ''}
      <div class="total"><span>A pagar</span><span>${eur(toPay)}</span></div>
    </div>
    <div class="field"><label for="pay-cash">Dinero entregado (€)</label>
      <input class="input" id="pay-cash" type="number" inputmode="decimal" min="0" step="0.5" value="${toPay}"></div>
    <p class="note" id="pay-extra" hidden></p><p class="err" id="pay-err"></p>
    <button class="btn" id="pay-ok">${icon('check')}Confirmar pago</button>`);
  const inp = $('#pay-cash', sh), extra = $('#pay-extra', sh), err = $('#pay-err', sh);
  const upd = () => {
    const c = parseFloat(String(inp.value).replace(',', '.')) || 0, ex = round2(c - toPay);
    extra.hidden = !(ex > 0); extra.innerHTML = `Sobran <b>${eur(ex)}</b>: quedan como saldo a favor de ${esc(firstName(m))} para la próxima multa.`;
    err.textContent = c < toPay ? `Faltan ${eur(toPay - c)} para saldarla.` : '';
    $('#pay-ok', sh).disabled = c < toPay;
  };
  inp.oninput = upd; upd();
  $('#pay-ok', sh).onclick = async () => {
    const btn = $('#pay-ok', sh); btn.disabled = true;
    const { error } = await sb.rpc('pay_fine', { p_fine: f.id, p_cash: parseFloat(String(inp.value).replace(',', '.')) || 0 });
    if (error) { btn.disabled = false; err.textContent = errMsg(error); return; }
    closeSheet(); toast(`Pagada. ${firstName(m)} respira.`); await loadData(); refreshView();
  };
}

const REASONS = ['Llegar tarde', 'Faltar a entreno', 'Olvidar equipación', 'Móvil en el vestuario', 'Tarjeta amarilla', 'Tarjeta roja'];
function fineSheet(preset) {
  const pls = S.members.filter(m => m.active);
  const sh = openSheet(`<h3>Nueva multa</h3><p class="sub">Si el jugador tiene saldo a favor, se descuenta solo.</p>
    <form id="fine-form">
      <div class="field"><label for="nf-who">Jugador</label>
        <select class="input" id="nf-who" required><option value="">Elige jugador…</option>
        ${pls.map(p => `<option value="${p.id}" ${p.id === preset ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="nf-why">Motivo</label>
        <input class="input" id="nf-why" maxlength="140" placeholder="¿Qué ha hecho?" autocomplete="off">
        <div class="chips" style="margin-top:4px">${REASONS.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      <div class="f-row">
        <div class="field"><label for="nf-amt">Importe (€)</label><input class="input" id="nf-amt" type="number" inputmode="decimal" min="0.5" step="0.5" value="1" required></div>
        <div class="field"><label for="nf-date">Fecha</label><input class="input" id="nf-date" type="date" value="${todayISO()}" max="${todayISO()}" required></div>
      </div>
      <div class="field"><span class="lbl">Tipo</span>
        <div class="seg" role="group"><button type="button" data-k="multa" aria-pressed="true">Multa · se duplica</button><button type="button" data-k="cobro" aria-pressed="false">Cobro · fijo</button></div></div>
      <p class="err" id="nf-err"></p>
      <button class="btn" type="submit">${icon('plus')}Poner multa</button>
    </form>`);
  let kind = 'multa';
  $$('[data-r]', sh).forEach(b => b.onclick = () => { $('#nf-why', sh).value = b.dataset.r; $$('[data-r]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $$('[data-k]', sh).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('[data-k]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#fine-form', sh).onsubmit = async e => {
    e.preventDefault();
    const who = $('#nf-who', sh).value, amt = parseFloat(String($('#nf-amt', sh).value).replace(',', '.'));
    if (!who) return $('#nf-err', sh).textContent = 'Elige a quién multar.';
    if (!(amt > 0)) return $('#nf-err', sh).textContent = 'El importe tiene que ser mayor que 0.';
    const btn = $('button[type=submit]', sh); btn.disabled = true;
    const { data, error } = await sb.rpc('add_fine', { p_member: who, p_amount: amt, p_reason: $('#nf-why', sh).value, p_date: $('#nf-date', sh).value, p_kind: kind });
    if (error) { btn.disabled = false; $('#nf-err', sh).textContent = errMsg(error); return; }
    closeSheet();
    const m = memberById(who);
    toast(data?.paid ? `Multa a ${firstName(m)}, pagada con su saldo` : `Multa a ${firstName(m)}: ${eur(amt)}`);
    await loadData(); refreshView();
  };
}

/* ════════════════════════════════════════════════
   HISTORIAL
   ════════════════════════════════════════════════ */
function viewHistory(view) {
  header('Historial');
  const paid = S.fines.filter(f => f.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
  const season = paid.filter(f => (f.paid_at || '') >= SEASON_START);
  const thisMonth = monthKey(new Date().toISOString());
  const sum = arr => arr.reduce((s, f) => s + Number(f.paid_total || 0), 0);
  const monthPaid = season.filter(f => monthKey(f.paid_at) === thisMonth);
  const rank = {};
  season.forEach(f => rank[f.member_id] = (rank[f.member_id] || 0) + Number(f.paid_total || 0));
  const top = Object.entries(rank).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMax = top[0]?.[1] || 1;
  const who = S.hist.who;

  view.innerHTML = `
    <div class="tiles">
      <div class="tile"><span class="eyebrow">Recaudado</span><span class="num">${eur(sum(season))}</span></div>
      <div class="tile"><span class="eyebrow">Este mes</span><span class="num">${eur(sum(monthPaid))}</span></div>
      <div class="tile"><span class="eyebrow">Pagadas</span><span class="num">${season.length}</span></div>
    </div>
    ${top.length ? `<div class="sec"><h2>Más ha aportado</h2><span class="tiny">temporada</span></div>
    <div class="list">${top.map(([id, v], i) => { const m = memberById(id); return `<a class="row" href="#jugador/${id}">
      <span class="num" style="width:18px;font-size:1.2rem;color:var(--ink-3)">${i + 1}</span>${avatar(m, 'sm')}
      <div class="grow"><div class="t">${esc(m?.name)}</div><div class="bar"><i style="width:${Math.max(6, v / topMax * 100)}%"></i></div></div>
      <span class="v">${eur(v)}</span></a>`; }).join('')}</div>` : ''}
    <div class="sec"><h2>Movimientos</h2></div>
    <div class="seg" role="group"><button type="button" data-t="paid" aria-pressed="${S.hist.tab === 'paid'}">Multas pagadas</button><button type="button" data-t="credit" aria-pressed="${S.hist.tab === 'credit'}">Saldo a favor</button></div>
    <div class="filter"><select class="input" id="h-who" aria-label="Filtrar por jugador"><option value="">Todo el equipo</option>
      ${S.members.map(m => `<option value="${m.id}" ${m.id === who ? 'selected' : ''}>${esc(m.emoji)} ${esc(m.name)}</option>`).join('')}</select></div>
    <div id="h-list"></div>`;
  $$('[data-t]', view).forEach(b => b.onclick = () => { S.hist.tab = b.dataset.t; refreshView(); });
  $('#h-who', view).onchange = e => { S.hist.who = e.target.value; refreshView(); };

  const box = $('#h-list', view);
  if (S.hist.tab === 'paid') {
    const rows = paid.filter(f => !who || f.member_id === who);
    if (!rows.length) { box.innerHTML = `<div class="empty"><p>Aún no hay multas pagadas${who ? ' de este jugador' : ''}.</p></div>`; return; }
    const byMonth = new Map();
    rows.forEach(f => { const k = monthKey(f.paid_at); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(f); });
    box.innerHTML = `<div class="list">${[...byMonth].map(([k, ff]) => `<div class="month-h"><span>${esc(k)}</span><span>${eur(sum(ff))}</span></div>` +
      ff.map(f => { const m = memberById(f.member_id); return `<div class="row">${avatar(m, 'sm')}
        <div class="grow"><div class="t">${esc(m?.name)} <span class="muted" style="font-weight:500">· ${esc(f.reason || 'sin motivo')}</span></div>
        <div class="s">${f.kind === 'cobro' ? 'Cobro' : 'Multa'} del ${fmtDay(f.date)} · pagada el ${fmtDay(f.paid_at)}${f.paid_by ? ` · apuntó ${esc(firstName(memberById(f.paid_by)))}` : ''}</div></div>
        ${f.paid_mult > 1 ? `<span class="tag ${f.paid_mult === 4 ? 'r' : 'y'}">×${f.paid_mult}</span>` : ''}
        <span class="v">${eur(f.paid_total || 0)}</span></div>`; }).join('')).join('')}</div>`;
  } else {
    const rows = S.credit.filter(c => !who || c.member_id === who);
    if (!rows.length) { box.innerHTML = `<div class="empty"><p>Sin movimientos de saldo. Cuando alguien paga de más, aparece aquí.</p></div>`; return; }
    box.innerHTML = `<div class="list">${rows.map(c => { const m = memberById(c.member_id); return `<div class="row">${avatar(m, 'sm')}
      <div class="grow"><div class="t">${esc(m?.name)}</div><div class="s">${esc(c.reason)} · ${fmtDay(c.created_at)}</div></div>
      <span class="v ${c.delta > 0 ? 'pos' : 'neg'}">${c.delta > 0 ? '+' : '−'}${eur(Math.abs(c.delta))}</span></div>`; }).join('')}</div>`;
  }
}

/* ════════════════════════════════════════════════
   PLANTILLA
   ════════════════════════════════════════════════ */
const POSITIONS = ['Portero', 'Cierre', 'Ala', 'Pívot', 'Universal', 'Entrenador', 'Staff'];
function viewSquad(view) {
  header('Plantilla');
  const act = S.members.filter(m => m.active);
  const sort = (a, b) => (a.dorsal ?? 999) - (b.dorsal ?? 999) || a.name.localeCompare(b.name, 'es');
  const gk = act.filter(m => m.position === 'Portero').sort(sort);
  const staff = act.filter(m => ['Entrenador', 'Staff'].includes(m.position)).sort(sort);
  const outfield = act.filter(m => !gk.includes(m) && !staff.includes(m)).sort(sort);
  const card = m => `<a class="pcard" href="#jugador/${m.id}">
    <span class="dot ${m.user_id ? 'on' : ''}"></span>${m.dorsal != null ? `<span class="dorsal">${m.dorsal}</span>` : ''}
    ${avatar(m)}<span class="nm">${esc(m.name)}</span><span class="ps">${esc(m.position || 'Jugador')}</span></a>`;
  const group = (t, list, add) => list.length || add ? `<div class="sec"><h2>${t}</h2><span class="tiny">${list.length}</span></div>
    <div class="squad">${list.map(card).join('')}${add ? `<button class="pcard add-card" id="add-player">${icon('plus')}Añadir</button>` : ''}</div>` : '';
  const registered = act.filter(m => m.user_id).length;
  view.innerHTML = `${group('Porteros', gk)}${group('Jugadores', outfield, true)}${group('Cuerpo técnico', staff)}
    <div class="legend"><span><i class="on"></i>Con cuenta (${registered})</span><span><i></i>Sin registrar (${act.length - registered})</span></div>`;
  $('#add-player', view).onclick = () => memberSheet();
}

/* ── Ficha de jugador ──────────────────────────── */
function viewProfile(view, r) {
  const m = memberById(r.id);
  header(m ? 'Ficha' : 'Jugador', { back: true, eyebrow: 'Plantilla' });
  if (!m) { view.innerHTML = `<div class="empty"><p>Este jugador ya no está en la plantilla.</p></div>`; return; }
  const pend = S.fines.filter(f => !f.paid && f.member_id === m.id);
  const paidSeason = S.fines.filter(f => f.paid && f.member_id === m.id && (f.paid_at || '') >= SEASON_START);
  const debt = pend.reduce((s, f) => s + due(f), 0);
  const paidTot = paidSeason.reduce((s, f) => s + Number(f.paid_total || 0), 0);
  const gpm = m.matches ? (m.goals / m.matches).toFixed(2).replace('.', ',') : '—';
  const isMe = m.id === S.me.id, admin = S.me.is_admin && !isMe;
  const stat = (lbl, v, extra = '') => `<div class="stat"><span class="eyebrow">${extra}${lbl}</span><span class="num">${v}</span></div>`;

  view.innerHTML = `
    <section class="profile-hero">
      ${m.dorsal != null ? `<span class="big-dorsal" aria-hidden="true">${m.dorsal}</span>` : ''}
      <div class="photo">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="Foto de ${esc(m.name)}">` : `<span>${esc(m.emoji || '⚽')}</span>`}
        <button class="photo-edit" id="photo-btn" aria-label="Cambiar foto">${icon('camera')}</button></div>
      <div class="who"><h2>${esc(m.name)}</h2>${m.nickname ? `<div class="nick">«${esc(m.nickname)}»</div>` : ''}
        <div class="chips">${m.dorsal != null ? `<span class="bchip">Dorsal <b>${m.dorsal}</b></span>` : ''}<span class="bchip">${esc(m.position || 'Jugador')}</span>${m.is_admin ? '<span class="bchip">Admin</span>' : ''}</div></div>
      <input type="file" id="photo-in" accept="image/*" hidden>
    </section>
    <div class="sec"><h2>Temporada</h2><span class="tiny">${m.matches ? `${gpm} goles por partido` : 'Edita para sumar'}</span></div>
    <div class="stats">
      ${stat('Partidos', m.matches)}${stat('Goles', m.goals)}${stat('Asistencias', m.assists)}
      ${stat('MVP', m.mvps)}${stat('Amarillas', m.yellow_cards, '<i class="rcard y"></i>')}${stat('Rojas', m.red_cards, '<i class="rcard r"></i>')}
    </div>
    ${m.bio ? `<div class="bio">${esc(m.bio)}</div>` : ''}
    <div class="btn-row"><button class="btn ghost" id="edit-btn">${icon('edit')}Editar ficha</button><button class="btn ghost" id="fine-btn">${icon('plus')}Multar</button></div>
    <div class="sec"><h2>Caja</h2></div>
    <div class="tiles">
      <div class="tile"><span class="eyebrow">Debe</span><span class="num" style="color:${debt ? 'var(--danger)' : 'var(--ok)'}">${eur(debt)}</span></div>
      <div class="tile"><span class="eyebrow">Ha pagado</span><span class="num">${eur(paidTot)}</span></div>
      <div class="tile"><span class="eyebrow">Saldo</span><span class="num">${eur(m.credit || 0)}</span></div>
    </div>
    ${pend.length ? `<div class="debtor" style="margin-top:12px">${pend.map(fineRow).join('')}</div>` : ''}
    ${admin ? `<div class="sec"><h2>Admin</h2></div><div class="actions">
      ${m.user_id ? `<button class="action" data-adm="release">${icon('unlink')}<span>Liberar cuenta (olvidó la contraseña)</span></button>` : ''}
      <button class="action" data-adm="admin">${icon('shield')}<span>${m.is_admin ? 'Quitar admin' : 'Hacer admin'}</span></button>
      <button class="action danger" data-adm="off">${icon('trash')}<span>Dar de baja</span></button></div>` : ''}
    <p class="tiny" style="margin-top:18px;text-align:center">${m.user_id ? 'Tiene cuenta en la app' : 'Aún no se ha registrado'} · editado ${fmtDay(m.updated_at)}</p>`;

  $$('[data-fine]', view).forEach(b => b.onclick = () => fineActions(b.dataset.fine));
  $('#edit-btn', view).onclick = () => memberSheet(m);
  $('#fine-btn', view).onclick = () => fineSheet(m.id);
  $('#photo-btn', view).onclick = () => $('#photo-in', view).click();
  $('#photo-in', view).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    toast('Subiendo foto…');
    try {
      const up = await uploadImage(file, 'avatars', { maxSide: 720, square: true });
      const { error } = await sb.from('members').update({ photo_url: up.url }).eq('id', m.id);
      if (error) throw error;
      toast('Foto actualizada'); await loadData(); refreshView();
    } catch (err) { toast(errMsg(err)); }
  };
  $$('[data-adm]', view).forEach(b => b.onclick = () => adminAction(b.dataset.adm, m));
}

async function adminAction(kind, m) {
  if (kind === 'release') {
    if (!await confirmSheet({ title: 'Liberar cuenta', text: `${esc(m.name)} tendrá que crear la cuenta otra vez con el código del equipo y una contraseña nueva. Sus multas y estadísticas no se tocan.`, ok: 'Liberar' })) return;
    const { error } = await sb.rpc('admin_release_member', { p_member: m.id });
    if (error) return toast(errMsg(error));
    toast('Cuenta liberada');
  } else if (kind === 'admin') {
    const { error } = await sb.rpc('admin_set_admin', { p_member: m.id, p_admin: !m.is_admin });
    if (error) return toast(errMsg(error));
    toast(m.is_admin ? 'Ya no es admin' : 'Ahora es admin');
  } else if (kind === 'off') {
    if (!await confirmSheet({ title: 'Dar de baja', text: `${esc(m.name)} desaparece de la plantilla y pierde el acceso. Su historial de multas se conserva.`, ok: 'Dar de baja', danger: true })) return;
    const { error } = await sb.rpc('admin_set_active', { p_member: m.id, p_active: false });
    if (error) return toast(errMsg(error));
    toast('Baja registrada'); location.hash = 'plantilla';
  }
  await loadData(); refreshView();
}

function memberSheet(m) {
  const isNew = !m;
  m = m || { name: '', nickname: '', emoji: '⚽', position: '', dorsal: null, bio: '', matches: 0, goals: 0, assists: 0, mvps: 0, yellow_cards: 0, red_cards: 0 };
  const STATS = [['matches', 'Partidos'], ['goals', 'Goles'], ['assists', 'Asistencias'], ['mvps', 'MVP'], ['yellow_cards', 'Amarillas'], ['red_cards', 'Rojas']];
  const vals = Object.fromEntries(STATS.map(([k]) => [k, m[k] || 0]));
  const sh = openSheet(`<h3>${isNew ? 'Añadir jugador' : 'Editar ficha'}</h3>
    <p class="sub">${isNew ? 'Aparecerá en la plantilla y podrá crear su cuenta con el código del equipo.' : 'Cualquier jugador del equipo puede actualizar esta ficha.'}</p>
    <form id="m-form">
      <div class="field"><label for="mf-name">Nombre</label><input class="input" id="mf-name" maxlength="40" required value="${esc(m.name)}"></div>
      <div class="f-row">
        <div class="field"><label for="mf-nick">Apodo</label><input class="input" id="mf-nick" maxlength="40" value="${esc(m.nickname || '')}"></div>
        <div class="field"><label for="mf-emoji">Emoji</label><input class="input" id="mf-emoji" maxlength="16" value="${esc(m.emoji || '')}" style="font-size:22px"></div>
      </div>
      <div class="f-row">
        <div class="field"><label for="mf-pos">Posición</label><select class="input" id="mf-pos"><option value="">Jugador</option>
          ${POSITIONS.map(p => `<option ${p === m.position ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field"><label for="mf-dorsal">Dorsal</label><input class="input" id="mf-dorsal" type="number" inputmode="numeric" min="0" max="99" value="${m.dorsal ?? ''}"></div>
      </div>
      ${isNew ? '' : `<span class="lbl">Estadísticas</span><div class="stepper-grid" style="margin-top:6px">
        ${STATS.map(([k, l]) => `<div class="stepper"><span class="lbl">${l}</span><div class="ctl">
          <button type="button" data-dec="${k}" aria-label="Restar ${l}">−</button><output id="st-${k}">${vals[k]}</output>
          <button type="button" data-inc="${k}" aria-label="Sumar ${l}">+</button></div></div>`).join('')}</div>
      <div class="field"><label for="mf-bio">Sobre él</label><textarea class="input" id="mf-bio" maxlength="280" placeholder="Pierna buena, frase mítica, lo que sea">${esc(m.bio || '')}</textarea></div>
      ${m.photo_url ? '<button type="button" class="link-btn" id="mf-nophoto">Quitar foto</button>' : ''}`}
      <p class="err" id="mf-err"></p>
      <button class="btn" type="submit">${isNew ? 'Añadir a la plantilla' : 'Guardar'}</button>
    </form>`);
  $$('[data-inc]', sh).forEach(b => b.onclick = () => { vals[b.dataset.inc]++; $(`#st-${b.dataset.inc}`, sh).textContent = vals[b.dataset.inc]; });
  $$('[data-dec]', sh).forEach(b => b.onclick = () => { vals[b.dataset.dec] = Math.max(0, vals[b.dataset.dec] - 1); $(`#st-${b.dataset.dec}`, sh).textContent = vals[b.dataset.dec]; });
  let dropPhoto = false;
  const np = $('#mf-nophoto', sh);
  if (np) np.onclick = () => { dropPhoto = true; np.textContent = 'La foto se quitará al guardar'; np.disabled = true; };
  $('#m-form', sh).onsubmit = async e => {
    e.preventDefault();
    const d = $('#mf-dorsal', sh).value;
    const row = {
      name: $('#mf-name', sh).value.trim(), nickname: $('#mf-nick', sh).value.trim() || null,
      emoji: $('#mf-emoji', sh).value.trim() || '⚽', position: $('#mf-pos', sh).value || null,
      dorsal: d === '' ? null : Math.max(0, Math.min(99, parseInt(d, 10))),
    };
    if (!row.name) return $('#mf-err', sh).textContent = 'El nombre no puede ir vacío.';
    if (!isNew) { Object.assign(row, vals, { bio: $('#mf-bio', sh).value.trim() || null }); if (dropPhoto) row.photo_url = null; }
    const btn = $('button[type=submit]', sh); btn.disabled = true;
    const q = isNew ? sb.from('members').insert({ ...row, team_id: S.me.team_id }).select('id').single()
                    : sb.from('members').update(row).eq('id', m.id).select('id').single();
    const { data, error } = await q;
    if (error) { btn.disabled = false; $('#mf-err', sh).textContent = errMsg(error); return; }
    closeSheet(); toast(isNew ? `${row.name} añadido a la plantilla` : 'Ficha guardada');
    await loadData();
    if (isNew) location.hash = `jugador/${data.id}`; else refreshView();
  };
}

/* ── Mi cuenta ─────────────────────────────────── */
function meSheet() {
  const me = S.me;
  const sh = openSheet(`<div style="display:flex;gap:14px;align-items:center;margin-bottom:18px">${avatar(me, 'lg')}
      <div><h3 style="margin:0">${esc(me.name)}</h3><p class="tiny">${esc(S.team?.name || TEAM.name)} · ${esc(TEAM.season)}${me.is_admin ? ' · admin' : ''}</p></div></div>
    <div class="actions">
      <button class="action" data-a="me">${icon('user')}<span>Mi ficha</span></button>
      <button class="action" data-a="pw">${icon('key')}<span>Cambiar contraseña</span></button>
      <button class="action danger" data-a="out">${icon('logout')}<span>Cerrar sesión</span></button>
    </div>${installHint()}`);
  bindInstall(sh);
  $('[data-a=me]', sh).onclick = () => { closeSheet(true); location.hash = `jugador/${me.id}`; };
  $('[data-a=pw]', sh).onclick = passwordSheet;
  $('[data-a=out]', sh).onclick = async () => { closeSheet(true); await sb.auth.signOut(); };
}
function passwordSheet() {
  const sh = openSheet(`<h3>Contraseña</h3><p class="sub">Elige una nueva. Se cambia al momento.</p>
    <form id="pw-form"><input type="text" autocomplete="username" value="${esc(emailFor(S.me.id))}" hidden>
      <div class="field"><label for="pw1">Nueva contraseña</label><input class="input" id="pw1" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="field"><label for="pw2">Repítela</label><input class="input" id="pw2" type="password" minlength="6" autocomplete="new-password" required></div>
      <p class="err" id="pw-err"></p><button class="btn" type="submit">Cambiar contraseña</button></form>`);
  $('#pw-form', sh).onsubmit = async e => {
    e.preventDefault();
    if ($('#pw1', sh).value !== $('#pw2', sh).value) return $('#pw-err', sh).textContent = 'Las contraseñas no coinciden.';
    const { error } = await sb.auth.updateUser({ password: $('#pw1', sh).value });
    if (error) return $('#pw-err', sh).textContent = errMsg(error);
    closeSheet(); toast('Contraseña cambiada');
  };
}

/* ════════════════════════════════════════════════
   CHAT
   ════════════════════════════════════════════════ */
async function loadMsgs() {
  const { data, error } = await sb.from('messages').select('*').order('id', { ascending: false }).limit(MSG_PAGE);
  if (error) return;
  S.msgs = data.reverse(); S.hasOlder = data.length === MSG_PAGE;
}
async function catchUpMsgs() {
  const last = S.msgs.at(-1)?.id || 0;
  const { data } = await sb.from('messages').select('*').gt('id', last).order('id').limit(200);
  if (data?.length) addMsgs(data);
}
const seenId = () => Number(store.get('seen') || 0);
function updateBadge() {
  const b = $('#chat-badge'); if (!b) return;
  const n = S.msgs.filter(x => x.id > seenId() && x.member_id !== S.me?.id).length;
  b.hidden = !n || current().name === 'chat'; b.textContent = n > 99 ? '99+' : n;
}
const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 80;
const toBottom = (smooth) => scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
function markSeen() { const last = S.msgs.at(-1); if (last) store.set('seen', last.id); updateBadge(); }

function addMsgs(list) {
  const known = new Set(S.msgs.map(m => m.id));
  const fresh = list.filter(m => !known.has(m.id));
  if (!fresh.length) return;
  S.msgs.push(...fresh); S.msgs.sort((a, b) => a.id - b.id);
  if (current().name !== 'chat') { updateBadge(); return; }
  const stick = atBottom() || fresh.some(m => m.member_id === S.me.id);
  drawMsgs();
  if (stick) { toBottom(true); markSeen(); } else showNewPill();
}
function removeMsg(id) {
  if (!id) return;
  const n = S.msgs.length;
  S.msgs = S.msgs.filter(m => m.id !== id);
  if (n !== S.msgs.length && current().name === 'chat') drawMsgs();
  updateBadge();
}
function showNewPill() {
  if ($('.new-pill')) return;
  const p = document.createElement('button');
  p.className = 'new-pill'; p.textContent = 'Mensajes nuevos ↓';
  p.onclick = () => { toBottom(true); p.remove(); markSeen(); };
  $('.shell').appendChild(p);
}

function viewChat(view) {
  header('Vestuario', { eyebrow: `Chat · ${S.members.filter(m => m.user_id && m.active).length} con cuenta` });
  view.innerHTML = `<div class="chat">
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <form class="composer" id="composer">
        <button type="button" class="icon-btn" id="c-img" aria-label="Enviar foto">${icon('image')}</button>
        <button type="button" class="icon-btn" id="c-gif" aria-label="Enviar GIF"><span class="gif-lbl">GIF</span></button>
        <textarea id="c-txt" rows="1" placeholder="Escribe al vestuario…" maxlength="2000" aria-label="Mensaje"></textarea>
        <button type="submit" class="icon-btn send" id="c-send" aria-label="Enviar" disabled>${icon('send')}</button>
        <input type="file" id="c-file" accept="image/*" hidden>
      </form></div>`;
  drawMsgs();
  requestAnimationFrame(() => { toBottom(false); markSeen(); });

  const ta = $('#c-txt'), send = $('#c-send');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 130) + 'px'; send.disabled = !ta.value.trim(); };
  ta.oninput = fit;
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover:hover)').matches) { e.preventDefault(); $('#composer').requestSubmit(); } };
  const draftKey = 'draft';
  ta.value = store.get(draftKey) || ''; fit();
  ta.addEventListener('input', () => store.set(draftKey, ta.value));
  $('#composer').onsubmit = async e => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return;
    ta.value = ''; store.set(draftKey, ''); fit();
    const ok = await postMsg({ body });
    if (!ok) { ta.value = body; fit(); }
  };
  $('#c-img').onclick = () => $('#c-file').click();
  $('#c-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) sendImage(f); };
  $('#c-gif').onclick = gifSheet;
  addEventListener('scroll', chatScroll, { passive: true });
}
function chatScroll() {
  if (current().name !== 'chat') { removeEventListener('scroll', chatScroll); return; }
  if (atBottom()) { $('.new-pill')?.remove(); markSeen(); }
}

function drawMsgs() {
  const box = $('#msgs'); if (!box) return;
  if (!S.msgs.length) {
    box.innerHTML = `<div class="empty" style="margin:24px 4px"><div class="num" style="color:var(--accent)">¡Hola!</div><p>Aquí solo escribe el equipo. Estrena el chat.</p></div>`;
    return;
  }
  let html = S.hasOlder ? '<button class="btn ghost sm older" id="older" style="width:auto">Ver mensajes anteriores</button>' : '';
  let lastDay = '';
  S.msgs.forEach((m, i) => {
    const day = new Date(m.created_at).toLocaleDateString('sv-SE');
    if (day !== lastDay) { html += `<div class="day">${dayLabel(day)}</div>`; lastDay = day; }
    const prev = S.msgs[i - 1], next = S.msgs[i + 1];
    const sameDay = x => x && new Date(x.created_at).toLocaleDateString('sv-SE') === day;
    const first = !prev || prev.member_id !== m.member_id || !sameDay(prev) || Date.parse(m.created_at) - Date.parse(prev.created_at) > 6e5;
    const last = !next || next.member_id !== m.member_id || !sameDay(next) || Date.parse(next.created_at) - Date.parse(m.created_at) > 6e5;
    const mine = m.member_id === S.me.id, who = memberById(m.member_id);
    const media = m.media_url ? `<img src="${esc(m.media_url)}" alt="${m.media_kind === 'gif' ? 'GIF' : 'Foto'}" loading="lazy" ${m.media_w ? `width="${m.media_w}" height="${m.media_h}"` : ''} data-zoom>` : '';
    html += `<div class="msg ${mine ? 'me' : ''} ${first ? 'first' : ''} ${last ? 'last' : ''}" data-id="${m.id}">
      ${avatar(who)}<div class="bubble ${m.media_url ? 'media' : ''} ${m.media_url && m.body ? 'has-txt' : ''}">
        ${first && !mine && !m.media_url ? `<span class="who">${esc(who?.name || '¿?')}</span>` : ''}
        ${media}${m.body ? `<span class="txt">${first && !mine && m.media_url ? `<b>${esc(firstName(who))}:</b> ` : ''}${linkify(esc(m.body))}</span>` : ''}
        <span class="time">${fmtTime(m.created_at)}</span></div></div>`;
  });
  box.innerHTML = html;
  $('#older', box)?.addEventListener('click', loadOlder);
  $$('[data-zoom]', box).forEach(img => img.onclick = () => lightbox(img.src));
  $$('.msg', box).forEach(el => longPress(el, () => msgActions(Number(el.dataset.id))));
}
function dayLabel(day) {
  const t = todayISO(), diff = dayNum(t) - dayNum(day);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return new Date(day + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}
const linkify = s => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>');

async function loadOlder() {
  const first = S.msgs[0]; if (!first) return;
  const { data, error } = await sb.from('messages').select('*').lt('id', first.id).order('id', { ascending: false }).limit(MSG_PAGE);
  if (error) return toast(errMsg(error));
  const h0 = document.documentElement.scrollHeight, y0 = scrollY;
  S.msgs = [...data.reverse(), ...S.msgs]; S.hasOlder = data.length === MSG_PAGE;
  drawMsgs();
  scrollTo(0, y0 + document.documentElement.scrollHeight - h0);
}

async function postMsg(row) {
  const { data, error } = await sb.from('messages').insert({ team_id: S.me.team_id, member_id: S.me.id, ...row }).select().single();
  if (error) { toast(errMsg(error)); return false; }
  addMsgs([data]);
  return true;
}
async function sendImage(file) {
  const box = $('#msgs');
  const tmp = document.createElement('div');
  tmp.className = 'uploading'; tmp.textContent = file.type === 'image/gif' ? 'Subiendo GIF…' : 'Subiendo foto…';
  box?.appendChild(tmp); toBottom(true);
  try {
    const up = await uploadImage(file, 'chat', { maxSide: 1600 });
    await postMsg({ media_url: up.url, media_kind: up.kind, media_w: up.w, media_h: up.h });
  } catch (e) { toast(errMsg(e)); }
  tmp.remove();
}
function msgActions(id) {
  const m = S.msgs.find(x => x.id === id); if (!m) return;
  const mine = m.member_id === S.me.id;
  const acts = [];
  if (m.body) acts.push(`<button class="action" data-a="copy">${icon('check')}<span>Copiar texto</span></button>`);
  if (mine || S.me.is_admin) acts.push(`<button class="action danger" data-a="del">${icon('trash')}<span>Borrar mensaje</span></button>`);
  if (!acts.length) return;
  const sh = openSheet(`<h3>Mensaje</h3><p class="sub">${esc(memberById(m.member_id)?.name)} · ${fmtTime(m.created_at)}</p><div class="actions">${acts.join('')}</div>`);
  $('[data-a=copy]', sh)?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(m.body); toast('Copiado'); } catch { toast('No se pudo copiar'); }
    closeSheet();
  });
  $('[data-a=del]', sh)?.addEventListener('click', async () => {
    const { error } = await sb.from('messages').delete().eq('id', id);
    if (error) return toast(errMsg(error));
    closeSheet(); removeMsg(id);
  });
}
function longPress(el, fn) {
  let t;
  const start = () => { t = setTimeout(() => { t = null; navigator.vibrate?.(12); fn(); }, 480); };
  const cancel = () => { clearTimeout(t); };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel, { passive: true });
  el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); fn(); });
}
function lightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${esc(src)}" alt=""><button class="icon-btn" aria-label="Cerrar">${icon('close')}</button>`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

function gifSheet() {
  if (!GIPHY_KEY) {
    const sh = openSheet(`<h3>GIF</h3><p class="sub">Elige un GIF guardado en tu móvil. Para buscar GIFs desde aquí hace falta conectar GIPHY.</p>
      <button class="btn" id="gif-file">${icon('image')}Elegir GIF del móvil</button><input type="file" id="gif-in" accept="image/gif" hidden>`);
    $('#gif-file', sh).onclick = () => $('#gif-in', sh).click();
    $('#gif-in', sh).onchange = e => { const f = e.target.files[0]; if (f) { closeSheet(); sendImage(f); } };
    return;
  }
  const sh = openSheet(`<h3>GIF</h3><input class="input" id="gif-q" placeholder="Buscar en GIPHY" autocomplete="off" enterkeyhint="search">
    <div class="gif-grid" id="gif-grid"></div><p class="tiny" style="text-align:center;margin-top:8px">Powered by GIPHY</p>`);
  const grid = $('#gif-grid', sh);
  let t, seq = 0;
  const search = async q => {
    const my = ++seq;
    const url = `https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?api_key=${GIPHY_KEY}&limit=24&rating=pg-13&lang=es${q ? '&q=' + encodeURIComponent(q) : ''}`;
    try {
      const { data } = await (await fetch(url)).json();
      if (my !== seq) return;
      grid.innerHTML = data.map(g => { const p = g.images.fixed_width, s = g.images.downsized_medium || g.images.original;
        return `<button type="button" data-u="${esc(s.url)}" data-w="${s.width}" data-h="${s.height}"><img src="${esc(p.webp || p.url)}" width="${p.width}" height="${p.height}" alt="${esc(g.title)}" loading="lazy"></button>`; }).join('');
      $$('button', grid).forEach(b => b.onclick = async () => {
        closeSheet();
        await postMsg({ media_url: b.dataset.u, media_kind: 'gif', media_w: +b.dataset.w, media_h: +b.dataset.h });
      });
    } catch { grid.innerHTML = '<p class="err">No se pudo conectar con GIPHY.</p>'; }
  };
  $('#gif-q', sh).oninput = e => { clearTimeout(t); t = setTimeout(() => search(e.target.value.trim()), 350); };
  search('');
}

/* ── Subida de imágenes (compresión en el móvil) ── */
async function uploadImage(file, folder, { maxSide = 1600, square = false } = {}) {
  const isGif = file.type === 'image/gif';
  let blob = file, w, h;
  if (isGif) {
    if (file.size > 8e6) throw new Error('Ese GIF pesa más de 8 MB.');
    const bmp = await createImageBitmap(file).catch(() => null);
    w = bmp?.width; h = bmp?.height; bmp?.close?.();
  } else {
    ({ blob, w, h } = await compress(file, maxSide, square));
  }
  const path = `${S.me.team_id}/${folder}/${crypto.randomUUID()}.${isGif ? 'gif' : 'jpg'}`;
  const { error } = await sb.storage.from('media').upload(path, blob, { contentType: isGif ? 'image/gif' : 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return { url: sb.storage.from('media').getPublicUrl(path).data.publicUrl, w, h, kind: isGif ? 'gif' : 'image' };
}
async function compress(file, maxSide, square) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('No se pudo leer la imagen. Prueba con otra.')); img.src = URL.createObjectURL(file); });
  }
  const sw = src.width, sh = src.height;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; cw = ch = s; }
  const k = Math.min(1, maxSide / Math.max(cw, ch));
  const w = Math.round(cw * k), h = Math.round(ch * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
  src.close?.();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.84));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return { blob, w, h };
}

boot().catch(e => {
  console.error(e);
  $('#app').innerHTML = `<div class="auth-body"><p class="err" style="margin-top:40px">No se pudo arrancar la app: ${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">Recargar</button></div>`;
});
})();
