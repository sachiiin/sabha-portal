-- 09-monthly-charges.sql
-- Rent is collected in advance, so a month's charge is not "the bills
-- dated in that month" — it is rent plus whatever bills have arrived
-- since the last time money was collected.
--
-- That means a charge CONSUMES the bills it covers. Without that, the
-- water bill, which comes once every four months, would be counted again
-- every month until the next one arrived.

create table if not exists monthly_charges (
  id uuid primary key default gen_random_uuid(),
  mandir_id uuid not null references mandirs(id) on delete cascade,
  charge_month date not null,                    -- always the 1st
  rent_amount numeric(12, 2) not null,
  utilities_amount numeric(12, 2) not null,
  total numeric(12, 2) not null,
  note text,
  -- Null until the money actually goes to the owner.
  transferred_at timestamptz,
  transferred_by uuid references app_users(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz default now(),
  unique (mandir_id, charge_month)
);

-- Safe to re-run against a table created before the checkbox existed.
alter table monthly_charges add column if not exists transferred_at timestamptz;
alter table monthly_charges add column if not exists transferred_by uuid
  references app_users(id) on delete set null;

create index if not exists idx_charges_mandir
  on monthly_charges (mandir_id, charge_month desc);

-- Null means the bill has not been collected for yet.
alter table utility_bills
  add column if not exists charge_id uuid references monthly_charges(id) on delete set null;

create index if not exists idx_bills_charge on utility_bills (charge_id);

comment on column utility_bills.charge_id is
  'The month this bill was collected in. Null means still waiting to be charged.';

-- ---------- create a charge ----------
--
-- One function doing both the insert and the stamping, so a double click
-- cannot produce two charges over the same bills.

create or replace function create_monthly_charge(p_month date, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_mandir uuid;
  v_rent   numeric(12, 2);
  v_util   numeric(12, 2);
  v_id     uuid;
  v_first  date;
begin
  if not is_admin() then
    raise exception 'only an admin can record a charge';
  end if;

  v_mandir := my_mandir();
  v_first  := date_trunc('month', p_month)::date;

  select monthly_rent into v_rent from settings where mandir_id = v_mandir;
  if v_rent is null then
    raise exception 'no rent set for this house';
  end if;

  select coalesce(sum(amount), 0) into v_util
  from utility_bills
  where mandir_id = v_mandir and charge_id is null;

  insert into monthly_charges
    (mandir_id, charge_month, rent_amount, utilities_amount, total, note, created_by)
  values
    (v_mandir, v_first, v_rent, v_util, v_rent + v_util, p_note, auth.uid())
  returning id into v_id;

  -- Claim exactly the bills that were counted.
  update utility_bills
  set charge_id = v_id
  where mandir_id = v_mandir and charge_id is null;

  return v_id;
end $$;

revoke all on function create_monthly_charge(date, text) from public;
grant execute on function create_monthly_charge(date, text) to authenticated;

-- ---------- row-level security ----------

alter table monthly_charges enable row level security;

drop policy if exists "read charges" on monthly_charges;
create policy "read charges" on monthly_charges
  for select to authenticated
  using (mandir_id = my_mandir() and is_admin());

drop policy if exists "admins write charges" on monthly_charges;
create policy "admins write charges" on monthly_charges
  for all to authenticated
  using (mandir_id = my_mandir() and is_admin())
  with check (mandir_id = my_mandir() and is_admin());

-- Deleting a charge sets its bills' charge_id back to null, so they
-- become uncharged again and the next count picks them up. Undoing a
-- mistake costs nothing.
