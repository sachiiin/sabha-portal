-- 06-pin-login.sql
-- Shared house PIN for read-only access.
--
-- How it works:
--   1. The browser signs in anonymously -> a real Supabase session with a
--      real auth.uid(), but no app_users row, so it can read nothing.
--   2. It calls claim_viewer(pin). That function runs inside Postgres,
--      compares the PIN against a bcrypt hash, and only on a match writes
--      an app_users row with role 'viewer'.
--   3. Every existing RLS policy then works unchanged, because my_mandir()
--      finally resolves. Restrictive policies below stop viewers writing.
--
-- The PIN itself never appears in any file the browser downloads, and the
-- stored value is a hash, so reading the database does not reveal it.
--
-- BEFORE RUNNING: enable anonymous sign-ins in the Supabase dashboard,
-- under Authentication -> Sign In / Providers -> Anonymous sign-ins.

create extension if not exists pgcrypto;

-- ---------- schema ----------

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('sevak', 'admin', 'viewer'));

alter table settings add column if not exists pin_hash text;
alter table settings add column if not exists pin_set_at timestamptz;

comment on column settings.pin_hash is
  'bcrypt hash of the shared house PIN. Null means PIN login is off.';

-- ---------- helpers ----------

create or replace function is_viewer() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role = 'viewer' from app_users where id = auth.uid()), false)
$$;

-- True for a session created by signInAnonymously(). Anonymous users take
-- the same `authenticated` Postgres role as everyone else, so the only way
-- to tell them apart is the is_anonymous claim on the JWT. Older tokens may
-- not carry it, hence the coalesce.
create or replace function is_anon() returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- ---------- PIN verification ----------

