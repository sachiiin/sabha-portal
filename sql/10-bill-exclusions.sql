-- 10-bill-exclusions.sql
-- Leave a yuvak out of one bill's split.
--
-- Away periods already handle "he was not here for part of this period".
-- This is the different case: he was here, but this bill is not his —
-- he pays his own hydro, he moved in mid-period and the landlord covered
-- him, whatever the house decides. One bill, one yuvak, no share.
--
-- Excluding someone takes his days out of the denominator too, so the
-- remaining yuvaks cover the whole bill between them. The shares still
-- sum to the bill exactly.

create table if not exists bill_exclusions (
  bill_id    uuid not null references utility_bills(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  reason     text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz default now(),
  primary key (bill_id, member_id)
);

create index if not exists idx_bill_exclusions_bill on bill_exclusions (bill_id);

comment on table bill_exclusions is
  'A yuvak left out of one bill. His days come out of the split entirely; the rest cover the bill.';

-- ---------- the split, with exclusions ----------
--
-- The return type gains a column, and Postgres will not let a function
-- change shape in place, so this drops and recreates rather than using
-- create or replace alone.

drop function if exists bill_split(uuid);

create function bill_split(p_bill uuid)
returns table (
  member_id    uuid,
  full_name    text,
  days_present int,
  days_away    int,
  share        numeric,
  excluded     boolean
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
-- Every member-day where the yuvak was living in the house, flagged with
-- whether he was away that day and whether he is off this bill entirely.
resident as (
  select
    m.id,
    m.full_name,
    d.d,
    (x.member_id is not null) as is_excluded,
    exists (
      select 1 from absences a
      where a.member_id = m.id and d.d between a.start_date and a.end_date
    ) as is_away
  from bill b
  join members m on m.mandir_id = b.mandir_id and m.is_active
  cross join days d
  left join bill_exclusions x on x.bill_id = b.id and x.member_id = m.id
  where (m.house_start is null or d.d >= m.house_start)
    and (m.house_end   is null or d.d <= m.house_end)
),
counted as (
  select
    r.id,
    r.full_name,
    r.is_excluded,
    -- An excluded yuvak contributes no days at all, which is what keeps
    -- him out of the denominator below.
    (case when r.is_excluded then 0
          else count(*) filter (where not r.is_away) end)::int as present,
    (case when r.is_excluded then 0
          else count(*) filter (where r.is_away) end)::int     as away
  from resident r
  group by r.id, r.full_name, r.is_excluded
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
  -- Excluded yuvaks sort last so a rounding penny can never land on one.
  select f.*,
    row_number() over (
      order by (case when f.is_excluded then 1 else 0 end), f.frac desc, f.full_name
    ) as rn
  from floored f
),
leftover as (
  -- With nobody chargeable for the whole period every share is zero, and
  -- there is no one to hand the rounding pennies to. Without this guard
  -- the whole bill would be dealt out a cent at a time.
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
  ),
  r.is_excluded
from ranked r
order by r.is_excluded, r.full_name;
$$;

revoke all on function bill_split(uuid) from public;
grant execute on function bill_split(uuid) to authenticated;

-- ---------- row-level security ----------

alter table bill_exclusions enable row level security;

drop policy if exists "read bill exclusions" on bill_exclusions;
create policy "read bill exclusions" on bill_exclusions
  for select to authenticated
  using (exists (
    select 1 from utility_bills b
    where b.id = bill_exclusions.bill_id
      and b.mandir_id = my_mandir()
      and is_admin()));

drop policy if exists "admins write bill exclusions" on bill_exclusions;
create policy "admins write bill exclusions" on bill_exclusions
  for all to authenticated
  using (exists (
    select 1 from utility_bills b
    where b.id = bill_exclusions.bill_id
      and b.mandir_id = my_mandir()
      and is_admin()))
  with check (exists (
    select 1 from utility_bills b
    where b.id = bill_exclusions.bill_id
      and b.mandir_id = my_mandir()
      and is_admin()));

-- Bills are admin-only to begin with, so is_admin() above already shuts
-- out viewers and anonymous sessions. These are belt and braces, matching
-- the pattern used on every other table.
drop policy if exists "viewers cannot insert bill exclusions" on bill_exclusions;
drop policy if exists "viewers cannot update bill exclusions" on bill_exclusions;
drop policy if exists "viewers cannot delete bill exclusions" on bill_exclusions;

create policy "viewers cannot insert bill exclusions" on bill_exclusions
  as restrictive for insert to authenticated
  with check (not is_viewer() and not is_anon());
create policy "viewers cannot update bill exclusions" on bill_exclusions
  as restrictive for update to authenticated
  using (not is_viewer() and not is_anon());
create policy "viewers cannot delete bill exclusions" on bill_exclusions
  as restrictive for delete to authenticated
  using (not is_viewer() and not is_anon());
