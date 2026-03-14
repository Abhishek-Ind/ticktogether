-- Fixes two bugs that prevented alarms from working for non-group-creators.
--
-- Bug 1 – "Alarm does not start for a user unless they created the group"
--   Root cause: the groups table (and likely alarms/group_members) had RLS
--   enabled but no member-accessible SELECT policy.  getActiveGroupFromDb()
--   in group.js fetches the group after verifying membership.  Without a
--   SELECT policy that allows members to read groups, the query returns null
--   and the page throws "Group not found.", redirecting the user back to the
--   home screen.  Non-creators could never use the group page at all.
--
-- Bug 2 – "Alarm should work even if the app is not open"
--   Root cause: the alarm-push Edge Function is never called automatically.
--   It was designed to be invoked by a DB webhook configured in the Supabase
--   dashboard, but that webhook is not set up.  Without it, push notifications
--   are never sent regardless of alarm status.  Fix: a TRIGGER that fires on
--   every running→ringing transition (whether caused by a connected client's
--   ticker or by the pg_cron safety-net from migration 003) and calls the
--   Edge Function via pg_net — no dashboard configuration needed.

-- ── 0. Extensions ─────────────────────────────────────────────────────────────

-- pg_net ships with all Supabase projects and provides fire-and-forget HTTP
-- requests from inside PostgreSQL functions/triggers.
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── 1. SECURITY DEFINER helper ────────────────────────────────────────────────

-- Returns the group codes the current user belongs to.
-- Must be SECURITY DEFINER so it can query group_members without going through
-- the RLS policy on that table — if we used a plain SQL expression inside the
-- group_members policy, it would cause infinite recursion.
CREATE OR REPLACE FUNCTION get_my_group_codes()
  RETURNS SETOF text
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT group_code FROM group_members WHERE user_id = auth.uid();
$$;

-- ── 2. groups RLS ─────────────────────────────────────────────────────────────

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may create a group (they become the creator).
DROP POLICY IF EXISTS "authenticated users can create groups" ON groups;
CREATE POLICY "authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (auth.uid() = created_by_user_id);

-- Any member of the group may read it (needed to render the group page header).
DROP POLICY IF EXISTS "group members can read groups" ON groups;
CREATE POLICY "group members can read groups"
  ON groups FOR SELECT
  USING (code IN (SELECT get_my_group_codes()));

-- Only the creator may delete the group.
DROP POLICY IF EXISTS "group creator can delete groups" ON groups;
CREATE POLICY "group creator can delete groups"
  ON groups FOR DELETE
  USING (auth.uid() = created_by_user_id);

-- ── 3. group_members RLS ──────────────────────────────────────────────────────

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Members can see the full member list for every group they belong to.
-- This is required so the timer form can render the recipient-picker
-- (renderMembers → recipient checkboxes → hasRecipient check for the button).
DROP POLICY IF EXISTS "group members can read member list" ON group_members;
CREATE POLICY "group members can read member list"
  ON group_members FOR SELECT
  USING (group_code IN (SELECT get_my_group_codes()));

-- A user may join a group by inserting their own membership row.
DROP POLICY IF EXISTS "users can join groups" ON group_members;
CREATE POLICY "users can join groups"
  ON group_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- A user may update their own row (refresh member_name / device_id).
DROP POLICY IF EXISTS "users can update own membership" ON group_members;
CREATE POLICY "users can update own membership"
  ON group_members FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A user may leave by deleting their own row.
DROP POLICY IF EXISTS "users can leave groups" ON group_members;
CREATE POLICY "users can leave groups"
  ON group_members FOR DELETE
  USING (auth.uid() = user_id);

-- ── 4. alarms RLS ─────────────────────────────────────────────────────────────

ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;

-- Any group member may read all alarms in the group.
DROP POLICY IF EXISTS "group members can read alarms" ON alarms;
CREATE POLICY "group members can read alarms"
  ON alarms FOR SELECT
  USING (group_code IN (SELECT get_my_group_codes()));

-- Any group member may create an alarm.
DROP POLICY IF EXISTS "group members can create alarms" ON alarms;
CREATE POLICY "group members can create alarms"
  ON alarms FOR INSERT
  WITH CHECK (group_code IN (SELECT get_my_group_codes()));

-- Any group member may update an alarm
-- (tick running→ringing, mute, mark complete, stop-for-all).
DROP POLICY IF EXISTS "group members can update alarms" ON alarms;
CREATE POLICY "group members can update alarms"
  ON alarms FOR UPDATE
  USING (group_code IN (SELECT get_my_group_codes()));

-- Any group member may delete alarms
-- (used when the group creator bulk-deletes before deleting the group).
DROP POLICY IF EXISTS "group members can delete alarms" ON alarms;
CREATE POLICY "group members can delete alarms"
  ON alarms FOR DELETE
  USING (group_code IN (SELECT get_my_group_codes()));

-- ── 5. Trigger: call alarm-push when an alarm transitions to ringing ──────────

-- This replaces the need for a manually-configured DB webhook in the Supabase
-- dashboard.  The trigger fires for every running→ringing row change — whether
-- caused by a connected client's 1-second ticker OR by the pg_cron safety-net
-- job from migration 003.
--
-- net.http_post is fire-and-forget: the trigger returns immediately and the
-- HTTP request is processed asynchronously by pg_net background workers.
-- The body format matches what the Edge Function already expects from the
-- Supabase database webhook: { "record": { ...alarm columns... } }.

CREATE OR REPLACE FUNCTION notify_alarm_push()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'ringing' AND OLD.status IS DISTINCT FROM 'ringing' THEN
    PERFORM extensions.net.http_post(
      url     := 'https://ojuouvfractsloqozlyh.supabase.co/functions/v1/alarm-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        -- The anon key is intentionally public (already embedded in config.js).
        -- The Edge Function uses its own SUPABASE_SERVICE_ROLE_KEY env var for
        -- its DB queries; this token is only used to pass gateway authentication.
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdW91dmZyYWN0c2xvcW96bHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDcyNTYsImV4cCI6MjA4NzkyMzI1Nn0.cxaxSlZ7YpQohAT-dvujjvYzo8uRBExolakCoV-AExY'
      ),
      body    := jsonb_build_object('record', to_jsonb(NEW))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alarm_ringing_push ON alarms;
CREATE TRIGGER alarm_ringing_push
  AFTER UPDATE OF status ON alarms
  FOR EACH ROW
  EXECUTE FUNCTION notify_alarm_push();
