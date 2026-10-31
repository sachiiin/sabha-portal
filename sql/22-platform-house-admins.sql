-- 22-platform-house-admins.sql
-- Approvals' house list and All Houses' card view both showed only the
-- one contact captured at registration time
-- (mandirs.contact_name/contact_email) — stale the moment a second admin
-- is added, or the original one moves on. This adds a security-definer
-- function that lists every currently-approved admin account per house,
-- including their real sign-in email — something app_users has no
-- column for at all, since email only ever lives in auth.users, which
-- the client can't read directly.
--
-- Gated by is_platform_reader() (platform admin OR nimitt sevak), not
-- is_platform_admin() alone: both can already see a house's
-- contact_name/contact_email on these same two pages, so this isn't a
-- new category of exposure, just a more accurate source for it.

create or replace function platform_list_house_admins()
returns table (mandir_id uuid, full_name text, email text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not is_platform_reader() then
    raise exception 'only a platform admin or nimitt sevak can do this';
  end if;

  return query
    select au.mandir_id, au.full_name, u.email::text
    from app_users au
    join auth.users u on u.id = au.id
    where au.role = 'admin'
      and au.mandir_id is not null
      and au.status = 'approved'
    order by au.full_name;
end $$;

revoke all on function platform_list_house_admins() from public;
grant execute on function platform_list_house_admins() to authenticated;
