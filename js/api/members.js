// Member CRUD. Reads are open to any signed-in sevak; writes are
// admin-only, enforced by row-level security in Postgres — the UI
// hides the buttons, but the database is what actually stops it.

import { sb, unwrap } from '../supabase.js';
import { today } from '../lib/dates.js';

// This house's own mandal structure — see sql/17-mandal-options.sql for
// the matching database constraint. Values are stored as these slugs;
// MANDAL_LABEL is how each one is actually written, since "to-be-ambrish"
// capitalized by CSS would read as "To-be-ambrish", not "To-be Ambrish".
export const MANDALS = ['yuvak', 'ambrish', 'to-be-ambrish'];
export const MANDAL_LABEL = { yuvak: 'Yuvak', ambrish: 'Ambrish', 'to-be-ambrish': 'To-be Ambrish' };

// Was this yuvak living in the house on a given date?
// Used by the attendance page against the sabha's own date, and by the
// dashboard and history against today.
export function livedHereOn(m, iso) {
  if (m.house_start && iso < m.house_start) return false;
  if (m.house_end && iso > m.house_end) return false;
  return true;
}

// Still living here now. A yuvak whose "Until" date has passed is a
// previous member and drops off the dashboard and history.
export function isCurrent(m) {
  return livedHereOn(m, today());
}

export async function listMembers(mandirId, { includeInactive = false } = {}) {
  let q = sb
    .from('members')
    .select('id, full_name, phone, email, mandal, is_sevak, is_active, joined_date, house_start, house_end')
    .eq('mandir_id', mandirId)
    .order('full_name');

  if (!includeInactive) q = q.eq('is_active', true);
  return unwrap(await q);
}

export async function listStats(mandirId) {
  return unwrap(
    await sb
      .from('member_stats')
      .select('*')
      .eq('mandir_id', mandirId)
      .order('pct', { ascending: false })
  );
}

export async function getMember(id) {
  return unwrap(await sb.from('members').select('*').eq('id', id).single());
}

export async function createMember(mandirId, fields) {
  return unwrap(
    await sb
      .from('members')
      .insert({ mandir_id: mandirId, ...fields })
      .select()
      .single()
  );
}

export async function updateMember(id, fields) {
  return unwrap(
    await sb.from('members').update(fields).eq('id', id).select().single()
  );
}

// Soft delete. Attendance history stays intact, the member drops off
// future rosters. Hard deletion would cascade and erase their record.
export async function deactivateMember(id) {
  return updateMember(id, { is_active: false });
}

export async function reactivateMember(id) {
  return updateMember(id, { is_active: true });
}
