-- ════════════════════════════════════════════════════════════════
--  Liga (calendario y resultados de la federación) y quiniela.
--  · Cada equipo puede tener una competición (de momento, el senior).
--  · Los partidos los carga scripts/calendario_pdf.py y los actualiza
--    la edge function «ffcm-sync» leyendo ffcm.es.
--  · Quiniela: todos los partidos de la jornada salvo el nuestro.
--    1 signo acertado = 3 puntos; doble acertado = 1 punto; máximo 4 dobles.
--    Se rellena entera antes del viernes a las 14:00 (hora de Madrid).
--    Partido aplazado o suspendido = anulado (0 puntos para todos).
-- ════════════════════════════════════════════════════════════════

-- ── Tablas ──────────────────────────────────────────────────────

create table public.competitions (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null unique references public.teams(id) on delete cascade,
  name             text not null,
  club_name        text not null,                    -- nuestro equipo, tal como lo escribe la federación
  short_names      jsonb not null default '{}',      -- nombre oficial → nombre corto para la app
  ffcm_temporada   int,
  ffcm_competicion int,
  ffcm_grupo       int,
  synced_at        timestamptz,
  created_at       timestamptz not null default now()
);

create table public.rounds (
  id             bigint generated always as identity primary key,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  num            int not null check (num > 0),
  match_date     date not null,          -- día de la jornada (sábado)
  deadline       timestamptz not null,   -- viernes anterior a las 14:00 de Madrid (lo pone un trigger)
  closed         boolean not null default false,   -- resultados cerrados: lo que no se jugó queda anulado
  notified_at    timestamptz,            -- push de resultados enviada
  unique (competition_id, num)
);

create table public.fixtures (
  id         bigint generated always as identity primary key,
  round_id   bigint not null references public.rounds(id) on delete cascade,
  home       text not null,
  away       text not null,
  kickoff    timestamptz,                -- fecha y hora, si la federación la publica
  home_goals int check (home_goals between 0 and 99),
  away_goals int check (away_goals between 0 and 99),
  status     text not null default 'scheduled' check (status in ('scheduled','played','postponed')),
  void       boolean not null default false,   -- anulado en la quiniela
  ours       boolean not null default false,   -- juega nuestro equipo: no entra en la quiniela (lo pone un trigger)
  manual     boolean not null default false,   -- corregido por un admin: la sincronización no lo toca
  updated_at timestamptz not null default now(),
  unique (round_id, home, away),
  check ((home_goals is null) = (away_goals is null))
);
create index fixtures_round_idx on public.fixtures(round_id);

