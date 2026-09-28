-- Jornada 0: una jornada de prueba antes de que empiece el calendario de un equipo
-- (el juvenil juega la quiniela con la jornada 1 del senior mientras empieza su liga).
alter table public.rounds drop constraint rounds_num_check;
alter table public.rounds add constraint rounds_num_check check (num >= 0);
