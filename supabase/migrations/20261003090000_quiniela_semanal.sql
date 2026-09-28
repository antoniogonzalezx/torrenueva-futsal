-- ════════════════════════════════════════════════════════════════
--  Quiniela semanal: una sola jornada abierta a la vez.
--  · El domingo a las 22:00 (Madrid) el GitHub Action lee los resultados y ffcm-sync cierra la jornada:
--    lo que siga sin resultado queda anulado y se abre la siguiente (la primera jornada sin cerrar).
--  · Si ese día falla, pg_cron la cierra el lunes por la mañana.
--  · El ranking solo cuenta jornadas cerradas y se puede ver por jornada.
-- ════════════════════════════════════════════════════════════════

-- La jornada abierta de una competición: la primera sin cerrar.
create or replace function public.open_round(p_competition uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.rounds where competition_id = p_competition and not closed order by num limit 1
$$;

-- Solo se pueden entregar pronósticos de la jornada abierta y antes del viernes a las 14:00.
create or replace function public.save_picks(p_round bigint, p_picks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); r public.rounds; need bigint[]; got bigint[]; bad int; dbl int;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select r0.* into r from public.rounds r0 join public.competitions c on c.id = r0.competition_id
  where r0.id = p_round and c.team_id = me.team_id;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if r.id is distinct from public.open_round(r.competition_id) then raise exception 'ROUND_NOT_OPEN'; end if;
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

-- Ranking de jornadas cerradas: total (p_round null) o de una jornada.
-- Orden: puntos; después, más plenos (signo único acertado); después, menos dobles.
drop function if exists public.quiniela_ranking();
create or replace function public.quiniela_ranking(p_round bigint default null)
returns table (member_id uuid, points bigint, hits bigint, hits3 bigint, hits1 bigint, doubles bigint, rounds bigint)
language sql stable security definer set search_path = '' as $$
  select pp.member_id,
         coalesce(sum(pp.points), 0),
         count(*) filter (where pp.points > 0),
         count(*) filter (where pp.points = 3),
         count(*) filter (where pp.points = 1),
         count(*) filter (where length(pp.signs) = 2),
         count(distinct pp.round_id)
  from public.pick_points pp join public.rounds r on r.id = pp.round_id
  where pp.team_id = public.my_team_id() and r.closed and (p_round is null or r.id = p_round)
  group by pp.member_id
$$;

-- Cierre: jornadas cuyo fin de semana ya ha pasado (el sábado de la jornada es anterior a hoy en Madrid).
-- Lo que siga sin resultado se anula. Al cerrar, la siguiente jornada queda abierta.
create or replace function public.close_rounds()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with done as (
    update public.rounds set closed = true
    where not closed and match_date < (now() at time zone 'Europe/Madrid')::date
    returning id)
  update public.fixtures f set void = true
  from done where f.round_id = done.id and f.home_goals is null and not f.ours and not f.void;
  get diagnostics n = row_count;
  return n;
end $$;

-- Respaldo del lunes: si el domingo no se cerró, se cierra y se manda el push de puntos.
create or replace function public.quiniela_weekly_close()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.close_rounds();
  perform public.call_edge('notify', '{"type":"quiniela_results"}'::jsonb);
end $$;

revoke execute on function public.open_round(uuid), public.save_picks(bigint, jsonb), public.quiniela_ranking(bigint),
  public.close_rounds(), public.quiniela_weekly_close() from public, anon, authenticated;
grant execute on function public.open_round(uuid)            to authenticated;
grant execute on function public.save_picks(bigint, jsonb)   to authenticated;
grant execute on function public.quiniela_ranking(bigint)    to authenticated;

-- Tareas programadas: fuera la sincronización diaria (ffcm.es no responde a Supabase; la hace GitHub
-- los domingos) y el cierre diario; el cierre de respaldo va el lunes a las 06:00 UTC.
select cron.unschedule(jobid) from cron.job where jobname in ('ffcm-sync', 'quiniela-close');
select cron.schedule('quiniela-close', '0 6 * * 1', 'select public.quiniela_weekly_close()');
