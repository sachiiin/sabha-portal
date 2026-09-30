-- 04-rls.sql
-- Row-level security. Run LAST, after seeding.
--
-- Without this, anyone holding the publishable key could read and write
-- every row — and the publishable key is visible in the browser by design.

alter table mandirs    enable row level security;
alter table settings   enable row level security;
alter table app_users  enable row level security;
alter table members    enable row level security;
alter table sabhas     enable row level security;
alter table attendance enable row level security;

-- security definer so the policy on app_users doesn't recurse while
-- trying to evaluate itself.
create function my_mandir() returns uuid
language sql stable security definer as
$$ select mandir_id from app_users where id = auth.uid() $$;

create function is_admin() returns boolean
language sql stable security definer as
$$ select coalesce((select role = 'admin' from app_users where id = auth.uid()), false) $$;

create policy "own row" on app_users
  for select using (id = auth.uid());

create policy "own mandir" on mandirs
  for select using (id = my_mandir());

create policy "own settings" on settings
  for select using (mandir_id = my_mandir());

create policy "read members" on members
  for select using (mandir_id = my_mandir());

create policy "admins write members" on members
  for all using (mandir_id = my_mandir() and is_admin())
  with check (mandir_id = my_mandir() and is_admin());

create policy "read sabhas" on sabhas
  for select using (mandir_id = my_mandir());

create policy "sevaks write sabhas" on sabhas
  for all using (mandir_id = my_mandir())
  with check (mandir_id = my_mandir());

create policy "read attendance" on attendance
  for select using (
    exists (select 1 from sabhas s
            where s.id = attendance.sabha_id and s.mandir_id = my_mandir()));

create policy "sevaks mark attendance" on attendance
  for all using (
    exists (select 1 from sabhas s
            where s.id = attendance.sabha_id and s.mandir_id = my_mandir()))
  with check (
    exists (select 1 from sabhas s
            where s.id = attendance.sabha_id and s.mandir_id = my_mandir()));
