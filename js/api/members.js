// Member CRUD. Reads are open to any signed-in sevak; writes are
// admin-only, enforced by row-level security in Postgres — the UI
// hides the buttons, but the database is what actually stops it.

import { sb, unwrap } from '../supabase.js';

export async function listMembers(mandirId, { includeInactive = false } = {}) {
  let q = sb
    .from('members')
    .select('id, full_name, phone, email, mandal, is_sevak, is_active, joined_date')
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
