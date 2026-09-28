-- Recordatorio push de multas que se duplican en 2 días (una vez al día).
create extension if not exists pg_cron;

create or replace function public.send_fine_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  select value into secret from public.app_secrets where key = 'webhook_secret';
  if secret is null then return; end if;
  perform net.http_post(
    url     := 'https://cmfhosxslodnrxlpifrn.supabase.co/functions/v1/notify',
    body    := jsonb_build_object('type', 'reminders'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', secret),
    timeout_milliseconds := 10000);
end $$;
revoke execute on function public.send_fine_reminders() from public, anon, authenticated;

-- 08:00 UTC = 10:00 en verano / 09:00 en invierno (hora de España).
select cron.schedule('fine-reminders', '0 8 * * *', 'select public.send_fine_reminders()');
