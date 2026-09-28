-- Ejemplo: alta de un equipo y su plantilla. Sustituye los valores de ejemplo.
-- El código de acceso se guarda solo como hash (bcrypt); repártelo aparte, nunca lo subas al repositorio.

insert into public.teams (slug, name, join_code_hash)
values ('senior', 'Nombre del equipo', extensions.crypt('CODIGO-DEL-EQUIPO', extensions.gen_salt('bf')));

-- position: Portero · Cierre · Ala · Pívot · Universal · Entrenador · Staff (o null)
insert into public.members (team_id, name, emoji, position)
select t.id, v.name, v.emoji, v.position
from public.teams t, (values
  ('Jugador 1', '⚽', 'Portero'),
  ('Jugador 2', '⚽', null),
  ('Entrenador 1', '⚽', 'Entrenador')
) as v(name, emoji, position)
where t.slug = 'senior';

-- Admins (pueden dar de alta y de baja jugadores y liberar cuentas):
update public.members set is_admin = true
where name in ('Jugador 1') and team_id = (select id from public.teams where slug = 'senior');

-- Cambiar el código de un equipo:
-- update public.teams set join_code_hash = extensions.crypt('NUEVO-CODIGO', extensions.gen_salt('bf')) where slug = 'senior';
