-- Fix: pg_net function was called as extensions.net.http_post() in migration 004,
-- but pg_net functions live in the net schema — the correct call is net.http_post().
-- The old function compiled without error but referenced a non-existent path at
-- runtime, so the trigger ran silently and never actually invoked alarm-push.
--
-- Additional hardening: wrap the HTTP call in an exception block so a pg_net
-- failure (network blip, extension not enabled) never rolls back the alarm
-- status update that triggered it.  The in-page beep still works; only the
-- push notification is lost if the call fails.

CREATE EXTENSION IF NOT EXISTS pg_net;          -- idempotent, net schema by default

CREATE OR REPLACE FUNCTION notify_alarm_push()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'ringing' AND OLD.status IS DISTINCT FROM 'ringing' THEN
    BEGIN
      PERFORM net.http_post(
        url     := 'https://ojuouvfractsloqozlyh.supabase.co/functions/v1/alarm-push',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdW91dmZyYWN0c2xvcW96bHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDcyNTYsImV4cCI6MjA4NzkyMzI1Nn0.cxaxSlZ7YpQohAT-dvujjvYzo8uRBExolakCoV-AExY'
        ),
        body    := jsonb_build_object('record', to_jsonb(NEW))
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let a push-notification failure roll back the status transition.
      RAISE WARNING 'notify_alarm_push: net.http_post failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-create the trigger (DROP + CREATE is idempotent).
DROP TRIGGER IF EXISTS alarm_ringing_push ON alarms;
CREATE TRIGGER alarm_ringing_push
  AFTER UPDATE OF status ON alarms
  FOR EACH ROW
  EXECUTE FUNCTION notify_alarm_push();
