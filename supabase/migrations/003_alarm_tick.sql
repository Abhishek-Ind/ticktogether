-- Server-side alarm tick (safety net).
--
-- The group page client already transitions alarms from "running" → "ringing"
-- via a 1-second setInterval, which keeps latency low.  However, client-driven
-- transitions have a gap: if every member closes their tab while a timer is
-- running, nobody fires the transition and the alarm is silently missed.
--
-- This migration adds a pg_cron job that runs every minute and transitions any
-- overdue "running" alarms to "ringing" so the alarm-push Edge Function (and
-- any connected clients) still fire.  The update is conditional on status =
-- "running" so it is idempotent with the client-side path.
--
-- Prerequisites: the pg_cron extension must be enabled in the Supabase dashboard
-- under Database → Extensions before running this migration.

-- 1. Create the worker function (idempotent via CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION tick_overdue_alarms()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE alarms
  SET    status = 'ringing'
  WHERE  status  = 'running'
    AND  ends_at <= now();
$$;

-- 2. Schedule it to run every minute.
--    cron.schedule is idempotent: calling it again with the same name updates
--    the schedule rather than creating a duplicate.
SELECT cron.schedule(
  'tick-overdue-alarms',   -- job name (unique key)
  '* * * * *',             -- every minute
  'SELECT tick_overdue_alarms()'
);
