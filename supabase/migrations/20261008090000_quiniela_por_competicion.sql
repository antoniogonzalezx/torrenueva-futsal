-- ════════════════════════════════════════════════════════════════
--  Quiniela con calendario propio por equipo.
--  · Una jornada puede leer sus resultados de otra liga (rounds.ffcm_*): así la jornada 0 del
--    juvenil, que usa partidos del senior, sigue cogiendo resultados cuando su competición
--    pasa a apuntar a la liga juvenil.
--  · El máximo de dobles es de cada competición (el juvenil tiene 4 partidos por jornada) y una
--    jornada puede fijar el suyo (la jornada 0 del juvenil mantiene los 4 con los que empezó).
--  · «ours» se decide al crear el partido: una actualización de resultado no lo cambia
--    (si no, al renombrar el club se movería un partido que ya tiene pronósticos).
-- ════════════════════════════════════════════════════════════════

alter table public.rounds
  add column ffcm_competicion int,     -- si están puestos, los resultados de esta jornada salen de esta liga…
  add column ffcm_grupo       int,
  add column ffcm_jornada     int,     -- …y de esta jornada suya
  add column max_doubles      int check (max_doubles between 0 and 10);   -- si está puesto, manda sobre el de la competición

alter table public.competitions
  add column max_doubles int not null default 4 check (max_doubles between 0 and 10);

create or replace function public.fixture_defaults()
returns trigger language plpgsql set search_path = '' as $$
declare club text;
begin
  if tg_op = 'INSERT' or new.home is distinct from old.home or new.away is distinct from old.away or new.round_id is distinct from old.round_id then
    select c.club_name into club from public.rounds r join public.competitions c on c.id = r.competition_id where r.id = new.round_id;
    new.ours := club in (new.home, new.away);
  end if;
  -- Aplazado o suspendido: anulado en la quiniela (aunque luego se juegue).
  if new.status = 'postponed' then new.void := true; end if;
  new.updated_at := now();
  return new;
end $$;

-- save_picks: igual que antes, con el máximo de dobles de la competición.
-- La quiniela se entrega entera, así que cada pronóstico se reescribe (insert … on conflict) en vez de borrar e insertar.
create or replace function public.save_picks(p_round bigint, p_picks jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare me public.members := public.my_member(); r public.rounds; maxd int; need bigint[]; got bigint[]; bad int; dbl int;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select r0.* into r from public.rounds r0 join public.competitions c on c.id = r0.competition_id
  where r0.id = p_round and c.team_id = me.team_id;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  select coalesce(r.max_doubles, c.max_doubles) into maxd from public.competitions c where c.id = r.competition_id;
  if r.id is distinct from public.open_round(r.competition_id) then raise exception 'ROUND_NOT_OPEN'; end if;
  if now() >= r.deadline then raise exception 'QUINIELA_CLOSED'; end if;
  if jsonb_typeof(p_picks) is distinct from 'object' then raise exception 'QUINIELA_INCOMPLETE'; end if;
  select coalesce(array_agg(id order by id), array[]::bigint[]) into need
  from public.fixtures where round_id = r.id and not ours and not void;
  select coalesce(array_agg(k order by k), array[]::bigint[]) into got
  from (select case when k ~ '^[0-9]{1,18}$' then k::bigint end as k from jsonb_object_keys(p_picks) k) x;
  if got is distinct from need then raise exception 'QUINIELA_INCOMPLETE'; end if;
  select count(*) filter (where jsonb_typeof(v) <> 'string' or (v #>> array[]::text[]) not in ('1','X','2','1X','X2','12')),
         count(*) filter (where length(v #>> array[]::text[]) = 2)
  into bad, dbl from jsonb_each(p_picks) e(k, v);
  if bad > 0 then raise exception 'BAD_PICK'; end if;
  if dbl > maxd then raise exception 'TOO_MANY_DOUBLES'; end if;
  insert into public.picks(fixture_id, member_id, round_id, team_id, signs, updated_at)
  select k::bigint, me.id, r.id, me.team_id, v #>> array[]::text[], now() from jsonb_each(p_picks) e(k, v)
  on conflict (fixture_id, member_id) do update set signs = excluded.signs, updated_at = excluded.updated_at;
end $fn$;

revoke execute on function public.fixture_defaults(), public.save_picks(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_picks(bigint, jsonb) to authenticated;
