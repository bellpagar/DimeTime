-- Run once in Supabase SQL Editor after deploying push-reminders.
-- Replace the placeholder with the same long random secret stored as PUSH_CRON_SECRET.

create table if not exists public.daymark_push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text primary key,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.daymark_push_subscriptions enable row level security;
drop policy if exists "Users manage own push subscriptions" on public.daymark_push_subscriptions;
create policy "Users manage own push subscriptions" on public.daymark_push_subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.daymark_push_subscriptions to authenticated;
grant all on public.daymark_push_subscriptions to service_role;

create table if not exists public.daymark_push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, reminder_key)
);
alter table public.daymark_push_sent enable row level security;
revoke all on public.daymark_push_sent from anon, authenticated;
grant all on public.daymark_push_sent to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
select vault.create_secret('https://bfngkmvpwobrnybdlhof.supabase.co', 'dimetime_project_url');
select vault.create_secret('REPLACE_WITH_THE_SAME_LONG_RANDOM_PUSH_CRON_SECRET', 'dimetime_push_cron_secret');
select cron.unschedule(jobid) from cron.job where jobname = 'dimetime-push-reminders';
select cron.schedule('dimetime-push-reminders','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'dimetime_project_url') || '/functions/v1/push-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'dimetime_push_cron_secret')),
    body := '{}'::jsonb
  );
$job$);

