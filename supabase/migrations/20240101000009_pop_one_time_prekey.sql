-- 20240101000009_pop_one_time_prekey.sql
-- Atomic, friends-only consumption of a one-time prekey (X3DH OPK).
--
-- OPKs are published + backed up but never consumed: sessionHelpers.ts only reads
-- identity_key/signed_prekey, so the server count never drops and first-message
-- forward secrecy is unrealized. This adds the server primitive an initiator calls
-- to claim (and delete) exactly one of the target's OPKs before starting a session.
-- Must be atomic (two initiators can't grab the same OPK) and friends-only (a
-- stranger can't drain a user's OPK pool as DoS).

create or replace function public.pop_one_time_prekey(target uuid)
returns table (id uuid, public_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.friend_requests
     where status = 'accepted'
       and (
         (from_user_id = caller and to_user_id = target)
         or (from_user_id = target and to_user_id = caller)
       )
  ) then
    raise exception 'not_friends' using errcode = 'insufficient_privilege';
  end if;

  return query
  delete from public.one_time_prekeys
   where id = (
     select id from public.one_time_prekeys
      where user_id = target
      order by created_at
      for update skip locked
      limit 1
   )
  returning id, public_key;
end;
$$;

-- SECURITY DEFINER intentionally bypasses the caller's own-rows-only DELETE RLS
-- on one_time_prekeys, so a friend can consume the target's OPK. The friends-guard
-- above is the authorization boundary, not RLS.
revoke execute on function public.pop_one_time_prekey(uuid) from public;
grant execute on function public.pop_one_time_prekey(uuid) to authenticated;
