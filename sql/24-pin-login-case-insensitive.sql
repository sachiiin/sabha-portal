-- 24-pin-login-case-insensitive.sql
-- House names are now always stored in caps (register.html forces it),
-- and the PIN login's own house-name field does the same as of this
-- change — but claim_viewer() still matched ghar_name exactly,
-- case-sensitively. Anything that bypasses that client-side uppercasing
-- (autofill, a saved bookmark from before this, a pasted value) would
-- silently fail to match. Case-insensitive match closes that gap; same
-- reasoning find_registered_mandir() already uses for house names.

create or replace function claim_viewer(p_ghar_name text, p_pin text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_mandir uuid;
  v_hash   text;
  v_rec    record;
  v_found  boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- Walk every approved mandir with this ghar name rather than limit 1,
  -- in case two houses happen to share one — bcrypt cost makes this loop
  -- the expensive part either way, same as before.
  for v_rec in
    select m.id as mandir_id, s.pin_hash
    from mandirs m
    join settings s on s.mandir_id = m.id
    where lower(trim(m.ghar_name)) = lower(trim(coalesce(p_ghar_name, '')))
      and m.status = 'approved'
      and s.pin_hash is not null
  loop
    if crypt(p_pin, v_rec.pin_hash) = v_rec.pin_hash then
      v_mandir := v_rec.mandir_id;
      v_hash := v_rec.pin_hash;
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    return false;
  end if;

  insert into app_users (id, mandir_id, full_name, role)
  values (auth.uid(), v_mandir, 'Sevak (PIN)', 'viewer')
  on conflict (id) do update
    set mandir_id = excluded.mandir_id,
        role      = excluded.role;

  return true;
end $$;

revoke all on function claim_viewer(text, text) from public;
grant execute on function claim_viewer(text, text) to authenticated;
