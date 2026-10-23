create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if not exists(select 1 from vault.secrets where name='chiri_cleanup_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'chiri_cleanup_secret');
 end if;
end $$;
create or replace function public.verify_cleanup_secret(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from vault.decrypted_secrets where name='chiri_cleanup_secret' and decrypted_secret=candidate);
$$;
revoke all on function public.verify_cleanup_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cleanup_secret(text) to service_role;
alter function public.party_time() set search_path = '';
select cron.schedule('chiri-cleanup-hourly','0 * * * *',$job$
 select net.http_post(
 url := 'https://dvzovsjneyrsoypiqrtl.supabase.co/functions/v1/cleanup-recordings',
 headers := jsonb_build_object('Content-Type','application/json','x-cleanup-secret',
 (select decrypted_secret from vault.decrypted_secrets where name='chiri_cleanup_secret')),
 body := '{}'::jsonb, timeout_milliseconds := 60000);
$job$);

