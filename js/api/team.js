// Platform admin: creating accounts for any house, moving people between
// houses, and managing who else is a platform admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { sb, unwrap, accountRedirectUrl } from '../supabase.js';

// Creates the Supabase Auth account itself, through a second, throwaway
// client that is never persisted to storage. The ordinary signUp() on the
// shared client signs the CURRENT browser into whatever account it just
// created — fine for someone registering themselves, but it would sign
// the platform admin out of their own session the moment they created
// someone else's login. This client is discarded right after.
//
// Redirects to account.html rather than login.html once confirmed —
// this person never picked their own password, the admin creating the
// account did, so the next thing they see is "set your own password."
async function createAuthAccount(email, password) {
  const temp = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await temp.auth.signUp({
    email, password,
    options: { emailRedirectTo: accountRedirectUrl() }
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Could not create that account.');
  return data.user.id;
}

// mandirId/role are omitted for a platform-level account (platformAdmin
// or nimittSevak).
export async function createUser({
  email, password, fullName, mandirId, role, platformAdmin = false, nimittSevak = false
}) {
  const userId = await createAuthAccount(email, password);
  return unwrap(
    await sb.rpc('admin_create_user', {
      p_user_id: userId,
      p_full_name: fullName,
      p_mandir_id: mandirId ?? null,
      p_role: role ?? null,
      p_platform_admin: platformAdmin,
      p_nimitt_sevak: nimittSevak
    })
  );
}

// Every account on the platform — RLS on app_users grants this to a
// platform admin alone (not a nimitt sevak — they have no reason to see
// the team list, only Dashboard and All Houses). Account metadata only:
// name, role, which house, never that house's members, sabhas or
// attendance.
export async function listAllUsers() {
  return unwrap(
    await sb
      .from('app_users')
      .select('id, full_name, role, platform_admin, nimitt_sevak, mandir_id, status, mandirs(ghar_name), created_at')
      .order('created_at', { ascending: false })
  );
}

export async function reassignUser(userId, mandirId, role) {
  return unwrap(
    await sb.rpc('admin_reassign_user', { p_user_id: userId, p_mandir_id: mandirId, p_role: role })
  );
}

// Approves or blocks a join request, or re-blocks someone later, without
// touching their house or role. Reassigning (above) is how a blocked
// account gets un-blocked — picking a house for them is itself the
// un-block, see sql/18-house-join-requests.sql.
export async function setUserStatus(userId, status) {
  return unwrap(await sb.rpc('admin_set_user_status', { p_user_id: userId, p_status: status }));
}

export async function setPlatformAdmin(userId, flag) {
  return unwrap(await sb.rpc('admin_set_platform_admin', { p_user_id: userId, p_flag: flag }));
}

export async function setNimittSevak(userId, flag) {
  return unwrap(await sb.rpc('admin_set_nimitt_sevak', { p_user_id: userId, p_flag: flag }));
}

// Every house's active admin(s), with their real sign-in email — reads
// auth.users via a security-definer function, since app_users has no
// email column of its own. Platform admin or nimitt sevak only; used by
// Approvals and All Houses to show who actually runs each house instead
// of the one contact captured at registration time.
export async function listHouseAdmins() {
  return unwrap(await sb.rpc('platform_list_house_admins'));
}
