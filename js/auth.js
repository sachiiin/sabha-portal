// Authentication and session handling.
//
// Two ways in:
//   Admin / sevak — email and password, full access.
//   House PIN     — anonymous session upgraded to 'viewer' by a Postgres
//                   function that checks the PIN. Read-only: dashboard
//                   and history only.
//
// Every page except login.html calls requireAuth() before rendering.

import { sb, unwrap } from './supabase.js';

let cachedProfile = null;

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  cachedProfile = null;
  return data.user;
}

// PIN sign-in. The PIN is never checked in the browser — claim_viewer()
// compares it against a bcrypt hash inside Postgres and only then writes
// the app_users row that makes any data readable.
export async function signInWithPin(pin) {
  const { error: anonError } = await sb.auth.signInAnonymously();
  if (anonError) {
    if (/anonymous.*disabled|signups? not allowed/i.test(anonError.message)) {
      throw new Error(
        'PIN sign-in is not enabled on this project yet. An admin needs to turn on anonymous sign-ins in Supabase.'
      );
    }
    throw new Error(anonError.message);
  }

  const { data, error } = await sb.rpc('claim_viewer', { pin: pin.trim() });

  if (error) {
    await sb.auth.signOut();
    throw new Error(error.message);
  }

  if (data !== true) {
    // Leave no dangling anonymous session behind a wrong guess.
    await sb.auth.signOut();
    throw new Error('That PIN is not right.');
  }

  cachedProfile = null;
  return true;
}

export async function signOut() {
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
    .select('id, full_name, role, mandir_id, mandirs(name, ghar_name)')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  cachedProfile = {
    id: row.id,
    name: row.full_name,
    role: row.role,
    mandirId: row.mandir_id,
    mandirName: row.mandirs?.name ?? 'Gharmandir',
    gharName: row.mandirs?.ghar_name ?? ''
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

  const profile = await getProfile();
  if (!profile) {
    // Signed in to Supabase Auth but not linked to a mandir. For an
    // anonymous session that means the PIN was never accepted.
    await sb.auth.signOut();
    window.location.href = 'login.html?e=nolink';
    throw new Error('no app_users row for this account');
  }

  if (write && !canWrite(profile)) {
    window.location.href = 'index.html?e=readonly';
    throw new Error('read-only session');
  }

  return profile;
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function isViewer(profile) {
  return profile?.role === 'viewer';
}

// Sevaks and admins can record attendance; PIN sessions cannot.
export function canWrite(profile) {
  return profile?.role === 'admin' || profile?.role === 'sevak';
}
