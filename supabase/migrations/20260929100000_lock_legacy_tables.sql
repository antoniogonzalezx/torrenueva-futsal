-- Temporada 25/26 archivada: los datos se conservan, pero nadie puede leerlos ni tocarlos
-- con la clave pública. Solo el panel de Supabase / service_role.
alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.mvp_votes     enable row level security;

revoke all on public.players, public.multas, public.lives_log, public.matches,
              public.match_players, public.mvp_votes, public.premios, public.config
  from anon, authenticated;

comment on table public.players is 'Archivo temporada 2025/26 (solo lectura desde el panel).';
comment on table public.multas  is 'Archivo temporada 2025/26 (solo lectura desde el panel).';
