// Authentication and session handling.
//
// Two ways in:
//   Admin / sevak — email and password, full access.
//   House PIN     — anonymous session upgraded to 'viewer' by a Postgres
//                   function that checks the PIN. Read-only: dashboard
//                   and history only.
//
// Every page except login.html and register.html calls requireAuth()
// before rendering.
//
// A third way in, register.html: signs up a brand-new auth user with no
// app_users row at all, carrying what to do once a session exists as
// Supabase user metadata (the `metadata` argument to signUp() below).
// Postgres reads that straight back out of the JWT in
// finish_pending_signup() (sql/21) whenever getProfile() below finds a
// session with no app_users row — including right after confirming an
// email on a completely different device than the one that registered,
// which a sessionStorage-based version of this could never survive.

import { sb, unwrap, loginRedirectUrl } from './supabase.js';
import { finishPendingSignup } from './api/mandirs.js';

let cachedProfile = null;

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  cachedProfile = null;
  return data.user;
}

// Creates the account a brand-new mandir's first admin (or someone
// joining an existing house) signs in with. `metadata` carries what to
// do once a session exists — { kind: 'register', ...fields } or
// { kind: 'join', mandirId, adminName } — for finish_pending_signup() to
// read back out of the JWT later. Returns a null session when the
// Supabase project requires email confirmation.
export async function signUp(email, password, metadata) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: loginRedirectUrl(), ...(metadata ? { data: metadata } : {}) }
  });
  if (error) throw new Error(error.message);
  cachedProfile = null;
  return data;
}

// PIN sign-in. The PIN is never checked in the browser — claim_viewer()
// compares it against a bcrypt hash inside Postgres and only then writes
// the app_users row that makes any data readable. The ghar name says
// which house's PIN this is, now that more than one can exist.
export async function signInWithPin(gharName, pin) {
  const { error: anonError } = await sb.auth.signInAnonymously();
  if (anonError) {
    if (/anonymous.*disabled|signups? not allowed/i.test(anonError.message)) {
      throw new Error(
        'PIN sign-in is not enabled on this project yet. An admin needs to turn on anonymous sign-ins in Supabase.'
      );
    }
    throw new Error(anonError.message);
  }

  const { data, error } = await sb.rpc('claim_viewer', {
    p_ghar_name: gharName.trim(),
    p_pin: pin.trim()
  });

  if (error) {
    // Leave no dangling anonymous account behind a failed attempt — see
    // sql/25-cleanup-anonymous-pin-accounts.sql.
    await cleanupAnonymousAccount();
    await sb.auth.signOut();
    throw new Error(error.message);
  }

  if (data !== true) {
    await cleanupAnonymousAccount();
    await sb.auth.signOut();
    throw new Error('That house name and PIN don’t match.');
  }

  cachedProfile = null;
  return true;
}

// Quietly deletes the caller's own account, but only if it's genuinely
// anonymous (a PIN session) — a no-op for every other account type, so
// this is always safe to call regardless of who's signing out. Without
// it, every PIN session leaves a permanent, unused row in auth.users,
// since actually removing one needs the Supabase admin API (the secret
// key), which this static site never ships to the browser.
async function cleanupAnonymousAccount() {
  try { await sb.rpc('delete_own_anonymous_account'); } catch {}
}

