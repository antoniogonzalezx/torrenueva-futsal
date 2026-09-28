-- ════════════════════════════════════════════════════════════════
--  Feed (sustituye al chat), admins, estadísticas de futsal,
--  límites de almacenamiento y base para notificaciones push.
-- ════════════════════════════════════════════════════════════════

-- ── Fuera el chat ───────────────────────────────────────────────
alter publication supabase_realtime drop table public.messages;
drop table public.messages;

-- ── Estadísticas de futsal ──────────────────────────────────────
alter table public.members
  add column saves          int not null default 0 check (saves >= 0),           -- paradas (porteros)
  add column goals_conceded int not null default 0 check (goals_conceded >= 0),  -- goles encajados (porteros)
  add column clean_sheets   int not null default 0 check (clean_sheets >= 0);    -- porterías a cero (porteros)
grant update (saves, goals_conceded, clean_sheets) on public.members to authenticated;

-- ── Admins: solo ellos dan de alta jugadores ────────────────────
drop policy members_add on public.members;
create policy members_add on public.members for insert to authenticated
  with check (team_id = public.my_team_id() and coalesce((public.my_member()).is_admin, false));

-- Los admins de cada equipo se asignan con datos, no en el esquema (ver supabase/seed.example.sql).

-- ── Feed ────────────────────────────────────────────────────────
create table public.posts (
  id             bigint generated always as identity primary key,
  team_id        uuid not null references public.teams(id) on delete cascade,
  author_id      uuid references public.members(id) on delete set null,   -- quién publica
  player_id      uuid references public.members(id) on delete cascade,    -- de quién va (el goleador, el multado…)
  kind           text not null check (kind in ('match','fine')),
  fine_id        uuid unique references public.fines(id) on delete cascade,
  rival          text check (length(rival) <= 60),
  score_for      int check (score_for between 0 and 99),
  score_against  int check (score_against between 0 and 99),
  goals          int not null default 0 check (goals between 0 and 30),
  assists        int not null default 0 check (assists between 0 and 30),
  saves          int not null default 0 check (saves between 0 and 99),
  goals_conceded int not null default 0 check (goals_conceded between 0 and 99),
  body           text check (length(body) <= 500),
  photo_path     text,
  photo_w        int,
  photo_h        int,
  created_at     timestamptz not null default now()
);
create index posts_team_idx on public.posts(team_id, id desc);
create index posts_player_idx on public.posts(player_id, id desc);

create table public.post_likes (
  post_id    bigint not null references public.posts(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, member_id)
);

create table public.post_comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments(post_id, id);

alter table public.posts         enable row level security;
alter table public.post_likes    enable row level security;
alter table public.post_comments enable row level security;
revoke all on public.posts, public.post_likes, public.post_comments from anon, authenticated;
grant select on public.posts, public.post_likes, public.post_comments to authenticated;
grant insert (post_id, member_id, team_id) on public.post_likes to authenticated;
grant delete on public.post_likes to authenticated;
grant insert (post_id, member_id, team_id, body) on public.post_comments to authenticated;
grant delete on public.post_comments to authenticated;

create policy posts_read on public.posts for select to authenticated using (team_id = public.my_team_id());
create policy likes_read on public.post_likes for select to authenticated using (team_id = public.my_team_id());
create policy likes_add  on public.post_likes for insert to authenticated
  with check (team_id = public.my_team_id() and member_id = public.my_member_id()
              and exists (select 1 from public.posts p where p.id = post_id and p.team_id = public.my_team_id()));
create policy likes_del  on public.post_likes for delete to authenticated using (member_id = public.my_member_id());
create policy comments_read on public.post_comments for select to authenticated using (team_id = public.my_team_id());
create policy comments_add  on public.post_comments for insert to authenticated
  with check (team_id = public.my_team_id() and member_id = public.my_member_id()
              and exists (select 1 from public.posts p where p.id = post_id and p.team_id = public.my_team_id()));
create policy comments_del  on public.post_comments for delete to authenticated
  using (team_id = public.my_team_id() and (member_id = public.my_member_id() or coalesce((public.my_member()).is_admin, false)));

-- Publicar un partido: crea el post y suma las estadísticas del jugador.
create or replace function public.create_match_post(
  p_player uuid, p_rival text, p_score_for int, p_score_against int,
  p_goals int, p_assists int, p_saves int, p_conceded int,
  p_body text, p_photo_path text, p_photo_w int, p_photo_h int)
