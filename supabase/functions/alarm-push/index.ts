// Supabase Edge Function: alarm-push
// Triggered by a Database Webhook when alarms.status is updated to 'ringing'.
// Sends a Web Push notification to every recipient's subscribed device.
//
// Deploy: supabase functions deploy alarm-push
// Required secrets (supabase secrets set KEY=value):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   SUPABASE_URL          (auto-set by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const VAPID_SUBJECT = "mailto:support@ticktogether.app";

Deno.serve(async (req: Request) => {
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!vapidPublicKey || !vapidPrivateKey || !supabaseUrl || !serviceRoleKey) {
    return new Response("Missing env vars", { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, vapidPublicKey, vapidPrivateKey);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Database webhook sends { type, table, record, old_record }
  const record = payload.record;
  if (!record || record.status !== "ringing") {
    return new Response("skipped", { status: 200 });
  }

  const recipients: string[] = Array.isArray(record.recipients) ? record.recipients : [];
  if (recipients.length === 0) {
    return new Response("no recipients", { status: 200 });
  }

  // Find push subscriptions for all recipients in this group
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("subscription, member_name, user_id")
    .eq("group_code", record.group_code)
    .in("member_name", recipients);

  if (error || !subscriptions?.length) {
    return new Response("no subscriptions found", { status: 200 });
  }

  const notificationPayload = JSON.stringify({
    title: `⏰ ${record.message}`,
    body: `Timer set by ${record.created_by_name} is complete — tap to open`,
    alarmId: record.id,
    groupCode: record.group_code,
  });

  const staleUserIds: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, notificationPayload);
      } catch (err: any) {
        // 410 Gone / 404 Not Found = subscription no longer valid
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          staleUserIds.push(sub.user_id);
        }
      }
    })
  );

  // Clean up expired subscriptions so we don't keep trying them
  if (staleUserIds.length > 0) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("group_code", record.group_code)
      .in("user_id", staleUserIds);
  }

  return new Response("ok", { status: 200 });
});
