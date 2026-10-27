// Platform admin: creating accounts for any house, moving people between
// houses, and managing who else is a platform admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { sb, unwrap } from '../supabase.js';

// Creates the Supabase Auth account itself, through a second, throwaway
// client that is never persisted to storage. The ordinary signUp() on the
// shared client signs the CURRENT browser into whatever account it just
// created — fine for someone registering themselves, but it would sign
// the platform admin out of their own session the moment they created
// someone else's login. This client is discarded right after.
async function createAuthAccount(email, password) {
  const temp = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await temp.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Could not create that account.');
  return data.user.id;
}

// mandirId/role are omitted for a fellow platform admin account.
export async function createUser({ email, password, fullName, mandirId, role, platformAdmin = false }) {
  const userId = await createAuthAccount(email, password);
  return unwrap(
    await sb.rpc('admin_create_user', {
      p_user_id: userId,
      p_full_name: fullName,
      p_mandir_id: mandirId ?? null,
      p_role: role ?? null,
      p_platform_admin: platformAdmin
    })
  );
}

// Every account on the platform — RLS on app_users grants this to a
// platform admin alone. Account metadata only: name, role, which house,
// never that house's members, sabhas or attendance.
export async function listAllUsers() {
  return unwrap(
    await sb
      .from('app_users')
      .select('id, full_name, role, platform_admin, mandir_id, mandirs(ghar_name), created_at')
      .order('created_at', { ascending: false })
  );
}

export async function reassignUser(userId, mandirId, role) {
  return unwrap(
    await sb.rpc('admin_reassign_user', { p_user_id: userId, p_mandir_id: mandirId, p_role: role })
  );
}

export async function setPlatformAdmin(userId, flag) {
  return unwrap(await sb.rpc('admin_set_platform_admin', { p_user_id: userId, p_flag: flag }));
}
