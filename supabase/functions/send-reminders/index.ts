import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDate(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function sendEmail(apiKey: string, from: string, to: string, subject: string, text: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${await response.text()}`);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) return new Response("Unauthorized", { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  if (!supabaseUrl || !serviceKey || !resendKey || !emailFrom) return Response.json({ error: "Email reminder secrets are incomplete." }, { status: 500, headers });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: records, error } = await admin.from("daymark_private_data").select("user_id,data");
  if (error) return Response.json({ error: error.message }, { status: 500, headers });

  const now = new Date();
  let sent = 0;
  const failures: string[] = [];
  for (const record of records ?? []) {
    const state = record.data ?? {};
    if (!state.emailReminders) continue;
    const { data: auth, error: authError } = await admin.auth.admin.getUserById(record.user_id);
    if (authError || !auth.user?.email) continue;
    const email = auth.user.email;
    const timezone = state.reminderTimezone || "Asia/Kuala_Lumpur";
    const today = localDate(now, timezone);
    const targetBillDate = addDays(today, 3);
    const reminders: Array<{ key: string; subject: string; text: string; html: string }> = [];

    for (const bill of state.bills ?? []) {
      const [year, month] = targetBillDate.split("-").map(Number);
      const dueDay = Math.min(Number(bill.day), daysInMonth(year, month));
      if (dueDay !== Number(targetBillDate.slice(-2))) continue;
      const dueLabel = new Date(Date.UTC(year, month - 1, dueDay)).toLocaleDateString("en-MY", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
      const name = escapeHtml(bill.name);
      const amount = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(bill.amount) || 0);
      reminders.push({
        key: `bill:${bill.id}:${targetBillDate}`,
        subject: `DimeTime reminder: ${bill.name} is due in 3 days`,
        text: `${bill.name} (${amount}) is due on ${dueLabel}. Set aside enough money before the due date.`,
        html: `<p><strong>${name}</strong> (${escapeHtml(amount)}) is due on ${escapeHtml(dueLabel)}.</p><p>Set aside enough money before the due date.</p><p>— DimeTime</p>`,
      });
    }

    for (const task of state.tasks ?? []) {
      if (!task.time || task.done) continue;
      const taskDate = String(task.date ?? "");
      const taskTime = String(task.time ?? "");
      const p = localParts(now, task.timeZone || timezone);
      const nowWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
      const [year, month, day] = taskDate.split("-").map(Number);
      const [hour, minute] = taskTime.split(":").map(Number);
      const deltaMinutes = (Date.UTC(year, month - 1, day, hour, minute) - nowWall) / 60000;
      if (deltaMinutes <= 0 || deltaMinutes > 60) continue;
      const mins = Math.ceil(deltaMinutes);
      const safeTask = escapeHtml(task.text);
      reminders.push({
        key: `task:${task.id}:${taskDate}:${taskTime}`,
        subject: `DimeTime: ${task.text} is coming up`,
        text: `Your task “${task.text}” is in about ${mins} minute${mins === 1 ? "" : "s"}.`,
        html: `<p>Your task <strong>${safeTask}</strong> is in about ${mins} minute${mins === 1 ? "" : "s"}.</p><p>— DimeTime</p>`,
      });
    }

    for (const reminder of reminders) {
      const { error: markError } = await admin.from("daymark_email_reminders").insert({ user_id: record.user_id, reminder_key: reminder.key });
      if (markError?.code === "23505") continue;
      if (markError) { failures.push(markError.message); continue; }
      try {
        await sendEmail(resendKey, emailFrom, email, reminder.subject, reminder.text, reminder.html);
        sent++;
      } catch (sendError) {
        await admin.from("daymark_email_reminders").delete().eq("user_id", record.user_id).eq("reminder_key", reminder.key);
        failures.push(sendError instanceof Error ? sendError.message : String(sendError));
      }
    }
  }

  return Response.json({ sent, failures }, { status: failures.length ? 207 : 200, headers });
});

