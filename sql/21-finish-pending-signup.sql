-- 21-finish-pending-signup.sql
-- Replaces the sessionStorage-based "finish registering once a session
-- shows up" trick with one driven entirely by data Postgres already has.
--
-- The old approach (register.html stashing the registration/join details
-- in sessionStorage, requireAuth() picking them back up) only works if
-- the SAME browser tab that submitted the form is still open when the
-- confirmation link is clicked. In practice someone registers on a
-- desktop, then taps "Confirm your email" from a phone's mail app — a
-- different browser entirely, with no access to that sessionStorage —
-- and the stash is silently lost. The mandir or join request never gets
-- created, the platform admin never sees anything to approve, and the
-- person is left looking at a plain sign-in page with no explanation.
--
-- Fix: signUp() now carries the pending details as Supabase user
-- metadata, which Supabase stores on the auth.users row immediately and
-- embeds in every access token issued for that account afterward —
-- including the one minted right when the confirmation link is clicked,
-- on whatever device that happens to be. finish_pending_signup() reads
-- it straight out of the JWT and dispatches to register_mandir() or
-- join_mandir(), whichever kind it is.

create or replace function finish_pending_signup()
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_kind text := v_meta ->> 'kind';
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if exists (select 1 from app_users where id = auth.uid()) then
    raise exception 'this account is already linked to a gharmandir';
  end if;

  if v_kind = 'join' then
    perform join_mandir((v_meta ->> 'mandirId')::uuid, v_meta ->> 'adminName');
    return (v_meta ->> 'mandirId')::uuid;
  end if;

  if v_kind = 'register' then
    return register_mandir(
      coalesce(v_meta ->> 'mandirName', 'Gharmandir'),
      v_meta ->> 'gharName',
      v_meta ->> 'addressLine',
      v_meta ->> 'city',
      v_meta ->> 'province',
      v_meta ->> 'postalCode',
      v_meta ->> 'adminName',
      v_meta ->> 'contactEmail'
    );
  end if;

  raise exception 'no pending registration found for this account';
end $$;

revoke all on function finish_pending_signup() from public;
grant execute on function finish_pending_signup() to authenticated;
