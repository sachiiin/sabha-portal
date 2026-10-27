-- 13-pin-login-multi-tenant.sql
-- claim_viewer() originally picked "the one settings row with a PIN set",
-- which only ever worked because exactly one mandir existed. Now that
-- register_mandir() (12-multi-tenant.sql) lets any number of houses sign
-- up, PIN sign-in needs to know WHICH house's PIN is being typed — this
-- was flagged as a TODO in 06-pin-login.sql's own comments.
--
-- The login form now asks for the ghar name alongside the PIN (see
-- login.html). ghar_name has no uniqueness constraint, so this checks the
-- PIN against every approved mandir with that name rather than assuming
-- there is only one.

drop function if exists claim_viewer(text);

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
    where m.ghar_name = p_ghar_name
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
