-- Run once in the Supabase SQL Editor after deploying the send-reminders function.
-- Before running: replace the cron secret value below with a random value, then
-- add that exact value as the CRON_SECRET Edge Function secret.

create table if not exists public.daymark_email_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, reminder_key)
);

alter table public.daymark_email_reminders enable row level security;
revoke all on public.daymark_email_reminders from anon, authenticated;
grant all on public.daymark_email_reminders to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret('https://bfngkmvpwobrnybdlhof.supabase.co', 'dimetime_project_url');
select vault.create_secret('REPLACE_WITH_THE_SAME_RANDOM_CRON_SECRET', 'dimetime_cron_secret');

select cron.unschedule(jobid)
from cron.job
where jobname = 'dimetime-email-reminders';

select cron.schedule(
  'dimetime-email-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'dimetime_project_url') || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dimetime_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);

