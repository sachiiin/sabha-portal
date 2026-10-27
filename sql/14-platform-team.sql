-- 14-platform-team.sql
-- Lets the platform admin manage people directly: add more platform
-- admins, create a sevak/admin login for any house without that house
-- needing to self-register one, and move someone to a different house
-- or role when they move.
--
-- Account creation can't use the Supabase admin API from here — that
-- needs the secret key, which this static site never ships to the
-- browser. js/api/team.js instead opens a second, unpersisted Supabase
-- client that only ever calls plain signUp() and is discarded; these
-- functions are what links the account it creates to a house afterwards.

-- ---------- schema ----------

-- A platform-only account (mandir_id null) has no role in the usual
-- sense, so this can no longer be NOT NULL — and the two should always be
-- null, or set, together.
alter table app_users alter column role drop not null;
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role is null or role in ('sevak', 'admin', 'viewer'));

alter table app_users drop constraint if exists app_users_mandir_role_pair;
alter table app_users add constraint app_users_mandir_role_pair
  check ((mandir_id is null) = (role is null));

-- ---------- RLS ----------

-- Second, independent policy (combines with "own row" via OR) so the
-- team page can list every account, not just the signed-in platform
-- admin's own. Mirrors "platform admin sees all mandirs" in
-- 12-multi-tenant.sql — account metadata only, same boundary as
-- everywhere else: this still grants nothing on members, sabhas or
-- attendance.
create policy "platform admin sees all users" on app_users
  for select using (is_platform_admin());

create policy "platform admin updates users" on app_users
  for update using (is_platform_admin())
  with check (is_platform_admin());

-- ---------- functions ----------

-- Links an auth user that already exists (created moments earlier by a
-- throwaway signUp() in the browser) to a house and role, or marks them a
-- fellow platform admin with neither.
create or replace function admin_create_user(
  p_user_id uuid,
  p_full_name text,
  p_mandir_id uuid,
  p_role text,
  p_platform_admin boolean default false
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only a platform admin can do this';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'name is required';
  end if;

  if exists (select 1 from app_users where id = p_user_id) then
    raise exception 'that account is already linked to a gharmandir';
  end if;

  if p_platform_admin then
    if p_mandir_id is not null or p_role is not null then
      raise exception 'a platform admin account has no house or role';
    end if;
  else
    if p_mandir_id is null or p_role not in ('admin', 'sevak') then
      raise exception 'pick a house and a role of admin or sevak';
    end if;
  end if;

  insert into app_users (id, mandir_id, full_name, role, platform_admin)
  values (p_user_id, p_mandir_id, trim(p_full_name), p_role, p_platform_admin);
end $$;

revoke all on function admin_create_user(uuid, text, uuid, text, boolean) from public;
grant execute on function admin_create_user(uuid, text, uuid, text, boolean) to authenticated;

-- Moves an existing sevak/admin to a different house and/or role — "when
-- they move." Deliberately cannot touch a platform-admin row;
-- admin_set_platform_admin is the function for that one.
create or replace function admin_reassign_user(p_user_id uuid, p_mandir_id uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only a platform admin can do this';
  end if;

  if p_mandir_id is null or p_role not in ('admin', 'sevak') then
    raise exception 'pick a house and a role of admin or sevak';
  end if;

  if exists (select 1 from app_users where id = p_user_id and platform_admin) then
    raise exception 'use the platform admin toggle for this account instead';
  end if;

  update app_users set mandir_id = p_mandir_id, role = p_role where id = p_user_id;
end $$;

revoke all on function admin_reassign_user(uuid, uuid, text) from public;
grant execute on function admin_reassign_user(uuid, uuid, text) to authenticated;

-- Promotes or demotes a fellow platform admin. Refuses to remove your own
-- access so one mistaken click can't lock you out of the team page.
create or replace function admin_set_platform_admin(p_user_id uuid, p_flag boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only a platform admin can do this';
  end if;

  if p_user_id = auth.uid() and not p_flag then
    raise exception 'you cannot remove your own platform admin access';
  end if;

  -- Deliberate: a platform-only account that loses this flag and had no
  -- house ends up with no access at all, same as disabling anyone else's
  -- account — not a state that needs a house found for it first.
  update app_users set platform_admin = p_flag where id = p_user_id;
end $$;

revoke all on function admin_set_platform_admin(uuid, boolean) from public;
grant execute on function admin_set_platform_admin(uuid, boolean) to authenticated;
