-- 16-platform-house-view-absences.sql
-- sql/15-platform-house-view.sql covered members/sabhas/attendance/settings
-- for the platform admin's read-only house view, but missed absences —
-- the "Away" section on both the real Dashboard and History pages, and
-- now platform-house.js's copies of them, both depend on it. No
-- restrictive "approved mandirs only" policy exists on this table (unlike
-- members/sabhas/attendance in 12-multi-tenant.sql), so a plain permissive
-- policy is the whole fix.

create policy "platform admin reads absences" on absences
  for select using (is_platform_admin());
