-- 20240101000005_message_rate_limit.sql
-- Server-side send rate limit for message_queue.
--
-- Item #10 restricts WHO you can message (accepted friends only) but not HOW FAST.
-- A friend can still flood a friend's queue with ciphertext (storage/DoS abuse +
-- startup-lag amplification on the victim). message_queue rows are deleted after
-- delivery, so they can't be counted — use a durable append-only send log + a
-- BEFORE INSERT trigger. See docs/impl/p1d-rate-limit.md.

-------------------------------------------------------------------------------
-- Durable, append-only send log (NOT deleted on delivery, unlike message_queue)
-------------------------------------------------------------------------------
create table if not exists public.message_send_log (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_send_log_sender_time
  on public.message_send_log (sender_id, created_at desc);

-- No client access needed: the trigger writes it as SECURITY DEFINER. RLS is enabled
-- with zero policies, so anon/authenticated get nothing (and no grants are issued).
alter table public.message_send_log enable row level security;

-------------------------------------------------------------------------------
-- Trigger fn: enforce a rolling-window cap per sender, then log.
-------------------------------------------------------------------------------
create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  window_seconds constant int := 10;
  max_in_window  constant int := 20;   -- tune to real usage: too tight breaks legit bursts
  recent_count   int;
begin
  -- Self-pruning: drop this sender's rows older than the window before counting.
  -- Keeps message_send_log bounded to ~(active senders x max_in_window) rows without
  -- needing a separate pg_cron / edge-function prune job. Uses the sender_id index.
  delete from public.message_send_log
   where sender_id = new.sender_id
     and created_at <= now() - make_interval(secs => window_seconds);

  select count(*) into recent_count
    from public.message_send_log
   where sender_id = new.sender_id
     and created_at > now() - make_interval(secs => window_seconds);

  if recent_count >= max_in_window then
    -- check_violation surfaces as a clean client error. P2 outbox must treat this as
    -- RETRYABLE (backoff), not a permanent send failure.
    raise exception 'rate_limit_exceeded' using errcode = 'check_violation';
  end if;

  insert into public.message_send_log (sender_id, recipient_id)
    values (new.sender_id, new.recipient_id);

  return new;
end;
$$;

drop trigger if exists trg_message_rate_limit on public.message_queue;
create trigger trg_message_rate_limit
  before insert on public.message_queue
  for each row execute function public.enforce_message_rate_limit();

-- NOTE on residual growth: the in-trigger prune only clears rows for a sender the next
-- time they send. Rows from senders who go fully inactive linger. If that ever matters,
-- add a periodic global sweep (pg_cron, if the extension is enabled):
--   select cron.schedule('prune_send_log', '0 * * * *',
--     $$delete from public.message_send_log where created_at < now() - interval '1 day'$$);
