# DimeTime push notifications

DimeTime uses the existing Supabase project as its notification server. No Resend account or custom domain is needed. Push delivery requires a user-approved subscription for each device, a Supabase Edge Function, and a scheduled Supabase Cron job.

## One-time server setup

1. Generate a VAPID key pair using Deno:

   ```sh
   deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts
   ```

   Copy the complete JSON output. Keep it private; it contains the VAPID private key.

2. In **Supabase → Edge Functions → Secrets**, add:
   - `VAPID_JWK` — the complete generated JSON, entered as one-line JSON.
   - `PUSH_CRON_SECRET` — a long random secret you create. Keep it private.

   Supabase provides the project URL and service-role key to Edge Functions automatically.

3. From a local copy of this repository, install the Supabase CLI if needed and run:

   ```sh
   supabase login
   supabase link --project-ref bfngkmvpwobrnybdlhof
   supabase functions deploy push-reminders
   ```

4. Open `push-reminders-setup.sql`. Replace `REPLACE_WITH_THE_SAME_LONG_RANDOM_PUSH_CRON_SECRET` with the value used for `PUSH_CRON_SECRET`, then run the file in **Supabase → SQL Editor**. It creates per-user device subscriptions, a private deduplication table, and the one-minute schedule. The schedule secret is stored in Supabase Vault.

5. Open DimeTime, sign in, choose **Monthly bills → Enable push notifications**, and allow the browser prompt. Repeat on each device that should receive alerts. The first alert can arrive at the next scheduled check.

Push alerts cover monthly bills three days before their due day and timed schedule items about one hour before. On iPhone/iPad, first add DimeTime to the Home Screen, open it from there, and then enable notifications (iOS/iPadOS 16.4 or later).

Never commit `VAPID_JWK` or `PUSH_CRON_SECRET` to GitHub, and do not paste them into chat. The generated public key is delivered by the Edge Function to the browser; only the private VAPID key stays in Supabase.

