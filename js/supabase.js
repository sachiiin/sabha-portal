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

// Where a confirmation or password-recovery email should send someone
// back to. Supabase falls back to the project's dashboard "Site URL" —
// which defaults to http://localhost:3000 and sends people nowhere useful
// if that's never been changed — so every signUp() call passes this
// explicitly instead of relying on that setting being right.
export function loginRedirectUrl() {
  return new URL('login.html', window.location.href).href;
}
