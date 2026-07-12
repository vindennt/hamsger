-- 20240101000004_dedupe_rls_policies.sql
-- Reconcile live-DB policy drift back to the schema migration.
--
-- Audit (pg_policies) revealed the live DB had hand-added policies with terse
-- names layered on top of the schema's named policies. Most are harmless mirror-
-- image duplicates, but ONE widened access and is a real vulnerability (see below).

-------------------------------------------------------------------------------
-- 1. CRITICAL: friend_requests "read own requests" (FOR ALL)
-------------------------------------------------------------------------------
-- Defined FOR ALL with USING ((from = me) OR (to = me)) and NO WITH CHECK, so the
-- OR qual also governs INSERT/UPDATE. Combined (OR) with the correct UPDATE policy
-- (which limits updates to to_user_id = recipient), it lets the SENDER update the
-- row too — i.e. self-accept their own outgoing friend request. Since message_queue
-- INSERT now authorizes messaging on accepted friendships, this bypasses that
-- restriction entirely. It also allows forging incoming requests (INSERT to = me,
-- from = anyone). Drop it; the named per-command policies below cover real usage.
DROP POLICY IF EXISTS "read own requests" ON public.friend_requests;

-------------------------------------------------------------------------------
-- 2. Harmless duplicate policies (same restriction as the named ones) — cleanup
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "own backup only" ON public.encrypted_backups;

DROP POLICY IF EXISTS "send requests" ON public.friend_requests;
DROP POLICY IF EXISTS "update own"    ON public.friend_requests;

DROP POLICY IF EXISTS "delete own" ON public.one_time_prekeys;
DROP POLICY IF EXISTS "write own"  ON public.one_time_prekeys;
DROP POLICY IF EXISTS "read all"   ON public.one_time_prekeys;

DROP POLICY IF EXISTS "write own"  ON public.prekey_bundles;
DROP POLICY IF EXISTS "read all"   ON public.prekey_bundles;
DROP POLICY IF EXISTS "update own" ON public.prekey_bundles;

DROP POLICY IF EXISTS "write own"  ON public.profiles;
DROP POLICY IF EXISTS "read all"   ON public.profiles;
DROP POLICY IF EXISTS "update own" ON public.profiles;

-- After this, every table should carry ONLY the named policies from
-- 20240101000000_phase1_schema.sql (message_queue's INSERT is the item-10 version).
