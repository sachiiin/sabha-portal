-- 18-house-join-requests.sql
-- Lets a second sevak register against a house that already exists,
-- instead of accidentally creating a duplicate gharmandir. register.html
-- checks the name+address the person typed against every approved
-- mandir; a match offers "join this house" instead of "create a new
-- one." Joining still needs the platform admin's approval — not of the
-- house this time (already approved), but of this particular person
-- having access to it — so this adds a second, independent kind of
-- pending state, scoped to app_users instead of mandirs.
--
-- Declining a join request blocks the account rather than deleting it:
-- true deletion needs the Supabase service-role key, which this static
-- site deliberately never ships to the browser (same reason
-- js/api/team.js creates accounts through a throwaway signUp() instead
-- of the admin API). A blocked account can still be un-blocked and
-- handed access to any house afterwards — admin_reassign_user()
-- (14-platform-team.sql) now clears the block as part of doing that,
-- since picking a house for someone and blocking them are opposites.

-- ---------- schema ----------

alter table app_users add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'blocked'));

comment on column app_users.status is
  'approved: normal access. pending: asked to join a house, awaiting the platform admin. blocked: request declined, or access revoked — can still be reassigned to unblock.';

-- ---------- helpers ----------

create or replace function my_user_approved() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select status = 'approved' from app_users where id = auth.uid()), false)
$$;

-- ---------- find-or-join ----------

-- Called from register.html before creating an account, so a second
-- person from a house that already registered gets offered "join this
-- house" instead of silently creating a duplicate mandir. Matches on
-- house name + address rather than mandirs.name — that column has no
-- form field of its own any more (it's always the literal "Gharmandir"),
-- so ghar_name is the only name a person actually types. Anon-callable
-- since this runs before sign-up; only ever returns an approved mandir's
-- id and ghar name — nothing beyond what the person just typed themselves.
create or replace function find_registered_mandir(p_ghar_name text, p_address text)
returns table (id uuid, ghar_name text)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.ghar_name
  from mandirs m
  where m.status = 'approved'
    and lower(trim(m.ghar_name)) = lower(trim(coalesce(p_ghar_name, '')))
    and coalesce(lower(trim(m.address)), '') = coalesce(lower(trim(p_address)), '')
  limit 1
$$;

revoke all on function find_registered_mandir(text, text) from public;
grant execute on function find_registered_mandir(text, text) to anon, authenticated;

-- Called right after signUp(), mirroring register_mandir() but linking to
-- an EXISTING house instead of creating one. Starts 'pending' — this
-- house is already approved, but this particular person joining it isn't
-- until the platform admin says so.
create or replace function join_mandir(p_mandir_id uuid, p_full_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if exists (select 1 from app_users where id = auth.uid()) then
    raise exception 'this account is already linked to a gharmandir';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'your name is required';
  end if;

  if not exists (select 1 from mandirs where id = p_mandir_id and status = 'approved') then
    raise exception 'that gharmandir is not available to join';
  end if;

  insert into app_users (id, mandir_id, full_name, role, status)
  values (auth.uid(), p_mandir_id, trim(p_full_name), 'sevak', 'pending');
end $$;

revoke all on function join_mandir(uuid, text) from public;
grant execute on function join_mandir(uuid, text) to authenticated;

-- ---------- approval ----------

-- Platform admin only. Approves or blocks a join request, or re-blocks
-- someone later, without touching their house or role.
create or replace function admin_set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only a platform admin can do this';
  end if;

  if p_status not in ('pending', 'approved', 'blocked') then
    raise exception 'invalid status';
  end if;

  if exists (select 1 from app_users where id = p_user_id and platform_admin) then
    raise exception 'platform admin accounts have no approval status';
  end if;

  update app_users set status = p_status where id = p_user_id;
end $$;

revoke all on function admin_set_user_status(uuid, text) from public;
grant execute on function admin_set_user_status(uuid, text) to authenticated;

-- Reassigning someone to a house is how "unblock and give access to any
-- other house" works in one move — picking a house for them is itself
-- the un-block. Redefines the function from 14-platform-team.sql; same
-- checks, plus the status reset.
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

  update app_users set mandir_id = p_mandir_id, role = p_role, status = 'approved' where id = p_user_id;
end $$;

revoke all on function admin_reassign_user(uuid, uuid, text) from public;
grant execute on function admin_reassign_user(uuid, uuid, text) to authenticated;

-- ---------- RLS ----------

-- Third restrictive policy per table (ANDs with the two already there
-- from 12-multi-tenant.sql / 15-platform-house-view.sql) — a pending or
-- blocked account's login still exists and can sign in, but reads and
-- writes nothing until a platform admin approves it. Same
-- defence-in-depth pattern as my_mandir_approved(), and the same
-- "or is_platform_admin()" so the platform admin's read-only house view
-- isn't caught by it — their own app_users row stays status='approved'
-- by default either way, but this keeps the pattern consistent and
-- correct if that ever changes.
create policy "approved users only: members" on members
  as restrictive for all using (my_user_approved() or is_platform_admin());
create policy "approved users only: sabhas" on sabhas
  as restrictive for all using (my_user_approved() or is_platform_admin());
create policy "approved users only: attendance" on attendance
  as restrictive for all using (my_user_approved() or is_platform_admin());
