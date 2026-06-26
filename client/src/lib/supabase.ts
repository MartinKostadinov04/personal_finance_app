import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in client/.env');
}

// Browser client: manages the user's session (persisted in localStorage) and
// refreshes the access token automatically.
export const supabase = createClient(url, anonKey);
