// Utility bills and away periods.

import { sb, unwrap } from '../supabase.js';

/* ---------- bills ---------- */

export async function listBills(mandirId) {
  return unwrap(
    await sb
      .from('utility_bills')
      .select('id, name, period_start, period_end, amount, notes, created_at, charge_id')
      .eq('mandir_id', mandirId)
      .order('period_end', { ascending: false })
      .order('name')
  );
}

/* ---------- monthly charges ---------- */

export async function listCharges(mandirId) {
  return unwrap(
    await sb
      .from('monthly_charges')
      .select('id, charge_month, rent_amount, utilities_amount, total, note, transferred_at, created_at')
      .eq('mandir_id', mandirId)
      .order('charge_month', { ascending: false })
  );
}

// Rent plus every bill not yet collected for, stamped onto those bills
// in one transaction so a double click cannot charge them twice.
export async function createCharge(monthISO, note) {
  const { data, error } = await sb.rpc('create_monthly_charge', {
    p_month: monthISO,
    p_note: note || null
  });
  if (error) throw new Error(error.message);
  return data;
}

// Deleting releases its bills back to uncharged.
export async function deleteCharge(id) {
  const { error } = await sb.from('monthly_charges').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setTransferred(id, done, byUserId) {
  return unwrap(
    await sb
      .from('monthly_charges')
      .update({
        transferred_at: done ? new Date().toISOString() : null,
        transferred_by: done ? byUserId : null
      })
      .eq('id', id)
      .select()
      .single()
  );
}

export async function createBill(mandirId, fields, createdBy) {
  return unwrap(
    await sb
      .from('utility_bills')
      .insert({ mandir_id: mandirId, created_by: createdBy, ...fields })
      .select()
      .single()
  );
}

export async function updateBill(id, fields) {
  return unwrap(
    await sb.from('utility_bills').update(fields).eq('id', id).select().single()
  );
}

export async function deleteBill(id) {
  const { error } = await sb.from('utility_bills').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// The split itself lives in Postgres — one implementation, and the shares
// always add up to the bill exactly.
export async function billSplit(billId) {
  const { data, error } = await sb.rpc('bill_split', { p_bill: billId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ---------- away periods ---------- */

export async function listAbsences(mandirId) {
  return unwrap(
    await sb
      .from('absences')
      .select('id, member_id, start_date, end_date, note, members!inner(full_name, mandir_id)')
      .eq('members.mandir_id', mandirId)
      .order('start_date', { ascending: false })
  );
}

// Away periods covering one date — used by the attendance page.
export async function absencesOn(mandirId, dateISO) {
  return unwrap(
    await sb
      .from('absences')
      .select('member_id, start_date, end_date, note, members!inner(mandir_id)')
      .eq('members.mandir_id', mandirId)
      .lte('start_date', dateISO)
      .gte('end_date', dateISO)
  );
}

export async function createAbsence(fields, createdBy) {
  return unwrap(
    await sb.from('absences').insert({ created_by: createdBy, ...fields }).select().single()
  );
}

export async function updateAbsence(id, fields) {
  return unwrap(
    await sb.from('absences').update(fields).eq('id', id).select().single()
  );
}

export async function deleteAbsence(id) {
  const { error } = await sb.from('absences').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
