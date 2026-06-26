import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in client/.env');
}

// Capture the auth-flow type from the URL hash *before* creating the client —
// supabase-js parses and strips the hash on construction (detectSessionInUrl),
// so this is our only chance to tell an invite / password-recovery link
// (which arrive as #...&type=invite|recovery) from an ordinary page load.
function readAuthFlowType(): string | null {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('type');
}
export const initialAuthFlow = readAuthFlowType();

// Browser client: manages the user's session (persisted in localStorage) and
// refreshes the access token automatically.
export const supabase = createClient(url, anonKey);
