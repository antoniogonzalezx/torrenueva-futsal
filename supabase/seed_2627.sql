-- Plantillas iniciales 2026/27.
-- Los códigos de equipo NO se guardan aquí: se guardan como hash (bcrypt).
-- Para cambiar el código de un equipo:
--   update public.teams set join_code_hash = extensions.crypt('NUEVO-CODIGO', extensions.gen_salt('bf')) where slug = 'senior';

insert into public.teams (slug, name, join_code_hash) values
  ('senior',  'Torrenueva FS',         extensions.crypt(:'senior_code',  extensions.gen_salt('bf'))),
  ('juvenil', 'Torrenueva FS Juvenil', extensions.crypt(:'juvenil_code', extensions.gen_salt('bf')));

insert into public.members (team_id, name, emoji, position)
select t.id, v.name, v.emoji, v.position
from public.teams t, (values
  ('Adrián Vivar','👮🏻‍♂️','Entrenador'),
  ('Alberto Rubio','👨🏻‍🔧',null),
  ('Álvaro','🧧',null),
  ('Ángel','🫁',null),
  ('Antonio','👨‍💻',null),
  ('Buitre','🦅',null),
  ('Carlos J.','🤏',null),
  ('Carrasco','🍔','Portero'),
  ('Chus','🚬',null),
  ('Elías','👓','Staff'),
  ('Guille','⚡',null),
  ('Jaro','9️⃣','Staff'),
  ('José Antonio','🚌','Portero'),
  ('Josevi','🥷',null),
  ('Marc','🍩',null),
  ('Poti','🐳','Staff'),
  ('Raúl Bernalte','🔪','Entrenador'),
  ('Salva','🪡',null),
  ('Trumi','🎺',null),
  ('Víctor Chapu','🎸','Staff'),
  ('Xapu','🦨','Staff')
) as v(name, emoji, position)
where t.slug = 'senior';

insert into public.members (team_id, name, emoji)
select t.id, v.name, v.emoji
from public.teams t, (values
  ('Adrián Mister','🧠'),
  ('Adrián Loty','🎰'),
  ('Álvaro Gormaz','🦁'),
  ('Álvaro (Simpson)','🍩'),
  ('Andrés','🐺'),
  ('Carlitos','🐥'),
  ('Carlos Izquierdo','🦶'),
  ('Chinchi','🦟'),
  ('Covi','🦠'),
  ('Felix Jesús','🐈‍⬛'),
  ('Felipe','🦊'),
  ('Gael','🌊'),
  ('Héctor','🛡️'),
  ('Ignacio','🔥'),
  ('Javi Perillas','🍐'),
  ('Javi Alcaide','🗝️'),
  ('Juan Carlos','👑'),
  ('Juan Pablo','🎯'),
  ('Jesús','✨'),
  ('Sergio','🚀'),
  ('Samu','🐉')
) as v(name, emoji)
where t.slug = 'juvenil';
