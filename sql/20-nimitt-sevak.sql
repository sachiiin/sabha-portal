-- 20-nimitt-sevak.sql
-- A second, narrower platform-level account: Nimitt Sevak sees the
-- Platform Dashboard and All Houses exactly like a full platform admin,
-- but cannot approve/reject a gharmandir's registration and cannot
-- create, move or promote anyone. The write-side RPCs
-- (set_mandir_status, admin_create_user, admin_reassign_user,
-- admin_set_user_status, admin_set_platform_admin) stay gated by
-- is_platform_admin() alone, unchanged — this only widens the read-only
-- policies that power the dashboard and house gallery.

-- ---------- schema ----------

alter table app_users add column if not exists nimitt_sevak boolean not null default false;

alter table app_users drop constraint if exists app_users_one_platform_role;
alter table app_users add constraint app_users_one_platform_role
  check (not (platform_admin and nimitt_sevak));

comment on column app_users.nimitt_sevak is
  'Read-only platform access: Dashboard and All Houses, nothing else. Mutually exclusive with platform_admin.';

-- ---------- helpers ----------

create or replace function is_platform_reader() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select platform_admin or nimitt_sevak from app_users where id = auth.uid()), false)
$$;

-- ---------- widen the read-only policies: is_platform_admin() -> is_platform_reader() ----------

drop policy if exists "platform admin sees all mandirs" on mandirs;
create policy "platform admin sees all mandirs" on mandirs
  for select using (is_platform_reader());

drop policy if exists "platform admin reads members" on members;
create policy "platform admin reads members" on members
  for select using (is_platform_reader());

drop policy if exists "platform admin reads sabhas" on sabhas;
create policy "platform admin reads sabhas" on sabhas
  for select using (is_platform_reader());

drop policy if exists "platform admin reads attendance" on attendance;
create policy "platform admin reads attendance" on attendance
  for select using (is_platform_reader());

drop policy if exists "platform admin reads settings" on settings;
create policy "platform admin reads settings" on settings
  for select using (is_platform_reader());

drop policy if exists "platform admin reads absences" on absences;
create policy "platform admin reads absences" on absences
  for select using (is_platform_reader());

drop policy if exists "approved mandirs only: members" on members;
create policy "approved mandirs only: members" on members
  as restrictive for all using (my_mandir_approved() or is_platform_reader());

drop policy if exists "approved mandirs only: sabhas" on sabhas;
create policy "approved mandirs only: sabhas" on sabhas
  as restrictive for all using (my_mandir_approved() or is_platform_reader());

drop policy if exists "approved mandirs only: attendance" on attendance;
create policy "approved mandirs only: attendance" on attendance
  as restrictive for all using (my_mandir_approved() or is_platform_reader());

drop policy if exists "approved users only: members" on members;
create policy "approved users only: members" on members
  as restrictive for all using (my_user_approved() or is_platform_reader());

drop policy if exists "approved users only: sabhas" on sabhas;
create policy "approved users only: sabhas" on sabhas
  as restrictive for all using (my_user_approved() or is_platform_reader());

drop policy if exists "approved users only: attendance" on attendance;
create policy "approved users only: attendance" on attendance
  as restrictive for all using (my_user_approved() or is_platform_reader());

-- ---------- account creation / promotion: admin-only, nimitt_sevak included as a kind ----------

drop function if exists admin_create_user(uuid, text, uuid, text, boolean);

create or replace function admin_create_user(
  p_user_id uuid,
  p_full_name text,
  p_mandir_id uuid,
  p_role text,
  p_platform_admin boolean default false,
  p_nimitt_sevak boolean default false
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

  if p_platform_admin and p_nimitt_sevak then
    raise exception 'pick one platform role, not both';
  end if;

  if p_platform_admin or p_nimitt_sevak then
    if p_mandir_id is not null or p_role is not null then
      raise exception 'a platform-level account has no house or role';
    end if;
  else
    if p_mandir_id is null or p_role not in ('admin', 'sevak') then
      raise exception 'pick a house and a role of admin or sevak';
    end if;
  end if;

  insert into app_users (id, mandir_id, full_name, role, platform_admin, nimitt_sevak)
  values (p_user_id, p_mandir_id, trim(p_full_name), p_role, p_platform_admin, p_nimitt_sevak);
end $$;

revoke all on function admin_create_user(uuid, text, uuid, text, boolean, boolean) from public;
grant execute on function admin_create_user(uuid, text, uuid, text, boolean, boolean) to authenticated;

-- Promotes or demotes a Nimitt Sevak, same shape as admin_set_platform_admin.
create or replace function admin_set_nimitt_sevak(p_user_id uuid, p_flag boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only a platform admin can do this';
  end if;

  if exists (select 1 from app_users where id = p_user_id and platform_admin) then
    raise exception 'use the platform admin toggle for this account instead';
  end if;

  update app_users set nimitt_sevak = p_flag where id = p_user_id;
end $$;

revoke all on function admin_set_nimitt_sevak(uuid, boolean) from public;
grant execute on function admin_set_nimitt_sevak(uuid, boolean) to authenticated;
