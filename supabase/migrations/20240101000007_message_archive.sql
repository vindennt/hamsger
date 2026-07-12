-- 20240101000007_message_archive.sql
-- Hybrid cloud archive: append-only per-message encrypted history
-- (docs/impl/p3-cloud-archive-hybrid.md).
--
-- The monolithic backup blob (encrypted_backups) re-serialized ALL history on
-- every refresh. This table moves history into an append-only, per-message store
-- so each new message is a single row and the blob stays small (identity keys +
-- ratchet state only).
--
-- Content zero-knowledge is preserved: ciphertext/iv/auth_tag are AES-256-GCM
-- under the user's long-lived `archive_key`, which never leaves the device and
-- rides inside the Argon2id-wrapped backup blob. The server sees only ciphertext.
--
-- unique(user_id, msg_id) makes the write path idempotent: a retried archive
-- insert (durable outbox) is rejected with 23505 / ignored on conflict.

create table if not exists public.message_archive (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  conversation_id   text not null,
  msg_id            text not null,            -- app message id, for dedupe
  ciphertext        text not null,            -- AES-256-GCM under archive_key
  iv                text not null,
  auth_tag          text not null,
  created_at_server text not null,            -- original message time, for ordering
  archived_at       timestamptz not null default now(),
  unique (user_id, msg_id)
);

create index if not exists idx_archive_user_conv_time
  on public.message_archive (user_id, conversation_id, created_at_server);

-------------------------------------------------------------------------------
-- RLS: own-rows-only (mirrors encrypted_backups). RLS enforces WHICH rows a
-- user can touch; the grants below gate WHICH verbs (item-9 grant discipline).
-------------------------------------------------------------------------------

alter table public.message_archive enable row level security;

-- drop-then-create so the migration is idempotent / re-runnable
-- (CREATE POLICY has no IF NOT EXISTS).
drop policy if exists "own archive select" on public.message_archive;
create policy "own archive select" on public.message_archive
  for select using (auth.uid() = user_id);

drop policy if exists "own archive insert" on public.message_archive;
create policy "own archive insert" on public.message_archive
  for insert with check (auth.uid() = user_id);

drop policy if exists "own archive delete" on public.message_archive;
create policy "own archive delete" on public.message_archive
  for delete using (auth.uid() = user_id);

-- authenticated gets exactly the verbs its policies allow; anon gets nothing.
grant select, insert, delete on public.message_archive to authenticated;
