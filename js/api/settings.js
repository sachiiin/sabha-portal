// Settings API. The PIN itself only ever travels to Postgres, which
// stores a bcrypt hash — nothing here can read it back.

import { sb, unwrap } from '../supabase.js';

export async function getHouseSettings(mandirId) {
  return unwrap(
    await sb
      .from('settings')
      .select('thursday_anchor, sunday_enabled, followup_threshold, pin_set_at')
      .eq('mandir_id', mandirId)
      .single()
  );
}

export async function setHousePin(pin) {
  const { error } = await sb.rpc('set_house_pin', { new_pin: pin });
  if (error) throw new Error(error.message);
}

export async function clearHousePin() {
  const { error } = await sb.rpc('clear_house_pin');
  if (error) throw new Error(error.message);
}

// Signs out every PIN session without changing the PIN.
export async function revokePinSessions() {
  const { data, error } = await sb.rpc('revoke_pin_sessions');
  if (error) throw new Error(error.message);
  return data ?? 0;
}

// How many PIN sessions are currently active.
export async function countPinSessions(mandirId) {
  const { count, error } = await sb
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('mandir_id', mandirId)
    .eq('role', 'viewer');
  if (error) throw new Error(error.message);
  return count ?? 0;
}
