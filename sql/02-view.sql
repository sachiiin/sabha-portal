-- 02-view.sql
-- Per-member attendance rollup. Feeds the dashboard roster and the
-- summary CSV export.

create view member_stats as
select
  m.id,
  m.mandir_id,
  m.full_name,
  m.mandal,
  m.is_sevak,
  count(a.id)                                               as total,
  count(a.id) filter (where a.status in ('present','late')) as attended,
  count(a.id) filter (where a.status = 'absent')            as missed,
  count(a.id) filter (where a.status = 'late')              as late_count,
  count(a.id) filter (where a.status = 'excused')           as excused_count,
  coalesce(round(100.0 * count(a.id) filter (where a.status in ('present','late'))
    / nullif(count(a.id), 0)), 0)::int                      as pct
from members m
left join attendance a on a.member_id = m.id
left join sabhas s on s.id = a.sabha_id and not s.is_cancelled
where m.is_active
group by m.id;

-- Postgres 15+ creates views as SECURITY DEFINER by default, which makes
-- the view ignore the caller's row-level security. security_invoker makes
-- it respect the policies of whoever is querying.
alter view member_stats set (security_invoker = on);
