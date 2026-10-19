-- 07-utilities.sql
-- Utility bills split across yuvaks by the days each was actually in the house.
--
-- Three pieces:
--   members.house_start / house_end  when a yuvak lived here
--   absences                         trips, relatives, India — days away
--   utility_bills                    name, period, amount
--
-- The split is pro-rata on person-days. A day someone is away is a day he
-- does not pay for, and the cost of that day lands on whoever was home —
-- so the bill is always covered in full.

-- ---------- residency ----------

alter table members add column if not exists house_start date;
alter table members add column if not exists house_end date;

comment on column members.house_start is
  'First day living in the house. Null means since before records began.';
comment on column members.house_end is
  'Last day living in the house. Null means still here.';

-- Existing rows already carry joined_date; use it as the starting point.
update members set house_start = joined_date
where house_start is null and joined_date is not null;

alter table members drop constraint if exists members_house_dates_check;
alter table members add constraint members_house_dates_check
  check (house_end is null or house_start is null or house_end >= house_start);

-- ---------- away periods ----------

create table if not exists absences (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text not null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz default now(),
  constraint absences_range_check check (end_date >= start_date)
);

create index if not exists idx_absences_member on absences (member_id);
create index if not exists idx_absences_dates on absences (start_date, end_date);

comment on table absences is
  'A yuvak away from the house. Days here are excluded from his utility share and shown on the attendance page.';

-- ---------- bills ----------

create table if not exists utility_bills (
  id uuid primary key default gen_random_uuid(),
  mandir_id uuid not null references mandirs(id) on delete cascade,
  name text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  notes text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz default now(),
  constraint utility_bills_range_check check (period_end >= period_start)
);

create index if not exists idx_bills_mandir on utility_bills (mandir_id, period_end desc);

-- ---------- the split ----------
--
-- Walks the period one day at a time rather than doing interval arithmetic.
-- That is slower on paper but immune to a yuvak having two overlapping away
-- periods, which interval subtraction would double-count. A quarter for a
-- dozen yuvaks is about a thousand rows — nothing.
--
-- Rounding: shares are floored to the cent, then the leftover pennies go
-- one each to the largest fractional parts. The returned shares always sum
-- to the bill exactly.

create or replace function bill_split(p_bill uuid)
returns table (
  member_id    uuid,
  full_name    text,
  days_present int,
  days_away    int,
  share        numeric
)
language sql stable security definer
set search_path = public
as $$
with bill as (
  select b.id, b.mandir_id, b.period_start, b.period_end, b.amount
  from utility_bills b
  where b.id = p_bill
    and b.mandir_id = my_mandir()          -- same row-level scoping as everywhere else
),
days as (
  select generate_series(b.period_start, b.period_end, interval '1 day')::date as d
  from bill b
),
-- Every member-day where the yuvak was living in the house.
resident as (
  select m.id, m.full_name, d.d
  from bill b
  join members m on m.mandir_id = b.mandir_id and m.is_active
  cross join days d
  where (m.house_start is null or d.d >= m.house_start)
    and (m.house_end   is null or d.d <= m.house_end)
),
counted as (
  select
    r.id,
    r.full_name,
    count(*) filter (
      where not exists (
        select 1 from absences a
        where a.member_id = r.id and r.d between a.start_date and a.end_date
      )
    )::int as present,
    count(*) filter (
      where exists (
        select 1 from absences a
        where a.member_id = r.id and r.d between a.start_date and a.end_date
      )
    )::int as away
  from resident r
  group by r.id, r.full_name
),
total as (select nullif(sum(present), 0) as person_days from counted),
exact as (
  select
    c.*,
    case when t.person_days is null then 0
         else (select amount from bill) * c.present / t.person_days
    end as raw_share
  from counted c cross join total t
),
floored as (
  select e.*,
    floor(e.raw_share * 100) / 100                        as base_share,
    (e.raw_share * 100) - floor(e.raw_share * 100)        as frac
  from exact e
),
ranked as (
  select f.*, row_number() over (order by f.frac desc, f.full_name) as rn
  from floored f
),
leftover as (
  -- With nobody home for the whole period every share is zero, and there is
  -- no one to hand the rounding pennies to. Without this guard the whole
  -- bill would be dealt out a cent at a time.
  select case
           when (select person_days from total) is null then 0
           else round(((select amount from bill) - sum(base_share)) * 100)::int
         end as pennies
  from floored
)
select
  r.id,
  r.full_name,
  r.present,
  r.away,
  round(
    r.base_share + case when r.rn <= (select pennies from leftover) then 0.01 else 0 end,
    2
  )
from ranked r
order by r.full_name;
$$;

revoke all on function bill_split(uuid) from public;
grant execute on function bill_split(uuid) to authenticated;

-- ---------- row-level security ----------

alter table absences enable row level security;
alter table utility_bills enable row level security;

drop policy if exists "read absences" on absences;
create policy "read absences" on absences
  for select to authenticated
  using (exists (
    select 1 from members m
    where m.id = absences.member_id and m.mandir_id = my_mandir()));

drop policy if exists "admins write absences" on absences;
create policy "admins write absences" on absences
  for all to authenticated
  using (is_admin() and exists (
    select 1 from members m
    where m.id = absences.member_id and m.mandir_id = my_mandir()))
  with check (is_admin() and exists (
    select 1 from members m
    where m.id = absences.member_id and m.mandir_id = my_mandir()));

drop policy if exists "read bills" on utility_bills;
create policy "read bills" on utility_bills
  for select to authenticated
  using (mandir_id = my_mandir() and is_admin());

drop policy if exists "admins write bills" on utility_bills;
create policy "admins write bills" on utility_bills
  for all to authenticated
  using (mandir_id = my_mandir() and is_admin())
  with check (mandir_id = my_mandir() and is_admin());

-- Bills are admin-only, so the anonymous and viewer blocks from 06 are
-- already covered by is_admin() above. Absences are readable by sevaks
-- because the attendance page shows the note; only admins can write them.

drop policy if exists "viewers cannot insert absences" on absences;
drop policy if exists "viewers cannot update absences" on absences;
drop policy if exists "viewers cannot delete absences" on absences;

create policy "viewers cannot insert absences" on absences
  as restrictive for insert to authenticated
  with check (not is_viewer() and not is_anon());
create policy "viewers cannot update absences" on absences
  as restrictive for update to authenticated
  using (not is_viewer() and not is_anon());
create policy "viewers cannot delete absences" on absences
  as restrictive for delete to authenticated
  using (not is_viewer() and not is_anon());
