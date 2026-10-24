-- 11-data-api-grants.sql
-- Makes every Data API grant explicit.
--
-- Until 30 October 2026 Supabase granted the API roles access to new tables
-- in "public" automatically, and this schema has been relying on that. From
-- that date a new table is unreachable through supabase-js until it is
-- granted by hand. Nothing already created changes, so running this today
-- is a no-op against the live project — its job is to make the schema
-- reproducible, so a fresh project, a preview branch or a local
-- "supabase db reset" rebuilds a working database instead of one that
-- returns "permission denied" on every query.
--
-- Safe to run more than once.
--
-- Two deliberate departures from Supabase's suggested snippet:
--
--   anon gets nothing.  Nobody reaches this data without signing in. A PIN
--   session is a Supabase anonymous sign-in, which still carries the
--   'authenticated' role — the 'anon' role is the signed-out public, and
--   it has no business here.
--
--   settings is not granted wholesale.  Table-level select on settings is
--   revoked on purpose so the bcrypt house PIN in settings.pin_hash can
--   never be read by the browser; the readable columns are granted one by
--   one instead. A blanket "grant select on settings" would undo that and
--   hand the PIN hash to anyone with a sevak login. Re-asserted below.
--
-- A grant is not permission. Row-level security still decides which rows
-- each role sees and writes; these grants only open the door to the table.

-- ---------- read-only tables ----------
-- Writes to these go through security definer functions (claim_viewer,
-- set_house_pin, set_monthly_rent), never straight from the browser.

grant select on public.mandirs   to authenticated;
grant select on public.app_users to authenticated;

-- ---------- tables the app reads and writes ----------
-- Row-level security does the real work; see 01, 06, 07, 09 and 10.

grant select, insert, update, delete on public.members         to authenticated;
grant select, insert, update, delete on public.sabhas          to authenticated;
grant select, insert, update, delete on public.attendance      to authenticated;
grant select, insert, update, delete on public.absences        to authenticated;
grant select, insert, update, delete on public.utility_bills   to authenticated;
grant select, insert, update, delete on public.monthly_charges to authenticated;
grant select, insert, update, delete on public.bill_exclusions to authenticated;

-- ---------- the stats view ----------
-- security_invoker, so it reads through the caller's own policies.

grant select on public.member_stats to authenticated;

-- ---------- settings: columns only, never the whole table ----------
-- Repeated from 06 and 08 so a rebuilt database lands in the same state.
-- pin_hash is absent from this list on purpose.

revoke select on public.settings from anon, authenticated;
grant select (mandir_id, thursday_anchor, sunday_enabled, followup_threshold, pin_set_at)
  on public.settings to authenticated;
grant select (monthly_rent) on public.settings to authenticated;

-- ---------- service_role ----------
-- The server-side key, used by the Supabase dashboard's table editor and
-- by anything run with the secret key. It bypasses row-level security, so
-- it must never appear in browser code — see js/config.example.js.
-- settings is included here deliberately: the dashboard needs to show the
-- table, and that key never reaches the browser.

grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------- future tables ----------
-- Belt and braces for a table added later without its own grant. An
-- explicit grant in the creating migration is still the right habit —
-- default privileges only apply to tables created by the role that set
-- them, so this is a safety net, not a substitute.

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ---------- check ----------
-- Lists what 'authenticated' can reach. Expect every table above, and
-- settings showing only its granted columns.
--
--   select table_name, string_agg(distinct privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where grantee = 'authenticated' and table_schema = 'public'
--   group by table_name order by table_name;
--
--   select table_name, column_name, privilege_type
--   from information_schema.column_privileges
--   where grantee = 'authenticated' and table_schema = 'public'
--   order by table_name, column_name;
