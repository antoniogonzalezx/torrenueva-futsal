-- ════════════════════════════════════════════════════════════════
--  Torrenueva FS · Temporada 2026/27
--  Esquema nuevo (dos equipos, login por jugador, chat, perfiles).
--  Las tablas de la temporada 25/26 (players, multas, lives_log,
--  matches, match_players, mvp_votes, premios) NO se tocan.
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Tablas ──────────────────────────────────────────────────────

create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  season         text not null default '2026/27',
  join_code_hash text not null,
  created_at     timestamptz not null default now()
);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid unique references auth.users(id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 40),
  nickname     text check (length(nickname) <= 40),
  emoji        text not null default '⚽' check (length(emoji) <= 16),
  photo_url    text,
  position     text check (position in ('Portero','Cierre','Ala','Pívot','Universal','Entrenador','Staff')),
  dorsal       int  check (dorsal between 0 and 99),
  bio          text check (length(bio) <= 280),
  matches      int not null default 0 check (matches >= 0),
  goals        int not null default 0 check (goals >= 0),
  assists      int not null default 0 check (assists >= 0),
  mvps         int not null default 0 check (mvps >= 0),
  yellow_cards int not null default 0 check (yellow_cards >= 0),
  red_cards    int not null default 0 check (red_cards >= 0),
  credit       numeric(8,2) not null default 0 check (credit >= 0),
  is_admin     boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, name)
);
create index members_team_idx on public.members(team_id);

