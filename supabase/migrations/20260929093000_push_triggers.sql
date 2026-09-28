-- Notificaciones push: la base de datos avisa a la edge function «notify» con pg_net.
create extension if not exists pg_net with schema extensions;

-- Secretos solo legibles con service_role (RLS activado y sin políticas).
-- Valores (no se guardan en el repo):
--   insert into public.app_secrets values
--     ('vapid_public','…'),('vapid_private','…'),('vapid_subject','mailto:…'),('webhook_secret','…');
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.notify_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  select value into secret from public.app_secrets where key = 'webhook_secret';
  if secret is null then return new; end if;
  perform net.http_post(
    url     := 'https://cmfhosxslodnrxlpifrn.supabase.co/functions/v1/notify',
    body    := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', secret),
    timeout_milliseconds := 5000);
  return new;
end $$;
revoke execute on function public.notify_push() from public, anon, authenticated;

create trigger posts_push    after insert on public.posts         for each row execute function public.notify_push();
create trigger comments_push after insert on public.post_comments for each row execute function public.notify_push();
create trigger likes_push    after insert on public.post_likes    for each row execute function public.notify_push();
