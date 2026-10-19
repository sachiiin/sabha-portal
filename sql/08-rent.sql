-- 08-rent.sql
-- Monthly transfer to the owner: fixed rent plus the three utility bills.
--
-- The rent sits in settings rather than in the page so it can change
-- without a code edit. 06-pin-login.sql revoked table-level SELECT on
-- settings and granted it back column by column, so a new column needs
-- its own grant or every settings read starts failing.

alter table settings
  add column if not exists monthly_rent numeric(12, 2) not null default 3800;

comment on column settings.monthly_rent is
  'Fixed monthly rent owed to the owner, before utilities.';

grant select (monthly_rent) on settings to authenticated;

-- Settings rows are function-managed (see 06), so this is the way in.
create or replace function set_monthly_rent(amount numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only an admin can change the rent';
  end if;

  if amount is null or amount < 0 then
    raise exception 'rent cannot be negative';
  end if;

  update settings set monthly_rent = round(amount, 2)
  where mandir_id = my_mandir();
end $$;

revoke all on function set_monthly_rent(numeric) from public;
grant execute on function set_monthly_rent(numeric) to authenticated;