create table public.fines (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  amount      numeric(8,2) not null check (amount > 0),
  reason      text check (length(reason) <= 140),
  date        date not null default current_date,
  kind        text not null default 'multa' check (kind in ('multa','cobro')),
  credit_used numeric(8,2) not null default 0,   -- saldo aplicado antes de pagar
  paid        boolean not null default false,
  paid_at     timestamptz,
  paid_mult   int,
  paid_total  numeric(8,2),
  created_by  uuid references public.members(id) on delete set null,
  paid_by     uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index fines_team_idx on public.fines(team_id, paid, date desc);

create table public.credit_log (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  delta      numeric(8,2) not null,
  reason     text,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_log_team_idx on public.credit_log(team_id, created_at desc);

create table public.messages (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  body       text check (length(body) <= 2000),
  media_url  text,
  media_kind text check (media_kind in ('image','gif')),
  media_w    int,
  media_h    int,
  created_at timestamptz not null default now(),
  check (coalesce(length(trim(body)),0) > 0 or media_url is not null)
);
create index messages_team_idx on public.messages(team_id, id desc);

-- ── Helpers de sesión ───────────────────────────────────────────

create or replace function public.my_member()
returns public.members language sql stable security definer set search_path = '' as $$
  select m.* from public.members m where m.user_id = auth.uid() and m.active limit 1
$$;

create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.team_id from public.members m where m.user_id = auth.uid() and m.active limit 1
$$;

create or replace function public.my_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.members m where m.user_id = auth.uid() and m.active limit 1
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────

alter table public.teams      enable row level security;
alter table public.members    enable row level security;
alter table public.fines      enable row level security;
alter table public.credit_log enable row level security;
alter table public.messages   enable row level security;

revoke all on public.teams, public.members, public.fines, public.credit_log, public.messages from anon, authenticated;

grant select on public.teams, public.members, public.fines, public.credit_log, public.messages to authenticated;
-- Perfil: cualquier jugador registrado puede editar datos y estadísticas, pero no cuenta/saldo/admin.
grant update (name, nickname, emoji, photo_url, position, dorsal, bio,
              matches, goals, assists, mvps, yellow_cards, red_cards) on public.members to authenticated;
grant insert (team_id, name, nickname, emoji, position, dorsal) on public.members to authenticated;
grant insert (team_id, member_id, body, media_url, media_kind, media_w, media_h) on public.messages to authenticated;
grant delete on public.messages to authenticated;

create policy teams_read   on public.teams      for select to authenticated using (id = public.my_team_id());
create policy members_read on public.members    for select to authenticated using (team_id = public.my_team_id());
create policy members_add  on public.members    for insert to authenticated with check (team_id = public.my_team_id());
create policy members_edit on public.members    for update to authenticated
  using (team_id = public.my_team_id()) with check (team_id = public.my_team_id());
create policy fines_read   on public.fines      for select to authenticated using (team_id = public.my_team_id());
create policy credit_read  on public.credit_log for select to authenticated using (team_id = public.my_team_id());
create policy msg_read     on public.messages   for select to authenticated using (team_id = public.my_team_id());
create policy msg_send     on public.messages   for insert to authenticated
  with check (team_id = public.my_team_id() and member_id = public.my_member_id());
create policy msg_delete   on public.messages   for delete to authenticated
  using (team_id = public.my_team_id()
         and (member_id = public.my_member_id() or coalesce((public.my_member()).is_admin, false)));

-- ── Registro y acceso ───────────────────────────────────────────

-- Plantilla pública mínima para la pantalla de login/registro.
create or replace function public.team_roster(p_slug text)
returns table (id uuid, name text, emoji text, photo_url text, dorsal int, "position" text, claimed boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.name, m.emoji, m.photo_url, m.dorsal, m.position, m.user_id is not null
  from public.members m join public.teams t on t.id = m.team_id
  where t.slug = p_slug and m.active
  order by m.name
$$;

-- Comprobación previa (para mensajes de error claros). La validación real está en el trigger.
create or replace function public.check_join(p_member uuid, p_code text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  select m.user_id, m.active, t.join_code_hash into r
  from public.members m join public.teams t on t.id = m.team_id where m.id = p_member;
  if not found or not r.active then return 'not_found'; end if;
  if r.join_code_hash <> extensions.crypt(upper(trim(coalesce(p_code,''))), r.join_code_hash) then return 'bad_code'; end if;
  if r.user_id is not null then return 'taken'; end if;
  return 'ok';
end $$;

-- Cada alta en auth.users debe reclamar un jugador libre con el código del equipo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := nullif(new.raw_user_meta_data->>'member_id','')::uuid;
  v_code   text := upper(trim(coalesce(new.raw_user_meta_data->>'join_code','')));
  r record;
begin
  if v_member is null then raise exception 'SIGNUP_NOT_ALLOWED'; end if;
  select m.user_id, m.active, t.join_code_hash into r
  from public.members m join public.teams t on t.id = m.team_id where m.id = v_member for update of m;
  if not found or not r.active then raise exception 'PLAYER_NOT_FOUND'; end if;
  if r.join_code_hash <> extensions.crypt(v_code, r.join_code_hash) then raise exception 'BAD_CODE'; end if;
  if r.user_id is not null then raise exception 'PLAYER_TAKEN'; end if;
  update public.members set user_id = new.id where id = v_member;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Multas (lógica en servidor para que el saldo sea consistente) ──

create or replace function public.fine_mult(f public.fines)
returns int language sql stable set search_path = '' as $$
  select case when f.kind <> 'multa' then 1
              when current_date - f.date >= 29 then 4
              when current_date - f.date >= 15 then 2
              else 1 end
$$;

create or replace function public.fine_due(f public.fines)
returns numeric language sql stable set search_path = '' as $$
  select greatest(0, f.amount - f.credit_used) * public.fine_mult(f)
$$;

create or replace function public.add_fine(p_member uuid, p_amount numeric, p_reason text, p_date date, p_kind text)
returns public.fines language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); m public.members; f public.fines; use_c numeric;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into m from public.members where id = p_member and team_id = me.team_id and active for update;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;

  insert into public.fines(team_id, member_id, amount, reason, date, kind, created_by)
  values (me.team_id, m.id, round(p_amount,2), nullif(trim(p_reason),''), coalesce(p_date, current_date),
          case when p_kind = 'cobro' then 'cobro' else 'multa' end, me.id)
  returning * into f;

  -- Si tiene saldo a favor, se aplica automáticamente.
  if m.credit > 0 then
    use_c := least(m.credit, f.amount);
    update public.members set credit = credit - use_c where id = m.id;
    if use_c >= f.amount then
      update public.fines set credit_used = use_c, paid = true, paid_at = now(), paid_mult = 1,
             paid_total = use_c, paid_by = me.id where id = f.id returning * into f;
    else
      update public.fines set credit_used = use_c where id = f.id returning * into f;
    end if;
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (me.team_id, m.id, -use_c, 'Saldo aplicado a «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;
  return f;
end $$;

create or replace function public.pay_fine(p_fine uuid, p_cash numeric)
returns public.fines language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); f public.fines; m public.members;
        due numeric; use_c numeric; cash numeric := greatest(0, coalesce(p_cash,0)); extra numeric;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into f from public.fines where id = p_fine and team_id = me.team_id for update;
  if not found then raise exception 'FINE_NOT_FOUND'; end if;
  if f.paid then raise exception 'ALREADY_PAID'; end if;
  select * into m from public.members where id = f.member_id for update;

  due   := public.fine_due(f);
  use_c := least(m.credit, due);
  extra := greatest(0, cash + use_c - due);

  update public.members set credit = credit - use_c + extra where id = m.id;
  if use_c > 0 then
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (f.team_id, m.id, -use_c, 'Saldo aplicado a «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;
  if extra > 0 then
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (f.team_id, m.id, extra, 'Pagó de más en «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;

  update public.fines set paid = true, paid_at = now(), paid_mult = public.fine_mult(f),
         paid_total = f.credit_used + use_c + cash, paid_by = me.id
  where id = f.id returning * into f;
  return f;
end $$;

create or replace function public.delete_fine(p_fine uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); f public.fines;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into f from public.fines where id = p_fine and team_id = me.team_id for update;
  if not found then raise exception 'FINE_NOT_FOUND'; end if;
  if f.paid then raise exception 'ALREADY_PAID'; end if;
  -- Devuelve el saldo que se hubiera aplicado.
  if f.credit_used > 0 then
    update public.members set credit = credit + f.credit_used where id = f.member_id;
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (f.team_id, f.member_id, f.credit_used, 'Devuelto al borrar «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;
  delete from public.fines where id = f.id;
end $$;

-- ── Administración (solo is_admin) ──────────────────────────────

create or replace function public.admin_release_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); uid uuid;
begin
  if not coalesce(me.is_admin,false) then raise exception 'NOT_ALLOWED'; end if;
  select user_id into uid from public.members where id = p_member and team_id = me.team_id;
  if uid is null then return; end if;
  if uid = auth.uid() then raise exception 'CANNOT_RELEASE_SELF'; end if;
  delete from auth.users where id = uid;   -- members.user_id queda a null (on delete set null)
end $$;

create or replace function public.admin_set_active(p_member uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member();
begin
  if not coalesce(me.is_admin,false) then raise exception 'NOT_ALLOWED'; end if;
  update public.members set active = p_active where id = p_member and team_id = me.team_id and id <> me.id;
end $$;

create or replace function public.admin_set_admin(p_member uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member();
begin
  if not coalesce(me.is_admin,false) then raise exception 'NOT_ALLOWED'; end if;
  update public.members set is_admin = p_admin where id = p_member and team_id = me.team_id and id <> me.id;
end $$;

-- ── Permisos de funciones ───────────────────────────────────────

revoke execute on function
  public.my_member(), public.my_team_id(), public.my_member_id(), public.touch_updated_at(),
  public.team_roster(text), public.check_join(uuid, text), public.handle_new_user(),
  public.fine_mult(public.fines), public.fine_due(public.fines),
  public.add_fine(uuid, numeric, text, date, text), public.pay_fine(uuid, numeric), public.delete_fine(uuid),
  public.admin_release_member(uuid), public.admin_set_active(uuid, boolean), public.admin_set_admin(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.team_roster(text)        to anon, authenticated;
grant execute on function public.check_join(uuid, text)   to anon, authenticated;
grant execute on function public.my_member(), public.my_team_id(), public.my_member_id() to authenticated;
grant execute on function public.fine_mult(public.fines), public.fine_due(public.fines) to authenticated;
grant execute on function public.add_fine(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.pay_fine(uuid, numeric)  to authenticated;
grant execute on function public.delete_fine(uuid)        to authenticated;
grant execute on function public.admin_release_member(uuid)          to authenticated;
grant execute on function public.admin_set_active(uuid, boolean)     to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean)      to authenticated;

-- ── Realtime (chat y refresco en vivo) ──────────────────────────

alter publication supabase_realtime add table public.messages, public.fines, public.members;

-- ── Storage: fotos de jugadores y del chat ──────────────────────
-- Bucket público de lectura (rutas con UUID imposibles de adivinar);
-- solo los jugadores registrados pueden subir, y solo a la carpeta de su equipo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_team_id()::text);
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());
