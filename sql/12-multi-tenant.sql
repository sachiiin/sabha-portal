-- 12-multi-tenant.sql
-- Turns this from a single-house deployment into a self-service platform:
-- anyone can register a gharmandir, but it stays invisible and unusable
-- until the platform admin approves it. Every other table was already
-- scoped by mandir_id and my_mandir() (see 04-rls.sql), so that isolation
-- needs nothing new here — this only adds the registration and approval
-- layer on top of it.
--
-- BEFORE RUNNING: nothing extra. AFTER RUNNING, make yourself the platform
-- admin with one statement (replace with your own app_users.id, which is
-- the same as your auth.users id):
--
--   update app_users set platform_admin = true where id = '<your-user-id>';

-- ---------- schema ----------

alter table mandirs add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));
alter table mandirs add column if not exists address text;
alter table mandirs add column if not exists lat double precision;
alter table mandirs add column if not exists lng double precision;
alter table mandirs add column if not exists contact_name text;
alter table mandirs add column if not exists contact_email text;
alter table mandirs add column if not exists reviewed_at timestamptz;

-- Existing rows (the Dasanudas seed) predate the approval flow and are
-- already in use, so they default to 'approved' above. Only mandirs
-- created through register_mandir() from here on start 'pending'.
alter table mandirs alter column status drop default;
alter table mandirs alter column status set default 'pending';

alter table app_users add column if not exists platform_admin boolean not null default false;

comment on column mandirs.status is
  'pending: awaiting the platform admin; approved: in normal use; rejected: registration declined.';
comment on column app_users.platform_admin is
  'Sees and approves every gharmandir''s registration. Unrelated to role, and not scoped by mandir_id.';

-- ---------- helpers ----------

create or replace function is_platform_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select platform_admin from app_users where id = auth.uid()), false)
$$;

-- Whether the signed-in user's own mandir has been approved. Checked
-- separately from role, because a brand-new admin has role = 'admin' on
-- a mandir that is still pending.
create or replace function my_mandir_approved() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select status = 'approved' from mandirs where id = (select mandir_id from app_users where id = auth.uid())),
    false
  )
$$;

-- ---------- registration ----------

-- Called by a freshly signed-up auth user (no app_users row yet) from the
-- public register.html page. Creates the mandir as 'pending', a blank
-- settings row, and links the caller to it as that mandir's first admin.
-- Security definer because the caller has no mandir yet, so none of the
-- ordinary mandir_id = my_mandir() policies would let a plain insert through.
create or replace function register_mandir(
  p_mandir_name text,
  p_ghar_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_admin_name text,
  p_contact_email text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_mandir uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if exists (select 1 from app_users where id = auth.uid()) then
    raise exception 'this account is already linked to a gharmandir';
  end if;

  if p_mandir_name is null or length(trim(p_mandir_name)) = 0 then
    raise exception 'gharmandir name is required';
  end if;
  if p_ghar_name is null or length(trim(p_ghar_name)) = 0 then
    raise exception 'ghar name is required';
  end if;
  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'your name is required';
  end if;

  insert into mandirs (name, ghar_name, address, lat, lng, contact_name, contact_email, status)
  values (trim(p_mandir_name), trim(p_ghar_name), p_address, p_lat, p_lng,
          trim(p_admin_name), p_contact_email, 'pending')
  returning id into v_mandir;

  insert into settings (mandir_id, thursday_anchor)
  values (v_mandir, current_date);

  insert into app_users (id, mandir_id, full_name, role)
  values (auth.uid(), v_mandir, trim(p_admin_name), 'admin');

  return v_mandir;
end $$;

revoke all on function register_mandir(text, text, text, double precision, double precision, text, text) from public;
grant execute on function register_mandir(text, text, text, double precision, double precision, text, text) to authenticated;

-- Platform admin only. Approves or rejects a pending registration.
create or replace function set_mandir_status(p_mandir uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'only the platform admin can do this';
  end if;

  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid status';
  end if;

  update mandirs set status = p_status, reviewed_at = now() where id = p_mandir;
end $$;

revoke all on function set_mandir_status(uuid, text) from public;
grant execute on function set_mandir_status(uuid, text) to authenticated;

-- ---------- RLS ----------

-- Second, independent policy on mandirs (combines with the existing "own
-- mandir" policy via OR) so the platform admin's review page can list
-- every registration regardless of whose mandir it is.
create policy "platform admin sees all mandirs" on mandirs
  for select using (is_platform_admin());

create policy "platform admin updates mandirs" on mandirs
  for update using (is_platform_admin())
  with check (is_platform_admin());

-- Defence in depth: even if the UI redirect in auth.js were bypassed, a
-- pending or rejected mandir's admin still cannot read or write member,
-- sabha or attendance rows through the API directly. Restrictive policies
-- AND with the existing permissive ones, matching the pattern 06-pin-login
-- already uses for viewers.
create policy "approved mandirs only: members" on members
  as restrictive for all using (my_mandir_approved());
create policy "approved mandirs only: sabhas" on sabhas
  as restrictive for all using (my_mandir_approved());
create policy "approved mandirs only: attendance" on attendance
  as restrictive for all using (my_mandir_approved());
