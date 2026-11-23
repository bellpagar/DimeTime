# DimeTime account setup

DimeTime uses Supabase Auth for email-and-password accounts and a private, row-level-secured table for each account's data. Your email is the username. The Supabase publishable key is expected to be visible in the website; the database policies are what prevent one account from reading another account's records.

## Create the private data table

1. Create a Supabase project in your own account.
2. Open **SQL Editor** and run [`supabase-setup.sql`](supabase-setup.sql).

## Configure email sign-in

In **Authentication → URL Configuration**, set the Site URL and add this Redirect URL:

`https://bellpagar.github.io/DimeTime/`

Keep email confirmation enabled if you want new accounts to verify their email before signing in.

## Finish connecting the website

From **Project Settings → API Keys**, copy the Project URL and the publishable key. Share those two public client values so they can be added to `config.js` and the website redeployed.

Do not share the secret key, database password, or an access token. Those are private server credentials and are not needed by DimeTime.
## Email reminders

Email reminders are sent by a scheduled Supabase Edge Function, so they work while DimeTime is closed. The signed-in account email is the destination. Bill reminders are sent three days before the monthly due date; timed schedule items are sent about one hour before.

To enable delivery, complete these one-time steps:

1. Create an account with an email delivery provider such as Resend, create an API key, and verify a sender address/domain with that provider.
2. In Supabase, open **Edge Functions → Secrets** and add `RESEND_API_KEY`, `EMAIL_FROM` (your verified sender, for example `DimeTime <reminders@your-domain>`), and `CRON_SECRET` (a long random value you create). Do not put these values in the website or GitHub.
3. From the project folder, install/use the Supabase CLI, then run `supabase login`, `supabase link --project-ref bfngkmvpwobrnybdlhof`, and `supabase functions deploy send-reminders`.
4. Open `email-reminders-setup.sql`. Replace `REPLACE_WITH_THE_SAME_RANDOM_CRON_SECRET` with the same value set for `CRON_SECRET`, then run the SQL in **Supabase → SQL Editor**. This creates the private deduplication table and a one-minute schedule. The schedule secret is stored in Supabase Vault.
5. Sign in to DimeTime and choose **Enable email reminders**. The preference syncs with your account.

The reminder function uses the signed-in user's account email, and service credentials stay in Supabase. If you rotate `CRON_SECRET`, update both the Edge Function secret and Vault secret, then redeploy/re-run the relevant setup.

