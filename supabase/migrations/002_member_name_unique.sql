-- Enforce unique member names within each group at the database level.
-- Member names are used as alarm recipient identifiers; allowing two users to
-- share a name in the same group would make alarm routing ambiguous and enable
-- impersonation.  The client already performs a soft check, but this constraint
-- guarantees correctness even under race conditions (concurrent joins).
--
-- Before running, clean up any pre-existing duplicates (keep the oldest row):
--   DELETE FROM group_members gm
--   USING (
--     SELECT group_code, member_name,
--            MIN(ctid) AS keep_ctid
--     FROM   group_members
--     GROUP  BY group_code, member_name
--     HAVING COUNT(*) > 1
--   ) dups
--   WHERE  gm.group_code   = dups.group_code
--     AND  gm.member_name  = dups.member_name
--     AND  gm.ctid        <> dups.keep_ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'group_members_group_code_member_name_key'
  ) THEN
    ALTER TABLE group_members
      ADD CONSTRAINT group_members_group_code_member_name_key
      UNIQUE (group_code, member_name);
  END IF;
END
$$;
