import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.__SUPABASE_URL__;
const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase config. Set window.__SUPABASE_URL__ and window.__SUPABASE_ANON_KEY__.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function ensureSession() {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (session) {
    return session;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw error;
  }

  return data.session;
}