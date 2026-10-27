-- 17-mandal-options.sql
-- Replaces the generic age-group categories (bal/kishore/adult/senior)
-- with this house's actual mandal structure.
--
-- Any existing member whose mandal isn't in the new set is remapped to
-- 'yuvak' first, since the stricter constraint below would otherwise
-- reject those rows outright. If you have real members currently marked
-- bal/kishore/adult/senior, reassign them to 'ambrish' or 'to-be-ambrish'
-- by hand afterward from the Members page — there's no way to infer the
-- right one automatically.

update members set mandal = 'yuvak'
where mandal not in ('yuvak', 'ambrish', 'to-be-ambrish');

alter table members drop constraint if exists members_mandal_check;
alter table members add constraint members_mandal_check
  check (mandal in ('yuvak', 'ambrish', 'to-be-ambrish'));