-- Called by an anonymous session. On a correct PIN it grants that session
-- the viewer role; otherwise it changes nothing and returns false.
create or replace function claim_viewer(pin text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_mandir uuid;
  v_hash   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- Single-house deployment: one settings row. If this ever serves more
  -- than one mandir, pass the ghar name in and filter on it here.
  select mandir_id, pin_hash into v_mandir, v_hash
  from settings
  where pin_hash is not null
  limit 1;

  if v_hash is null then
    return false;  -- PIN login not enabled
  end if;

  -- Constant work regardless of outcome, so timing says nothing.
  if crypt(pin, v_hash) <> v_hash then
    return false;
  end if;

  insert into app_users (id, mandir_id, full_name, role)
  values (auth.uid(), v_mandir, 'Sevak (PIN)', 'viewer')
  on conflict (id) do update
    set mandir_id = excluded.mandir_id,
        role      = excluded.role;

  return true;
end $$;

revoke all on function claim_viewer(text) from public;
grant execute on function claim_viewer(text) to authenticated;

-- ---------- PIN management (admin only) ----------

create or replace function set_house_pin(new_pin text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_mandir uuid;
begin
  if not is_admin() then
    raise exception 'only an admin can change the PIN';
  end if;

  if new_pin is null or length(trim(new_pin)) < 4 then
    raise exception 'PIN must be at least 4 characters';
  end if;

  if length(trim(new_pin)) > 32 then
    raise exception 'PIN must be 32 characters or fewer';
  end if;

  v_mandir := my_mandir();

  update settings
  set pin_hash   = crypt(trim(new_pin), gen_salt('bf')),
      pin_set_at = now()
  where mandir_id = v_mandir;
end $$;

revoke all on function set_house_pin(text) from public;
grant execute on function set_house_pin(text) to authenticated;

create or replace function clear_house_pin()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only an admin can change the PIN';
  end if;

  update settings
  set pin_hash = null, pin_set_at = null
  where mandir_id = my_mandir();

  -- Everyone currently signed in with the old PIN loses access.
  delete from app_users
  where mandir_id = my_mandir() and role = 'viewer';
end $$;

revoke all on function clear_house_pin() from public;
grant execute on function clear_house_pin() to authenticated;

-- Signs out every PIN session without changing the PIN. Useful when a
-- yuvak leaves the mandal and you want to be sure their phone is cut off
-- without telling everyone else a new number.
create or replace function revoke_pin_sessions()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_admin() then
    raise exception 'only an admin can revoke sessions';
  end if;

  delete from app_users
  where mandir_id = my_mandir() and role = 'viewer';

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function revoke_pin_sessions() from public;
grant execute on function revoke_pin_sessions() to authenticated;

-- ---------- admins can see who is signed in ----------
--
-- The existing policy on app_users is `id = auth.uid()`, so an admin sees
-- only themselves. This adds a second permissive policy (they combine with
-- OR) so the settings page can count active PIN sessions. my_mandir() and
-- is_admin() are security definer, so this does not recurse.

drop policy if exists "admins see their mandir's users" on app_users;
create policy "admins see their mandir's users" on app_users
  for select to authenticated
  using (mandir_id = my_mandir() and is_admin());

-- ---------- viewers are read-only ----------
--
-- Restrictive policies AND with the permissive ones, so these subtract
-- permission without touching what already works. Split per command so
-- SELECT is left alone.
--
-- Two independent conditions, deliberately:
--   not is_viewer()  the role says read-only
--   not is_anon()    the session came in through signInAnonymously()
-- Today every PIN session satisfies both. Keeping both means a wrong role
-- on an anonymous session still cannot write, and a future permanent
-- read-only account is still blocked.

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['members', 'sabhas', 'attendance'] loop
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on %I', 'viewers cannot ' || c || ' ' || t, t);
    end loop;
  end loop;
end $$;

create policy "viewers cannot insert members" on members
  as restrictive for insert to authenticated
  with check (not is_viewer() and not is_anon());
create policy "viewers cannot update members" on members
  as restrictive for update to authenticated
  using (not is_viewer() and not is_anon());
create policy "viewers cannot delete members" on members
  as restrictive for delete to authenticated
  using (not is_viewer() and not is_anon());

create policy "viewers cannot insert sabhas" on sabhas
  as restrictive for insert to authenticated
  with check (not is_viewer() and not is_anon());
create policy "viewers cannot update sabhas" on sabhas
  as restrictive for update to authenticated
  using (not is_viewer() and not is_anon());
create policy "viewers cannot delete sabhas" on sabhas
  as restrictive for delete to authenticated
  using (not is_viewer() and not is_anon());

create policy "viewers cannot insert attendance" on attendance
  as restrictive for insert to authenticated
  with check (not is_viewer() and not is_anon());
create policy "viewers cannot update attendance" on attendance
  as restrictive for update to authenticated
  using (not is_viewer() and not is_anon());
create policy "viewers cannot delete attendance" on attendance
  as restrictive for delete to authenticated
  using (not is_viewer() and not is_anon());

-- Nobody writes settings directly; the functions above are the only path.
drop policy if exists "settings are function-managed" on settings;
drop policy if exists "settings update is function-managed" on settings;
drop policy if exists "settings delete is function-managed" on settings;

create policy "settings are function-managed" on settings
  as restrictive for insert to authenticated with check (false);
create policy "settings update is function-managed" on settings
  as restrictive for update to authenticated using (false);
create policy "settings delete is function-managed" on settings
  as restrictive for delete to authenticated using (false);

-- ---------- hide the hash ----------
--
-- Row-level security decides which ROWS are visible, not which columns, so
-- without this any signed-in session could read pin_hash out of its own
-- settings row. Table-level SELECT covers every column, so it has to go
-- first and come back column by column.
--
-- The functions above are security definer and run as the owner, so they
-- still see pin_hash regardless.

revoke select on settings from anon, authenticated;
grant select (mandir_id, thursday_anchor, sunday_enabled, followup_threshold, pin_set_at)
  on settings to authenticated;

-- Any query asking for settings.* now fails. Name the columns instead —
-- which is what js/api/sabhas.js and js/api/settings.js already do.

-- ---------- housekeeping ----------
--
-- Anonymous auth users accumulate, one per PIN sign-in. Supabase has no
-- automatic cleanup. Run this occasionally, or set it as a scheduled job.
--
--   delete from auth.users
--   where is_anonymous is true and created_at < now() - interval '30 days';
