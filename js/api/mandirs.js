// Gharmandir registration and the platform admin's review of it.

import { sb, unwrap } from '../supabase.js';

// Called from register.html, right after the new admin's account is
// created. Runs as register_mandir() in Postgres, which also creates the
// settings row and links the caller as that mandir's first admin — see
// sql/12-multi-tenant.sql and sql/19-structured-address.sql.
export async function registerMandir({
  mandirName, gharName, addressLine, city, province, postalCode, adminName, contactEmail
}) {
  return unwrap(
    await sb.rpc('register_mandir', {
      p_mandir_name: mandirName,
      p_ghar_name: gharName,
      p_address_line: addressLine ?? null,
      p_city: city ?? null,
      p_province: province ?? null,
      p_postal_code: postalCode ?? null,
      p_admin_name: adminName,
      p_contact_email: contactEmail ?? null
    })
  );
}

// Called from register.html as soon as someone types a house name and
// address, so a second person from a house that already registered gets
// offered "join this house" instead of silently creating a duplicate
// mandir. Returns null when nothing matches.
export async function findRegisteredMandir(gharName, { addressLine, city, province, postalCode }) {
  const rows = await unwrap(
    await sb.rpc('find_registered_mandir', {
      p_ghar_name: gharName,
      p_address_line: addressLine ?? null,
      p_city: city ?? null,
      p_province: province ?? null,
      p_postal_code: postalCode ?? null
    })
  );
  return rows?.[0] ?? null;
}

// Called from settings.html by a house's own admin — the one way
// anyone but the platform admin can change a mandir row at all, and
// narrowly scoped to just these four columns.
export async function updateMandirAddress({ addressLine, city, province, postalCode }) {
  return unwrap(
    await sb.rpc('update_mandir_address', {
      p_address_line: addressLine ?? null,
      p_city: city ?? null,
      p_province: province ?? null,
      p_postal_code: postalCode ?? null
    })
  );
}

// Called right after signUp(), mirroring registerMandir() above but
// linking to an EXISTING, already-approved house instead of creating one.
// Starts the account 'pending' — the platform admin still has to approve
// this particular person joining, even though the house itself is fine.
export async function joinMandir(mandirId, fullName) {
  return unwrap(await sb.rpc('join_mandir', { p_mandir_id: mandirId, p_full_name: fullName }));
}

// Platform admin only — RLS on mandirs returns every row for them, every
// other admin's own row only. `status` narrows to one tab; omit it for
// everything.
export async function listMandirs(status) {
  let query = sb
    .from('mandirs')
    .select('id, name, ghar_name, address, address_line, city, province, postal_code, contact_name, contact_email, status, created_at, reviewed_at')
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
      .select('id, name, ghar_name, address, address_line, city, province, postal_code, contact_name, contact_email, status, created_at, reviewed_at')
      .eq('id', id)
      .single()
  );
}