create table public.picks (
  fixture_id bigint not null references public.fixtures(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  round_id   bigint not null references public.rounds(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  signs      text not null check (signs in ('1','X','2','1X','X2','12')),
  updated_at timestamptz not null default now(),
  primary key (fixture_id, member_id)
);
create index picks_round_idx on public.picks(round_id, member_id);

-- ── Triggers ────────────────────────────────────────────────────

-- Cierre: el viernes anterior (o el mismo día, si la jornada cae en viernes) a las 14:00 de Madrid.
create or replace function public.round_deadline()
returns trigger language plpgsql set search_path = '' as $$
declare fri date := new.match_date - ((extract(isodow from new.match_date)::int + 2) % 7);
begin
  new.deadline := (fri + time '14:00') at time zone 'Europe/Madrid';
  return new;
end $$;
create trigger rounds_deadline before insert or update of match_date on public.rounds
  for each row execute function public.round_deadline();

create or replace function public.fixture_defaults()
returns trigger language plpgsql set search_path = '' as $$
declare club text;
begin
  select c.club_name into club from public.rounds r join public.competitions c on c.id = r.competition_id where r.id = new.round_id;
  new.ours := club in (new.home, new.away);
  -- Aplazado o suspendido: anulado en la quiniela (aunque luego se juegue).
  if new.status = 'postponed' then new.void := true; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger fixtures_defaults before insert or update on public.fixtures
  for each row execute function public.fixture_defaults();

-- ── Puntos ──────────────────────────────────────────────────────

create or replace function public.fixture_sign(f public.fixtures)
returns text language sql immutable set search_path = '' as $$
  select case when f.void or f.home_goals is null then null
              when f.home_goals > f.away_goals then '1'
              when f.home_goals = f.away_goals then 'X'
              else '2' end
$$;

-- Con security_invoker la vista respeta el RLS de picks: los pronósticos ajenos no se ven antes del cierre.
create view public.pick_points with (security_invoker = true) as
  select p.fixture_id, p.member_id, p.round_id, p.team_id, p.signs, s.sign,
         case when s.sign is null then null
              when strpos(p.signs, s.sign) > 0 then case when length(p.signs) = 1 then 3 else 1 end
              else 0 end as points
  from public.picks p
  join public.fixtures f on f.id = p.fixture_id
  cross join lateral (select public.fixture_sign(f) as sign) s;

-- ── RLS ─────────────────────────────────────────────────────────

alter table public.competitions enable row level security;
alter table public.rounds       enable row level security;
alter table public.fixtures     enable row level security;
alter table public.picks        enable row level security;
revoke all on public.competitions, public.rounds, public.fixtures, public.picks, public.pick_points from anon, authenticated;
grant select on public.competitions, public.rounds, public.fixtures, public.picks, public.pick_points to authenticated;

create policy comp_read on public.competitions for select to authenticated using (team_id = public.my_team_id());
create policy rounds_read on public.rounds for select to authenticated
  using (exists (select 1 from public.competitions c where c.id = competition_id and c.team_id = public.my_team_id()));
create policy fixtures_read on public.fixtures for select to authenticated
  using (exists (select 1 from public.rounds r join public.competitions c on c.id = r.competition_id
                 where r.id = round_id and c.team_id = public.my_team_id()));
-- Los tuyos siempre; los de los demás, cuando la jornada ya ha cerrado.
create policy picks_read on public.picks for select to authenticated
  using (team_id = public.my_team_id()
         and (member_id = public.my_member_id()
              or exists (select 1 from public.rounds r where r.id = round_id and r.deadline <= now())));

-- ── Funciones de la app ─────────────────────────────────────────

-- Guarda la quiniela entera de una jornada: { "<fixture_id>": "1" | "X" | "2" | "1X" | "X2" | "12", … }.
create or replace function public.save_picks(p_round bigint, p_picks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); r public.rounds; need bigint[]; got bigint[]; bad int; dbl int;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select r0.* into r from public.rounds r0 join public.competitions c on c.id = r0.competition_id
  where r0.id = p_round and c.team_id = me.team_id;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if now() >= r.deadline then raise exception 'QUINIELA_CLOSED'; end if;
  if jsonb_typeof(p_picks) is distinct from 'object' then raise exception 'QUINIELA_INCOMPLETE'; end if;

  select coalesce(array_agg(id order by id), '{}') into need
  from public.fixtures where round_id = r.id and not ours and not void;
  select coalesce(array_agg(k order by k), '{}') into got
  from (select case when k ~ '^\d{1,18}$' then k::bigint end as k from jsonb_object_keys(p_picks) k) x;
  if got is distinct from need then raise exception 'QUINIELA_INCOMPLETE'; end if;

  select count(*) filter (where jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('1','X','2','1X','X2','12')),
         count(*) filter (where length(v #>> '{}') = 2)
  into bad, dbl from jsonb_each(p_picks) e(k, v);
  if bad > 0 then raise exception 'BAD_PICK'; end if;
  if dbl > 4 then raise exception 'TOO_MANY_DOUBLES'; end if;

  delete from public.picks where round_id = r.id and member_id = me.id;
  insert into public.picks(fixture_id, member_id, round_id, team_id, signs)
  select k::bigint, me.id, r.id, me.team_id, v #>> '{}' from jsonb_each(p_picks) e(k, v);
end $$;

-- Quién ha entregado ya la quiniela de una jornada (sin enseñar los pronósticos).
create or replace function public.quiniela_entries(p_round bigint)
returns table (member_id uuid, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.member_id, max(p.updated_at) from public.picks p
  where p.round_id = p_round and p.team_id = public.my_team_id()
  group by p.member_id
$$;

-- Clasificación de la quiniela (solo jornadas ya cerradas a pronósticos).
-- Desempate: más aciertos de 3 puntos; después, menos dobles usados.
create or replace function public.quiniela_ranking()
returns table (member_id uuid, points bigint, hits3 bigint, hits1 bigint, doubles bigint, rounds bigint)
language sql stable security definer set search_path = '' as $$
  select pp.member_id,
         coalesce(sum(pp.points), 0),
         count(*) filter (where pp.points = 3),
         count(*) filter (where pp.points = 1),
         count(*) filter (where length(pp.signs) = 2),
         count(distinct pp.round_id)
  from public.pick_points pp join public.rounds r on r.id = pp.round_id
  where pp.team_id = public.my_team_id() and r.deadline <= now()
  group by pp.member_id
$$;

-- Admin: corregir un resultado, anular un partido o devolverlo a la sincronización automática.
create or replace function public.admin_set_fixture(p_fixture bigint, p_home int, p_away int, p_void boolean, p_manual boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member();
begin
  if not coalesce(me.is_admin, false) then raise exception 'NOT_ALLOWED'; end if;
  if (p_home is null) <> (p_away is null) then raise exception 'BAD_SCORE'; end if;
  update public.fixtures f set
    home_goals = p_home, away_goals = p_away, void = coalesce(p_void, false), manual = coalesce(p_manual, true),
    status = case when p_home is not null then 'played' when f.status = 'played' then 'scheduled' else f.status end
  from public.rounds r join public.competitions c on c.id = r.competition_id
  where f.id = p_fixture and r.id = f.round_id and c.team_id = me.team_id;
  if not found then raise exception 'FIXTURE_NOT_FOUND'; end if;
end $$;

-- ── Cierre de jornadas (pg_cron) ────────────────────────────────
-- Tres días después de la jornada, los partidos de la quiniela que sigan sin resultado quedan anulados.
create or replace function public.close_rounds()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with done as (
    update public.rounds set closed = true
    where not closed and match_date <= (now() at time zone 'Europe/Madrid')::date - 3
    returning id)
  update public.fixtures f set void = true
  from done where f.round_id = done.id and f.home_goals is null and not f.ours and not f.void;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Permisos ────────────────────────────────────────────────────
revoke execute on function
  public.round_deadline(), public.fixture_defaults(), public.fixture_sign(public.fixtures),
  public.save_picks(bigint, jsonb), public.quiniela_entries(bigint), public.quiniela_ranking(),
  public.admin_set_fixture(bigint, int, int, boolean, boolean), public.close_rounds()
from public, anon, authenticated;
grant execute on function public.fixture_sign(public.fixtures)   to authenticated;
grant execute on function public.save_picks(bigint, jsonb)      to authenticated;
grant execute on function public.quiniela_entries(bigint)       to authenticated;
grant execute on function public.quiniela_ranking()             to authenticated;
grant execute on function public.admin_set_fixture(bigint, int, int, boolean, boolean) to authenticated;

-- ── Tareas programadas ──────────────────────────────────────────
-- Todas pasan por edge functions con el secreto del webhook (como el recordatorio de multas).
create or replace function public.call_edge(p_fn text, p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  select value into secret from public.app_secrets where key = 'webhook_secret';
  if secret is null then return; end if;
  perform net.http_post(
    url     := 'https://cmfhosxslodnrxlpifrn.supabase.co/functions/v1/' || p_fn,
    body    := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', secret),
    timeout_milliseconds := 60000);
end $$;
revoke execute on function public.call_edge(text, jsonb) from public, anon, authenticated;

-- Horas en UTC. Madrid es UTC+2 en verano y UTC+1 en invierno.
-- Resultados y horarios: cada noche a las 21:30 UTC (23:30 / 22:30 en Madrid). La del domingo manda los puntos.
select cron.schedule('ffcm-sync', '30 21 * * *', $$select public.call_edge('ffcm-sync', '{}'::jsonb)$$);
-- Cierre de jornadas: cada mañana.
select cron.schedule('quiniela-close', '0 7 * * *', 'select public.close_rounds()');
-- Recordatorio a quien no la ha rellenado: jueves por la tarde y viernes por la mañana.
select cron.schedule('quiniela-reminder-thu', '0 17 * * 4', $$select public.call_edge('notify', '{"type":"quiniela_reminder"}'::jsonb)$$);
select cron.schedule('quiniela-reminder-fri', '0 8 * * 5',  $$select public.call_edge('notify', '{"type":"quiniela_reminder"}'::jsonb)$$);
