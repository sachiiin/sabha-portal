-- 19-structured-address.sql
-- Replaces the free-text Address field (plus Google Places autocomplete)
-- with four real fields: street address, city, province, postal code.
-- Places needed a Maps API key this deployment never actually had
-- configured in its generated js/config.js — register.html's import of
-- GOOGLE_MAPS_KEY from it threw a hard SyntaxError that silently broke
-- the whole registration form. Dropping Places removes that dependency
-- entirely instead of patching around it.

-- ---------- schema ----------

alter table mandirs add column if not exists address_line text;
alter table mandirs add column if not exists city text;
alter table mandirs add column if not exists province text;
alter table mandirs add column if not exists postal_code text;

comment on column mandirs.address_line is 'Street address, e.g. "18 Tamarisk Dr".';
comment on column mandirs.province is 'Two-letter Canadian province/territory code, e.g. ON.';

-- Builds the one-line display address kept in mandirs.address, so every
-- existing read of that column (platform-houses.js, platform-house.js,
-- platform-approvals.js) keeps working unchanged.
create or replace function build_mandir_address(
  p_address_line text, p_city text, p_province text, p_postal_code text
) returns text
language sql immutable
as $$
  select nullif(array_to_string(
    array_remove(array[p_address_line, p_city, p_province, p_postal_code], null), ', '
  ), '')
$$;

-- ---------- register_mandir(): structured fields instead of free text ----------
--
-- Places is gone, so lat/lng have no source left — dropped from this
-- function's signature; the columns themselves stay in the table.

drop function if exists register_mandir(text, text, text, double precision, double precision, text, text);

create or replace function register_mandir(
  p_mandir_name text,
  p_ghar_name text,
  p_address_line text,
  p_city text,
  p_province text,
  p_postal_code text,
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

  insert into mandirs (
    name, ghar_name, address, address_line, city, province, postal_code,
    contact_name, contact_email, status
  )
  values (
    trim(p_mandir_name), trim(p_ghar_name),
    build_mandir_address(p_address_line, p_city, p_province, p_postal_code),
    p_address_line, p_city, p_province, p_postal_code,
    trim(p_admin_name), p_contact_email, 'pending'
  )
  returning id into v_mandir;

  insert into settings (mandir_id, thursday_anchor)
  values (v_mandir, current_date);

  insert into app_users (id, mandir_id, full_name, role)
  values (auth.uid(), v_mandir, trim(p_admin_name), 'admin');

  return v_mandir;
end $$;

revoke all on function register_mandir(text, text, text, text, text, text, text, text) from public;
grant execute on function register_mandir(text, text, text, text, text, text, text, text) to authenticated;

-- ---------- find_registered_mandir(): structured fields, whitespace-insensitive ----------
--
-- Ignores ALL whitespace (not just leading/trailing) in the ghar name
-- and the street address, so "Dasanu Das" still matches "Dasanudas" and
-- "123   Main St" matches "123 Main St". City/province/postal come from
-- dropdowns and a formatted input, so a plain trim+lowercase is enough
-- for those.

drop function if exists find_registered_mandir(text, text);

create or replace function find_registered_mandir(
  p_ghar_name text, p_address_line text, p_city text, p_province text, p_postal_code text
) returns table (id uuid, ghar_name text)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.ghar_name
  from mandirs m
  where m.status = 'approved'
    and lower(regexp_replace(m.ghar_name, '\s+', '', 'g'))
      = lower(regexp_replace(coalesce(p_ghar_name, ''), '\s+', '', 'g'))
    and lower(regexp_replace(coalesce(m.address_line, ''), '\s+', '', 'g'))
      = lower(regexp_replace(coalesce(p_address_line, ''), '\s+', '', 'g'))
    and coalesce(lower(trim(m.city)), '') = coalesce(lower(trim(p_city)), '')
    and coalesce(lower(trim(m.province)), '') = coalesce(lower(trim(p_province)), '')
    and coalesce(lower(trim(m.postal_code)), '') = coalesce(lower(trim(p_postal_code)), '')
  limit 1
$$;

revoke all on function find_registered_mandir(text, text, text, text, text) from public;
grant execute on function find_registered_mandir(text, text, text, text, text) to anon, authenticated;

-- ---------- settings page: let a house's own admin fix its address ----------
--
-- There is still no direct UPDATE policy on mandirs for anyone but the
-- platform admin, on purpose — this is the one narrow, security-definer
-- door through it, scoped to the caller's own house and nothing else on
-- the row (not status, not ghar_name).

create or replace function update_mandir_address(
  p_address_line text, p_city text, p_province text, p_postal_code text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only an admin can change the house address';
  end if;

  update mandirs set
    address_line = p_address_line,
    city = p_city,
    province = p_province,
    postal_code = p_postal_code,
    address = build_mandir_address(p_address_line, p_city, p_province, p_postal_code)
  where id = my_mandir();
end $$;

revoke all on function update_mandir_address(text, text, text, text) from public;
grant execute on function update_mandir_address(text, text, text, text) to authenticated;
