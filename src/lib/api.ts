import { createClient } from '@supabase/supabase-js';

// Anon key only — RLS enforces what this client can touch. Never the
// service role key, that lives server-side in the Edge Functions only.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');

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
