-- 15-platform-house-view.sql
-- Lets the platform admin open one house from All Houses and see its
-- actual dashboard, history and roster — read only.
--
-- This is a deliberate, explicit exception to the boundary
-- 12-multi-tenant.sql documents ("registration details only, never a
-- house's members/sabhas/attendance"). That boundary was the cautious
-- default; the platform admin asked for this specific exception, so it's
-- narrow on purpose: four new SELECT-only policies, nothing else. Every
-- existing write-side restriction — admin-only edits, approved-mandir-only
-- writes, the restrictive policies from 12-multi-tenant.sql — stands
-- completely untouched, because none of this grants insert, update or
-- delete to the platform admin on any of these tables.
--
-- js/api/members.js, sabhas.js and attendance.js already take an explicit
-- mandirId argument rather than assuming the caller's own, so the
-- platform-side page (js/pages/platform-house.js) reuses them unchanged,
-- passing whichever house's id it's inspecting.

create policy "platform admin reads members" on members
  for select using (is_platform_admin());

create policy "platform admin reads sabhas" on sabhas
  for select using (is_platform_admin());

create policy "platform admin reads attendance" on attendance
  for select using (is_platform_admin());

create policy "platform admin reads settings" on settings
  for select using (is_platform_admin());

-- The restrictive "approved mandirs only" policies from
-- 12-multi-tenant.sql check my_mandir_approved() — "is MY OWN mandir
-- approved" — which is always false for a platform-only admin, since
-- they have no mandir of their own. Left alone, that restrictive policy
-- would silently block every one of the three permissive policies just
-- added above regardless of is_platform_admin(). Recreated with the same
-- name and the same restrictive effect on everyone else, just also true
-- for a platform admin. Still read-only: the permissive side is what
-- actually grants access, and no permissive insert/update/delete policy
-- exists for a platform-only account, so this cannot open up writes.
drop policy if exists "approved mandirs only: members" on members;
create policy "approved mandirs only: members" on members
  as restrictive for all using (my_mandir_approved() or is_platform_admin());

drop policy if exists "approved mandirs only: sabhas" on sabhas;
create policy "approved mandirs only: sabhas" on sabhas
  as restrictive for all using (my_mandir_approved() or is_platform_admin());

drop policy if exists "approved mandirs only: attendance" on attendance;
create policy "approved mandirs only: attendance" on attendance
  as restrictive for all using (my_mandir_approved() or is_platform_admin());
