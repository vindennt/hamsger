-- 20240101000012_multidevice_schema.sql
-- Concurrent live multi-device support (Phase 0): reset-all + every
-- device-dimension schema change, in one transaction.
--
-- Model: one account identity (shared IK + signing key) but PER-DEVICE sessions.
-- A "device" is its prekey_bundles row; there is no separate devices table in v1.
-- The registry, the 3-device cap, and last_seen all live on prekey_bundles.
--
-- This is destructive by design (locked decision: no legacy users). It wipes all
-- now-invalid single-key bundles/sessions, ephemeral transport, and backups. It
-- KEEPS profiles, friend_requests, contacts. History repopulates from each
-- device's fresh handshakes + the encrypted archive.

begin;

-------------------------------------------------------------------------------
-- 0. RESET. Truncate BEFORE adding the new NOT NULL device columns / FKs so the
--    empty tables accept the columns without a backfill default.
-------------------------------------------------------------------------------
truncate table
  public.message_queue,
  public.message_archive,
  public.one_time_prekeys,
  public.prekey_bundles,
  public.encrypted_backups
  restart identity cascade;

-------------------------------------------------------------------------------
-- 1. prekey_bundles becomes the per-device registry. PK -> (user_id, device_id).
--    identity_key + signing_key stay ACCOUNT-shared (identical on every device
--    row); signed_prekey + spk_signature are PER-DEVICE; updated_at doubles as
--    last_seen (touched on foreground) to drive the LRU eviction below.
-------------------------------------------------------------------------------
alter table public.prekey_bundles
  drop constraint prekey_bundles_pkey;

alter table public.prekey_bundles
  add column if not exists device_id uuid not null;

alter table public.prekey_bundles
  add column if not exists created_at timestamptz not null default timezone('utc'::text, now());

alter table public.prekey_bundles
  add constraint prekey_bundles_pkey primary key (user_id, device_id);

-- TODO(security): per-device prekey_bundles rows leak a user's device count/ids
-- to any authenticated reader (SELECT is world-readable today). Tighten SELECT to
-- accepted-friends-only (fan-out senders are always accepted friends).

-------------------------------------------------------------------------------
-- 2. one_time_prekeys gets a device dimension and an FK to the owning device's
--    bundle, so evicting a device cascade-drops that device's OPK pool.
-------------------------------------------------------------------------------
alter table public.one_time_prekeys
  add column if not exists device_id uuid not null;

create index if not exists idx_one_time_prekeys_user_device
  on public.one_time_prekeys(user_id, device_id, created_at);

alter table public.one_time_prekeys
  add constraint one_time_prekeys_device_fk
  foreign key (user_id, device_id)
  references public.prekey_bundles(user_id, device_id)
  on delete cascade;

-------------------------------------------------------------------------------
-- 3. message_queue gets a recipient device target. Fan-out inserts one row per
--    peer device. SELECT/DELETE RLS stays auth.uid()=recipient_id (unchanged);
--    the per-device filter is applied client-side (.eq recipient_device_id).
-------------------------------------------------------------------------------
alter table public.message_queue
  add column if not exists recipient_device_id uuid not null;

create index if not exists idx_message_queue_recipient_device
  on public.message_queue(recipient_id, recipient_device_id, created_at);

-- TODO(security): recipient_device_id is not validated against the recipient's
-- real devices, so a friend can insert rows for bogus device_ids that never drain
-- and bloat the queue. Add an FK/constraint to the recipient's prekey_bundles or
-- a periodic reaper of undelivered rows older than N days.

-------------------------------------------------------------------------------
-- 4. Device-targeted OPK pop. Replaces the single-arg version (single-device).
--    Friendship check unchanged; adds the device filter. Table aliases keep every
--    column reference unambiguous (see migration ...0010 for the 42702 fix).
-------------------------------------------------------------------------------
drop function if exists public.pop_one_time_prekey(uuid);

create or replace function public.pop_one_time_prekey(target uuid, target_device uuid)
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

  -- atomic pop of one OPK belonging to the target's specific device
  return query
  delete from public.one_time_prekeys otp
   where otp.id = (
     select pick.id from public.one_time_prekeys pick
      where pick.user_id = target
        and pick.device_id = target_device
      order by pick.created_at
      for update skip locked
      limit 1
   )
  returning otp.id, otp.public_key;
end;
$$;

revoke execute on function public.pop_one_time_prekey(uuid, uuid) from public;
grant execute on function public.pop_one_time_prekey(uuid, uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. Device cap of 3 with least-recently-seen auto-eviction. BEFORE INSERT on
--    prekey_bundles: if adding a NEW device_id would exceed the cap, delete the
--    oldest-seen device row(s) first (their OPKs cascade via the FK above).
--    Re-publishing an existing device (ON CONFLICT DO UPDATE) also fires this
--    trigger, so the count EXCLUDES new.device_id and never self-evicts.
-------------------------------------------------------------------------------
create or replace function public.enforce_device_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  device_cap constant int := 3;
  other_count int;
begin
  select count(*) into other_count
    from public.prekey_bundles
   where user_id = new.user_id
     and device_id <> new.device_id;

  if other_count >= device_cap then
    delete from public.prekey_bundles
     where (user_id, device_id) in (
       select p.user_id, p.device_id
         from public.prekey_bundles p
        where p.user_id = new.user_id
          and p.device_id <> new.device_id
        order by p.updated_at asc
        limit (other_count - device_cap + 1)
     );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prekey_device_cap on public.prekey_bundles;
create trigger trg_prekey_device_cap
  before insert on public.prekey_bundles
  for each row execute function public.enforce_device_cap();

-- TODO(security): auto-evict LRU on cap-hit can drop a real-but-idle device.
-- Pair with the planned new-device alert (subscribe to own prekey_bundles
-- INSERTs) so unexpected registrations are visible. Adding a device already
-- requires full account + PIN/mnemonic access.

-------------------------------------------------------------------------------
-- 6. Raise the send rate cap to absorb fan-out (up to 3 rows / logical message).
--    Was 20/10s (migration ...0005); 60/10s = 20 x the 3-device cap so real send
--    rate isn't throttled. Everything else about the limiter is unchanged.
-------------------------------------------------------------------------------
create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  window_seconds constant int := 10;
  max_in_window  constant int := 60;   -- TODO(security): ~3x raw ceiling to a single-device peer; revisit with per-logical-message (idempotency-key) counting if abused
  recent_count   int;
begin
  delete from public.message_send_log
   where sender_id = new.sender_id
     and created_at <= now() - make_interval(secs => window_seconds);

  select count(*) into recent_count
    from public.message_send_log
   where sender_id = new.sender_id
     and created_at > now() - make_interval(secs => window_seconds);

  if recent_count >= max_in_window then
    raise exception 'rate_limit_exceeded' using errcode = 'check_violation';
  end if;

  insert into public.message_send_log (sender_id, recipient_id)
    values (new.sender_id, new.recipient_id);

  return new;
end;
$$;

commit;
