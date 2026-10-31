-- 23-pin-rules.sql
-- The house PIN must now be exactly 6 digits, and must not contain 0, 3,
-- 6 and 9 together as four consecutive characters, in any order — 0369,
-- 0936, 9036, 3609 and so on are all rejected; 361809 is fine, since
-- those four digits are never adjacent there. Replaces the old 4-32
-- character free-text check. The UI (settings.js) mirrors this for
-- immediate feedback, but this function is the real enforcement — it's
-- callable directly as an RPC regardless of what the browser sent.

create or replace function pin_has_forbidden_pattern(p_pin text) returns boolean
language sql immutable
as $$
  select exists (
    select 1
    from generate_series(1, length(p_pin) - 3) as i
    where (
      select string_agg(c, '' order by c)
      from unnest(string_to_array(substr(p_pin, i, 4), null)) as c
    ) = '0369'
  )
$$;

create or replace function set_house_pin(new_pin text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_mandir uuid;
begin
  if not is_admin() then
    raise exception 'only an admin can change the PIN';
  end if;

  if new_pin is null or trim(new_pin) !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  if pin_has_forbidden_pattern(trim(new_pin)) then
    raise exception 'PIN cannot have 0, 3, 6 and 9 together in a row, in any order';
  end if;

  v_mandir := my_mandir();

  update settings
  set pin_hash   = crypt(trim(new_pin), gen_salt('bf')),
      pin_set_at = now()
  where mandir_id = v_mandir;
end $$;

revoke all on function set_house_pin(text) from public;
grant execute on function set_house_pin(text) to authenticated;
