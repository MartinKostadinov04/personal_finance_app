import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for privileged server-side operations
// (inviting users, generating signed Storage URLs). Lazily constructed so
// scripts that don't need it don't require the service-role key to be present.
let admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}
