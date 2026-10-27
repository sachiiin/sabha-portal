// Gharmandir registration and the platform admin's review of it.

import { sb, unwrap } from '../supabase.js';

// Called from register.html, right after the new admin's account is
// created. Runs as register_mandir() in Postgres, which also creates the
// settings row and links the caller as that mandir's first admin — see
// sql/12-multi-tenant.sql.
export async function registerMandir({
  mandirName, gharName, address, lat, lng, adminName, contactEmail
}) {
  return unwrap(
    await sb.rpc('register_mandir', {
      p_mandir_name: mandirName,
      p_ghar_name: gharName,
      p_address: address ?? null,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_admin_name: adminName,
      p_contact_email: contactEmail ?? null
    })
  );
}

// Platform admin only — RLS on mandirs returns every row for them, every
// other admin's own row only. `status` narrows to one tab; omit it for
// everything.
export async function listMandirs(status) {
  let query = sb
    .from('mandirs')
    .select('id, name, ghar_name, address, contact_name, contact_email, status, created_at, reviewed_at')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  return unwrap(await query);
}

export async function setMandirStatus(id, status) {
  return unwrap(await sb.rpc('set_mandir_status', { p_mandir: id, p_status: status }));
}

// One house, for platform-house.js's header — same columns as
// listMandirs(), just narrowed to a single row by id.
export async function getMandir(id) {
  return unwrap(
    await sb
      .from('mandirs')
      .select('id, name, ghar_name, address, contact_name, contact_email, status, created_at, reviewed_at')
      .eq('id', id)
      .single()
  );
}
