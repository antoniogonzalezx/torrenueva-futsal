-- Juvenil: «Jornada 0» con los partidos de la jornada 1 del senior, hasta que empiece su calendario.
-- Usa los mismos códigos de la federación, así que ffcm-sync le pone los resultados igual que al senior.
-- El partido del Torrenueva senior también entra en la quiniela: club_name es provisional y no coincide con
-- ningún equipo del grupo (al cargar el calendario del juvenil se pone su nombre en la federación).
-- Cuando empiece la liga del juvenil: genera su calendario con scripts/calendario_pdf.py --team juvenil
-- (actualiza la competición con sus códigos y añade sus jornadas desde la 1; la 0 se queda como histórico).

insert into public.competitions (team_id, name, club_name, short_names, ffcm_temporada, ffcm_competicion, ffcm_grupo)
select j.id, 'Jornada 0 · ' || s.name, 'TORRENUEVA FS JUVENIL (pendiente de calendario)', s.short_names, s.ffcm_temporada, s.ffcm_competicion, s.ffcm_grupo
from public.teams j, public.competitions s join public.teams st on st.id = s.team_id
where j.slug = 'juvenil' and st.slug = 'senior'
on conflict (team_id) do nothing;

insert into public.rounds (competition_id, num, match_date)
select cj.id, 0, rs.match_date
from public.competitions cj join public.teams j on j.id = cj.team_id and j.slug = 'juvenil',
     public.rounds rs join public.competitions cs on cs.id = rs.competition_id join public.teams s on s.id = cs.team_id and s.slug = 'senior'
where rs.num = 1
on conflict (competition_id, num) do nothing;

insert into public.fixtures (round_id, home, away)
select r0.id, f.home, f.away
from public.rounds r0 join public.competitions cj on cj.id = r0.competition_id join public.teams j on j.id = cj.team_id and j.slug = 'juvenil',
     public.fixtures f join public.rounds rs on rs.id = f.round_id join public.competitions cs on cs.id = rs.competition_id
     join public.teams s on s.id = cs.team_id and s.slug = 'senior'
where r0.num = 0 and rs.num = 1
on conflict (round_id, home, away) do nothing;
