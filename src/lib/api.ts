import { createClient } from '@supabase/supabase-js';

// Hardcoded fallback so a missing/misconfigured Vercel env var can NEVER
// crash the app again — this is your real project URL. The anon key below
// is a placeholder: paste your real one in from Supabase dashboard →
// Settings → API → "anon public" key. This is safe to hardcode — anon keys
// are meant to be public, RLS is the actual security boundary, not secrecy
// of this key.
const FALLBACK_SUPABASE_URL = 'https://hifbxgpgnlsrkyvhgboj.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpZmJ4Z3Bnbmxzcmt5dmhnYm9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzg0MzQsImV4cCI6MjA5NzYxNDQzNH0.BgERhU73pXrr--612Q65hUt93-_3ZyEBJIfEArWync8';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FUNCTIONS_URL = SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');

export async function sendEvent(event: {
  user_id: string;
  event_type: string;
  step?: string;
  session_id?: string;
  device_signal?: string;
  raw_metadata?: Record<string, unknown>;
}) {
  const res = await fetch(`${FUNCTIONS_URL}/orchestrator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`orchestrator call failed: ${res.status}`);
  return res.json();
}
