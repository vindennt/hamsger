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
create policy "read own debug logs" on public.debug_logs
  for select using (user_id = auth.uid());
create policy "insert own debug logs" on public.debug_logs
  for insert with check (user_id = auth.uid());

grant select, insert on public.debug_logs to authenticated;
