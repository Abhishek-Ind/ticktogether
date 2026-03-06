-- Run this in the Supabase SQL editor (Database → SQL Editor)
-- Creates the push_subscriptions table used by the alarm-push Edge Function.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_code    text        NOT NULL REFERENCES groups(code) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name   text        NOT NULL,
  subscription  jsonb       NOT NULL,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (group_code, user_id)
);

-- Allow authenticated users to manage their own subscription rows
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own push subscriptions"
  ON push_subscriptions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
