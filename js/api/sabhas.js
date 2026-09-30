// Sabha records — one row per actual gathering.

import { sb, unwrap } from '../supabase.js';
import { sabhaType } from '../lib/schedule.js';

export async function getSettings(mandirId) {
  return unwrap(
    await sb
      .from('settings')
      .select('thursday_anchor, sunday_enabled, followup_threshold')
      .eq('mandir_id', mandirId)
      .single()
  );
}

export async function getSabhaByDate(mandirId, dateISO) {
  const { data, error } = await sb
    .from('sabhas')
    .select('*')
    .eq('mandir_id', mandirId)
    .eq('sabha_date', dateISO)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data; // null if that sabha hasn't been created yet
}

// Returns the existing sabha row for a date, creating it if this is the
// first time anyone has opened that date. The unique constraint on
// (mandir_id, sabha_date) makes the upsert safe if two sevaks open the
// same date at once.
//
// `type` and `movedFrom` are supplied when recording a sabha held off its
// normal day — a Thursday sabha moved to Saturday passes type 'thursday'
// so it still counts toward the Thursday rate.
export async function getOrCreateSabha(mandirId, dateISO, { type, movedFrom } = {}) {
  const existing = await getSabhaByDate(mandirId, dateISO);
  if (existing) return existing;

  return unwrap(
    await sb
      .from('sabhas')
      .upsert(
        {
          mandir_id: mandirId,
          sabha_date: dateISO,
          sabha_type: type ?? sabhaType(dateISO),
          moved_from: movedFrom ?? null
        },
        { onConflict: 'mandir_id,sabha_date' }
      )
      .select()
      .single()
  );
}

export async function listSabhas(mandirId, { limit = 50 } = {}) {
  return unwrap(
    await sb
      .from('sabhas')
      .select('id, sabha_date, sabha_type, topic, notes, is_cancelled, moved_from')
      .eq('mandir_id', mandirId)
      .order('sabha_date', { ascending: false })
      .limit(limit)
  );
}

export async function updateSabha(id, fields) {
  return unwrap(
    await sb.from('sabhas').update(fields).eq('id', id).select().single()
  );
}

export async function cancelSabha(id, reason) {
  return updateSabha(id, { is_cancelled: true, notes: reason });
}