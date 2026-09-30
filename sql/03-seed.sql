-- 03-seed.sql
-- Creates the Dasanudas mandir, 12 yuvaks, 6 past sabhas and randomised
-- attendance so the dashboard has something to show on first run.
--
-- Run BEFORE 04-rls.sql — row-level security would block these inserts.
-- Delete the attendance/sabha portion once you start recording real data.

do $$
declare
  v_mandir uuid;
  v_member uuid;
  v_sabha  uuid;
  v_name   text;
  v_date   date;
  v_roll   int;
  v_names  text[] := array[
    'Raj Patel','Amit Kumar','Vikram Reddy','Nikhil Joshi',
    'Dhruv Shah','Kunal Mehta','Parth Trivedi','Manan Doshi',
    'Harsh Bhatt','Yash Solanki','Rohan Vyas','Tejas Pandya'];
  v_dates  date[] := array[
    '2026-09-03','2026-09-06','2026-09-13',
    '2026-09-17','2026-09-20','2026-09-27']::date[];
begin
  insert into mandirs (name, ghar_name, city)
  values ('Gharmandir', 'Dasanudas', 'Toronto')
  returning id into v_mandir;

  -- 2026-09-03 is a Thursday that had sabha; the biweekly cycle counts from here.
  insert into settings (mandir_id, thursday_anchor)
  values (v_mandir, '2026-09-03');

  foreach v_name in array v_names loop
    insert into members (mandir_id, full_name, mandal, is_sevak)
    values (v_mandir, v_name, 'yuvak', v_name = 'Raj Patel');
  end loop;

  foreach v_date in array v_dates loop
    insert into sabhas (mandir_id, sabha_date, sabha_type)
    values (
      v_mandir,
      v_date,
      case when extract(dow from v_date) = 0 then 'sunday' else 'thursday' end
    )
    returning id into v_sabha;

    for v_member in select id from members where mandir_id = v_mandir loop
      v_roll := floor(random() * 100);
      insert into attendance (sabha_id, member_id, status)
      values (
        v_sabha,
        v_member,
        case
          when v_roll < 72 then 'present'
          when v_roll < 82 then 'late'
          when v_roll < 88 then 'excused'
          else 'absent'
        end
      );
    end loop;
  end loop;
end $$;

-- Sanity check — expect 12 rows.
select full_name, attended, total, pct from member_stats order by pct desc;
