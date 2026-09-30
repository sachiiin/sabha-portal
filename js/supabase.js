// Single shared Supabase client for the whole app.
// Every module imports this one instance — creating more than one causes
// the auth session to get out of sync between them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'gharmandir-auth'
  }
});

// Thin wrapper so callers get a thrown Error instead of a {data, error} pair.
export function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}
