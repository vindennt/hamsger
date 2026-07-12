-- 20240101000002_tighten_grants.sql
-- Defense-in-depth for RLS.
--
-- The earlier grants.sql gave BOTH anon and authenticated ALL PRIVILEGES on every
-- table, which made RLS the *only* barrier: if RLS were ever disabled on a table
-- (e.g. an accidental migration), anon would get unrestricted read/write access.
-- This migration scopes each role to the minimum verbs its RLS policies allow.
-- RLS continues to enforce WHICH rows a user can touch; these grants gate WHICH verbs.

-------------------------------------------------------------------------------
-- 1. Reset the blanket grants from 20240101000001_grants.sql
-------------------------------------------------------------------------------

REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated;

-- Undo the ALTER DEFAULT PRIVILEGES so future tables are NOT auto-granted to anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated;

-- Schema usage is still required to reference any object.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-------------------------------------------------------------------------------
-- 2. anon (unauthenticated): only what pre-signup flows need.
--    The username-availability check in sign-up.tsx runs before signUp(), so
--    anon needs SELECT on profiles. Nothing else runs unauthenticated.
-------------------------------------------------------------------------------

GRANT SELECT ON public.profiles TO anon;

-------------------------------------------------------------------------------
-- 3. authenticated: exactly the verbs each table's RLS policies permit.
-------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE         ON public.profiles          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prekey_bundles    TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.one_time_prekeys  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests   TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.contacts          TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.message_queue     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.encrypted_backups TO authenticated;
