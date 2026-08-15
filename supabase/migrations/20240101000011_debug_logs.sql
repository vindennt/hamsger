-- 20240101000011_debug_logs.sql
-- Diagnostic-only table for the mobile/web multi-device desync investigation.
-- Clients write structured sync events (send / recv_ok / recv_fail / reset_*)
-- here so mobile logs (where the console is inaccessible) can be read from the
-- SQL editor. Owner-only: a user sees only their own rows. Temporary; drop when
-- the sync work is done.

create table if not exists public.debug_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device text,
  event text not null,
  conversation_id text,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.debug_logs enable row level security;

-- owner-only read; default user_id = auth.uid() fills the column on insert
drop policy if exists "read own debug logs" on public.debug_logs;
create policy "read own debug logs" on public.debug_logs
  for select using (user_id = auth.uid());
drop policy if exists "insert own debug logs" on public.debug_logs;
create policy "insert own debug logs" on public.debug_logs
  for insert with check (user_id = auth.uid());

grant select, insert on public.debug_logs to authenticated;

-- Retention: self-prune on insert so the table stays bounded without pg_cron.
-- Each insert deletes the same user's rows older than 7 days (same pattern as
-- the message_send_log rate-limit trigger in migration ...0005).
create or replace function public.prune_debug_logs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.debug_logs
   where user_id = new.user_id
     and created_at < now() - interval '7 days';
  return new;
end;
$$;

drop trigger if exists trg_prune_debug_logs on public.debug_logs;
create trigger trg_prune_debug_logs
  before insert on public.debug_logs
  for each row execute function public.prune_debug_logs();
