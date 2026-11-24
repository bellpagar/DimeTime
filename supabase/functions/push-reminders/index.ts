import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-cron-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const escapeText = (value: unknown) => String(value ?? "").replace(/[<>]/g, "");

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function localDate(date: Date, zone: string) { const p = localParts(date, zone); return `${p.year}-${p.month}-${p.day}`; }
function addDays(value: string, amount: number) { const [y,m,d] = value.split("-").map(Number); const x = new Date(Date.UTC(y,m-1,d+amount)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,"0")}-${String(x.getUTCDate()).padStart(2,"0")}`; }
function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

const vapidJson = Deno.env.get("VAPID_JWK");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!vapidJson || !supabaseUrl || !serviceKey) return json({ error: "Push service secrets are not configured." }, 503);
  let vapidKeys: CryptoKeyPair;
  let appServer: webpush.ApplicationServer;
  try {
    vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJson), { extractable: false });
    appServer = await webpush.ApplicationServer.new({ contactInformation: "mailto:dimetime-notifications@example.com", vapidKeys });
  } catch { return json({ error: "VAPID_JWK must contain a valid VAPID key pair in JWK JSON format." }, 500); }

  if (request.method === "GET") {
    return json({ publicKey: await webpush.exportApplicationServerKey(vapidKeys) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const cronSecret = Deno.env.get("PUSH_CRON_SECRET");
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) return json({ error: "Unauthorized." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: records, error } = await admin.from("daymark_private_data").select("user_id,data");
  if (error) return json({ error: error.message }, 500);
  const now = new Date();
  let sent = 0;
  const failures: string[] = [];

  for (const record of records ?? []) {
    const state = record.data ?? {};
    const timezone = state.reminderTimezone || "Asia/Kuala_Lumpur";
    const today = localDate(now, timezone);
    const targetDate = addDays(today, 3);
    const localNow = localParts(now, timezone);
    const localHour = Number(localNow.hour);
    const localMinute = Number(localNow.minute);
    const reminders: Array<{ key: string; title: string; body: string }> = [];
    if (localHour === 21 && localMinute < 5) {
      reminders.push({ key: `daily-expenses:${today}`, title: "Log today's expenses", body: "Take a moment to add today's spending to DimeTime." });
    }
    if (localHour === 9 && localMinute < 5 && today.endsWith("-01")) {
      reminders.push({ key: `monthly-insight:${today.slice(0,7)}`, title: "Your monthly insight is ready", body: "Take a look at your spending summary in DimeTime." });
    }
    if (localHour === 9 && localMinute < 5) {
      for (const bill of state.bills ?? []) {
        const [year, month] = targetDate.split("-").map(Number);
        if (Math.min(Number(bill.day), daysInMonth(year, month)) !== Number(targetDate.slice(-2))) continue;
        reminders.push({ key: `bill:${bill.id}:${targetDate}`, title: `Bill due in 3 days: ${escapeText(bill.name)}`, body: `Set aside ${new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(bill.amount)||0)} for ${escapeText(bill.name)}.` });
      }
    }
    for (const task of state.tasks ?? []) {
      if (!task.time || task.done) continue;
      const taskZone = task.timeZone || timezone;
      const p = localParts(now, taskZone);
      const nowWall = Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), Number(p.hour), Number(p.minute));
      const [y,m,d] = String(task.date).split("-").map(Number);
      const [h,minute] = String(task.time).split(":").map(Number);
      const delta = (Date.UTC(y,m-1,d,h,minute)-nowWall)/60000;
      if (delta <= 0 || delta > 60) continue;
      const mins = Math.ceil(delta);
      reminders.push({ key: `task:${task.id}:${task.date}:${task.time}`, title: `Coming up: ${escapeText(task.text)}`, body: `Your task starts in about ${mins} minute${mins===1?"":"s"}.` });
    }
    if (!reminders.length) continue;
    const { data: subscriptions, error: subError } = await admin.from("daymark_push_subscriptions").select("endpoint,subscription").eq("user_id", record.user_id);
    if (subError) { failures.push(subError.message); continue; }
    for (const reminder of reminders) {
      const { error: claimError } = await admin.from("daymark_push_sent").insert({ user_id: record.user_id, reminder_key: reminder.key });
      if (claimError?.code === "23505") continue;
      if (claimError) { failures.push(claimError.message); continue; }
      let delivered = 0;
      for (const row of subscriptions ?? []) {
        try {
          await appServer.subscribe(row.subscription).pushTextMessage(JSON.stringify({ ...reminder, url: "./" }), {});
          delivered++;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (delivered) sent++;
      else await admin.from("daymark_push_sent").delete().eq("user_id", record.user_id).eq("reminder_key", reminder.key);
    }
  }
  return json({ sent, failures }, failures.length ? 207 : 200);
});

