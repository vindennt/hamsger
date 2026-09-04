-- 20240101000013_message_archive_realtime.sql
-- Self-sync via archive (docs/impl/multi-device-phase5-plan.md, Phase 5).
--
-- Adds message_archive to the realtime publication so a device receives an
-- INSERT event for its own new archive rows and converges live on messages sent
-- from the account's OTHER devices. RLS (own-rows-only, migration ...000007)
-- already scopes realtime rows to the owner, so a subscriber only ever sees its
-- own rows. The on-load drain works without this; realtime is the live path.

alter publication supabase_realtime add table public.message_archive;
