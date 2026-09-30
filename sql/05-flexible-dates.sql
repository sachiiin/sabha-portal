-- 05-flexible-dates.sql
-- Sabhas can be held on any date. The Sunday/Thursday rule becomes a
-- default for the date picker rather than a restriction.
--
-- sabha_type now means "which series this belongs to", not "what weekday
-- it fell on" — a Thursday sabha moved to Saturday is still the Thursday
-- sabha, so it keeps counting toward the Thursday attendance rate.
--
-- Safe to run on an existing database.

alter table sabhas drop constraint if exists sabhas_sabha_type_check;

alter table sabhas add constraint sabhas_sabha_type_check
  check (sabha_type in ('sunday', 'thursday', 'extra'));

-- The date this sabha was originally scheduled for, when it was moved.
-- Null for sabhas held on their normal day.
alter table sabhas add column if not exists moved_from date;

comment on column sabhas.sabha_type is
  'Which recurring series this sabha belongs to: sunday, thursday, or extra for one-offs.';
comment on column sabhas.moved_from is
  'Original scheduled date, when the sabha was moved to a different day.';