export async function signOut() {
  await cleanupAnonymousAccount();
  await sb.auth.signOut();
  cachedProfile = null;
  window.location.href = 'login.html';
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// Loads the app_users row plus the mandir it belongs to.
export async function getProfile() {
  if (cachedProfile) return cachedProfile;

  const session = await getSession();
  if (!session) return null;

  const { data: row, error } = await sb
    .from('app_users')
    .select('id, full_name, role, platform_admin, nimitt_sevak, mandir_id, status, mandirs(name, ghar_name, status)')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  cachedProfile = {
    id: row.id,
    name: row.full_name,
    role: row.role,
    platformAdmin: row.platform_admin,
    nimittSevak: row.nimitt_sevak,
    mandirId: row.mandir_id,
    mandirName: row.mandirs?.name ?? 'Gharmandir',
    gharName: row.mandirs?.ghar_name ?? '',
    mandirStatus: row.mandirs?.status ?? 'approved',
    status: row.status ?? 'approved'
  };
  return cachedProfile;
}

// Redirects to login if there is no valid session.
// `write: true` additionally sends viewers back to the dashboard.
export async function requireAuth({ write = false } = {}) {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('not authenticated');
  }

  let profile = await getProfile();

  if (!profile) {
    try {
      await finishPendingSignup();
      cachedProfile = null;
      profile = await getProfile();
    } catch {
      // No pending registration/join metadata on this account, or it
      // already finished elsewhere — falls through to the ordinary
      // nolink handling below.
    }
  }

  if (!profile) {
    // Signed in to Supabase Auth but not linked to a mandir. For an
    // anonymous session that means the PIN was never accepted.
    await sb.auth.signOut();
    window.location.href = 'login.html?e=nolink';
    throw new Error('no app_users row for this account');
  }

  // The platform area is a separate shell entirely (see
  // renderPlatformChrome in ui.js) — neither a platform admin nor a
  // nimitt sevak ever sees a mandir's own dashboard, roster or anything
  // else, even if the account also happens to carry a mandir_id from
  // before it had this flag.
  if (profile.platformAdmin || profile.nimittSevak) {
    window.location.href = 'platform-dashboard.html';
    throw new Error('platform account — use the platform dashboard instead');
  }

  // A brand-new mandir from register_mandir() starts 'pending', and stays
  // unusable until the platform admin approves it — this is the UI side
  // of that gate; 12-multi-tenant.sql's restrictive policies are the one
  // that actually matters if this is ever bypassed.
  if (profile.mandirStatus !== 'approved') {
    window.location.href = `login.html?e=${profile.mandirStatus}`;
    throw new Error(`mandir is ${profile.mandirStatus}`);
  }

  // Separate from the house's own approval above — this account joined
  // an already-approved house, but the platform admin hasn't approved
  // this particular person yet (or has blocked them). See
  // sql/18-house-join-requests.sql.
  if (profile.status !== 'approved') {
    window.location.href = `login.html?e=${profile.status === 'blocked' ? 'blocked' : 'join-pending'}`;
    throw new Error(`user is ${profile.status}`);
  }

  if (write && !canWrite(profile)) {
    window.location.href = 'index.html?e=readonly';
    throw new Error('read-only session');
  }

  return profile;
}

// The platform admin pages' own guard, in place of requireAuth() — a
// platform admin has no mandir to redirect "write" or approval checks
// against, so it doesn't share requireAuth()'s logic, just its shape.
// Strictly a full platform admin — Approvals and Team & Users use this,
// so a nimitt sevak bounces off both (back to index.html, which then
// sends them on to platform-dashboard.html via the check above).
export async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('not authenticated');
  }

  const profile = await getProfile();
  if (!profile?.platformAdmin) {
    window.location.href = 'index.html?e=forbidden';
    throw new Error('not a platform admin');
  }

  return profile;
}

// The read-only platform pages' guard — Dashboard, All Houses and a
// single house's detail view — open to a full platform admin OR a
// nimitt sevak alike.
export async function requirePlatformReader() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('not authenticated');
  }

  const profile = await getProfile();
  if (!profile?.platformAdmin && !profile?.nimittSevak) {
    window.location.href = 'index.html?e=forbidden';
    throw new Error('not a platform account');
  }

  return profile;
}

// Used from account.html by anyone signed in — sevak, admin, platform
// admin, or a fellow platform admin's freshly created account setting
// their first real password.
export async function changePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function isPlatformAdmin(profile) {
  return Boolean(profile?.platformAdmin);
}

export function isNimittSevak(profile) {
  return Boolean(profile?.nimittSevak);
}

export function isViewer(profile) {
  return profile?.role === 'viewer';
}

// Sevaks and admins can record attendance; PIN sessions cannot.
export function canWrite(profile) {
  return profile?.role === 'admin' || profile?.role === 'sevak';
}