returns public.posts language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); pl public.members; p public.posts;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into pl from public.members where id = coalesce(p_player, me.id) and team_id = me.team_id and active;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> me.team_id::text then raise exception 'NOT_ALLOWED'; end if;

  insert into public.posts(team_id, author_id, player_id, kind, rival, score_for, score_against,
                           goals, assists, saves, goals_conceded, body, photo_path, photo_w, photo_h)
  values (me.team_id, me.id, pl.id, 'match', nullif(trim(p_rival),''), p_score_for, p_score_against,
          greatest(0,coalesce(p_goals,0)), greatest(0,coalesce(p_assists,0)),
          greatest(0,coalesce(p_saves,0)), greatest(0,coalesce(p_conceded,0)),
          nullif(trim(p_body),''), p_photo_path, p_photo_w, p_photo_h)
  returning * into p;

  update public.members set
    matches = matches + 1, goals = goals + p.goals, assists = assists + p.assists,
    saves = saves + p.saves, goals_conceded = goals_conceded + p.goals_conceded,
    clean_sheets = clean_sheets + case when pl.position = 'Portero' and p.score_against = 0 then 1 else 0 end
  where id = pl.id;
  return p;
end $$;

-- Borrar un partido (autor, el propio jugador o admin): resta lo sumado. Devuelve la foto para borrarla del storage.
create or replace function public.delete_post(p_post bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); p public.posts; pl public.members;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into p from public.posts where id = p_post and team_id = me.team_id for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if p.kind <> 'match' then raise exception 'FINE_POST'; end if;
  if not (p.author_id = me.id or p.player_id = me.id or me.is_admin) then raise exception 'NOT_ALLOWED'; end if;
  select * into pl from public.members where id = p.player_id;
  if found then
    update public.members set
      matches = greatest(0, matches - 1), goals = greatest(0, goals - p.goals), assists = greatest(0, assists - p.assists),
      saves = greatest(0, saves - p.saves), goals_conceded = greatest(0, goals_conceded - p.goals_conceded),
      clean_sheets = greatest(0, clean_sheets - case when pl.position = 'Portero' and p.score_against = 0 then 1 else 0 end)
    where id = pl.id;
  end if;
  delete from public.posts where id = p.id;
  return p.photo_path;
end $$;

-- Cada multa nueva aparece en el feed.
create or replace function public.fine_to_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.posts(team_id, author_id, player_id, kind, fine_id, created_at)
  values (new.team_id, new.created_by, new.member_id, 'fine', new.id, new.created_at);
  return new;
end $$;
create trigger fines_to_feed after insert on public.fines for each row execute function public.fine_to_post();

-- ── Almacenamiento ──────────────────────────────────────────────
-- Fotos ya comprimidas en el móvil (WebP/JPEG, ≤1600px). Límite duro de 1,5 MB por archivo.
update storage.buckets set file_size_limit = 1572864, allowed_mime_types = array['image/webp','image/jpeg'] where id = 'media';
drop policy if exists media_delete_own on storage.objects;
-- Borrar: el dueño; cualquiera del equipo si es una foto de perfil (se reemplazan entre todos); admins, todo lo del equipo.
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_team_id()::text
         and (owner = auth.uid() or (storage.foldername(name))[2] = 'avatars' or coalesce((public.my_member()).is_admin, false)));

create or replace function public.storage_usage()
returns table (files bigint, bytes bigint) language sql stable security definer set search_path = '' as $$
  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o where o.bucket_id = 'media' and (storage.foldername(o.name))[1] = public.my_team_id()::text
$$;

-- ── Notificaciones push (suscripciones) ─────────────────────────
create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references public.members(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member();
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  insert into public.push_subscriptions(member_id, team_id, endpoint, p256dh, auth)
  values (me.id, me.team_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set member_id = excluded.member_id, team_id = excluded.team_id,
                                        p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and member_id = public.my_member_id()
$$;

-- ── Permisos ────────────────────────────────────────────────────
revoke execute on function
  public.create_match_post(uuid, text, int, int, int, int, int, int, text, text, int, int),
  public.delete_post(bigint), public.fine_to_post(), public.storage_usage(),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text)
from public, anon, authenticated;
grant execute on function public.create_match_post(uuid, text, int, int, int, int, int, int, text, text, int, int) to authenticated;
grant execute on function public.delete_post(bigint) to authenticated;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

alter publication supabase_realtime add table public.posts, public.post_likes, public.post_comments;
