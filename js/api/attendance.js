// Attendance marking and history.

import { sb, unwrap } from '../supabase.js';

export async function getForSabha(sabhaId) {
  return unwrap(
    await sb
      .from('attendance')
      .select('id, member_id, status, reason, marked_at')
      .eq('sabha_id', sabhaId)
  );
}

// Upsert on (sabha_id, member_id) — the unique constraint means marking
// the same person twice updates rather than duplicating.
export async function markOne(sabhaId, memberId, status, reason, markedBy) {
  return unwrap(
    await sb
      .from('attendance')
      .upsert(
        {
          sabha_id: sabhaId,
          member_id: memberId,
          status,
          reason: reason || null,
          marked_by: markedBy,
          marked_at: new Date().toISOString()
        },
        { onConflict: 'sabha_id,member_id' }
      )
      .select()
      .single()
  );
}

// Saves the whole roster in one request.
export async function markBulk(sabhaId, entries, markedBy) {
  const rows = entries.map((e) => ({
    sabha_id: sabhaId,
    member_id: e.memberId,
    status: e.status,
    reason: e.reason || null,
    marked_by: markedBy,
    marked_at: new Date().toISOString()
  }));

  return unwrap(
    await sb
      .from('attendance')
      .upsert(rows, { onConflict: 'sabha_id,member_id' })
      .select()
  );
}

export async function clearSabha(sabhaId) {
  const { error } = await sb.from('attendance').delete().eq('sabha_id', sabhaId);
  if (error) throw new Error(error.message);
}

// Full history for one member, newest sabha first.
export async function historyForMember(memberId, limit = 40) {
  return unwrap(
    await sb
      .from('attendance')
      .select('status, reason, sabhas!inner(sabha_date, sabha_type, is_cancelled)')
      .eq('member_id', memberId)
      .eq('sabhas.is_cancelled', false)
      .order('sabha_date', { referencedTable: 'sabhas', ascending: false })
      .limit(limit)
  );
}

// Every attendance row in the mandir, flattened for export and for the
// history page. With a dozen members this is a few hundred rows at most.
export async function fullHistory(mandirId, limit = 2000) {
  return unwrap(
    await sb
      .from('attendance')
      .select(
        'status, reason, members!inner(full_name, mandir_id), sabhas!inner(sabha_date, sabha_type, is_cancelled)'
      )
      .eq('members.mandir_id', mandirId)
      .eq('sabhas.is_cancelled', false)
      .order('sabha_date', { referencedTable: 'sabhas', ascending: false })
      .limit(limit)
  );
}

// Counts present/late per sabha date — feeds the dashboard trend bars.
export async function attendanceTrend(mandirId, lastN = 12) {
  const rows = await fullHistory(mandirId);
  const byDate = new Map();

  for (const r of rows) {
    const d = r.sabhas.sabha_date;
    if (!byDate.has(d)) byDate.set(d, { date: d, type: r.sabhas.sabha_type, present: 0, total: 0 });
    const bucket = byDate.get(d);
    bucket.total += 1;
    if (r.status === 'present' || r.status === 'late') bucket.present += 1;
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-lastN);
}

// Consecutive sabhas attended, counting back from the most recent.
export function currentStreak(memberHistory) {
  let n = 0;
  for (const r of memberHistory) {
    if (r.status === 'present' || r.status === 'late') n++;
    else break;
  }
  return n;
}

// Consecutive sabhas missed — the more useful follow-up signal.
export function missedStreak(memberHistory) {
  let n = 0;
  for (const r of memberHistory) {
    if (r.status === 'absent') n++;
    else break;
  }
  return n;
}
