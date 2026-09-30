// Authentication and session handling.
//
// Every page except login.html calls requireAuth() before rendering.
// It resolves to the signed-in user's app_users row, which carries
// mandir_id and role — both needed by nearly every query.

import { sb, unwrap } from './supabase.js';

let cachedProfile = null;

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  cachedProfile = null;
  return data.user;
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

  const row = unwrap(
    await sb
      .from('app_users')
      .select('id, full_name, role, mandir_id, mandirs(name, ghar_name)')
      .eq('id', session.user.id)
      .single()
  );

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
// Returns the profile so the caller can use it straight away.
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('not authenticated');
  }

  const profile = await getProfile();
  if (!profile) {
    // Signed in to Supabase Auth but no app_users row linked.
    await sb.auth.signOut();
    window.location.href = 'login.html?e=nolink';
    throw new Error('no app_users row for this account');
  }
  return profile;
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}
