-- 25-cleanup-anonymous-pin-accounts.sql
-- Every PIN sign-in calls signInAnonymously(), which creates a brand new
-- row in auth.users. Signing out (or a wrong house name/PIN) only ever
-- cleared the browser's session — the anonymous account itself stayed in
-- auth.users forever, since actually deleting it needs the Supabase
-- admin API (the secret key), which this static site never ships to the
-- browser.
--
-- Fix: a security-definer function that deletes the CALLER'S OWN account,
-- and only if it's genuinely anonymous (auth.users.is_anonymous) — safe
-- to call unconditionally from signOut() for every account type, since
-- it quietly does nothing for a real sevak/admin/platform account. Wired
-- in before both the normal sign-out and the two "PIN didn't match"
-- failure paths in js/auth.js.
--
-- This only prevents NEW orphans going forward. Anyone with a backlog of
-- these already in their Supabase project can clear it once by hand —
-- safe to run any time, though it will sign out anyone mid-PIN-session
-- at that moment:
--   delete from auth.users where is_anonymous = true;

create or replace function delete_own_anonymous_account() returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not coalesce((select is_anonymous from auth.users where id = auth.uid()), false) then
    return; -- a real account — nothing to clean up, and never touch it
  end if;

  delete from app_users where id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function delete_own_anonymous_account() from public;
grant execute on function delete_own_anonymous_account() to authenticated;
