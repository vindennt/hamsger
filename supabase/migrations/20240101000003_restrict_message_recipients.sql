-- 20240101000003_restrict_message_recipients.sql
-- Restrict who a user can enqueue messages to.
--
-- The original message_queue INSERT policy only checked auth.uid() = sender_id,
-- so any authenticated user could insert unlimited rows targeting ANY recipient.
-- E2EE protects message *content* but not *availability*: an attacker could flood
-- a stranger's queue with garbage ciphertext (DoS / storage abuse).
--
-- This ties INSERT to an accepted friendship between sender and recipient, which
-- shrinks the flooding surface from "every user" to "people who accepted you".
--
-- NOTE: this does not add a rate limit — a friend can still spam a friend. A true
-- rate limit is better handled by a trigger or edge function and is tracked
-- separately; this migration closes the "message any stranger" hole only.

-- The live DB diverged from the schema migration: the INSERT policy was recreated
-- by hand as "insert for all" with WITH CHECK (true), allowing anyone to insert any
-- row (any recipient AND any spoofed sender_id). Drop both the schema-file name and
-- the actual live name so this reproduces correctly regardless of which exists.
DROP POLICY IF EXISTS "Users can insert messages to anyone." ON public.message_queue;
DROP POLICY IF EXISTS "insert for all" ON public.message_queue;

CREATE POLICY "Users can only message accepted friends."
    ON public.message_queue FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND EXISTS (
            SELECT 1
            FROM public.friend_requests fr
            WHERE fr.status = 'accepted'
              AND (
                    (fr.from_user_id = auth.uid() AND fr.to_user_id = recipient_id)
                 OR (fr.to_user_id   = auth.uid() AND fr.from_user_id = recipient_id)
              )
        )
    );
