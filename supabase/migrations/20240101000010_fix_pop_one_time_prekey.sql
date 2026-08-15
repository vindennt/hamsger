-- 20240101000010_fix_pop_one_time_prekey.sql
-- Fix: pop_one_time_prekey raised 42702 "column reference id is ambiguous" on
-- every call, so OPKs were never consumed (handshakes silently fell back to a
-- no-OPK X3DH). Cause: the `returns table (id, public_key)` OUT params collide
-- with the same-named table columns in the body. Fix: alias the table so every
-- reference is qualified and unambiguous. Behaviour + client contract unchanged.

create or replace function public.pop_one_time_prekey(target uuid)
returns table (id uuid, public_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  -- friends-only: a stranger can't drain a user's OPK pool as DoS
  if not exists (
    select 1 from public.friend_requests fr
     where fr.status = 'accepted'
       and (
         (fr.from_user_id = caller and fr.to_user_id = target)
         or (fr.from_user_id = target and fr.to_user_id = caller)
       )
  ) then
    raise exception 'not_friends' using errcode = 'insufficient_privilege';
  end if;

  -- atomic pop: one row, skip-locked so two initiators can't grab the same OPK
  return query
  delete from public.one_time_prekeys otp
   where otp.id = (
     select pick.id from public.one_time_prekeys pick
      where pick.user_id = target
      order by pick.created_at
      for update skip locked
      limit 1
   )
  returning otp.id, otp.public_key;
end;
$$;

-- re-assert grants (create or replace preserves them, but be explicit)
revoke execute on function public.pop_one_time_prekey(uuid) from public;
grant execute on function public.pop_one_time_prekey(uuid) to authenticated;
