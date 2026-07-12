-- 20240101000006_message_queue_dedup.sql
-- Idempotency for the durable send outbox (docs/impl/p2-reliability-outbox.md).
--
-- The client retries a send until the server confirms it. If a prior attempt
-- actually landed but its response was lost (flaky network), the retry must not
-- create a second queue row. The payload `id` is stable across a message's
-- retries, so a UNIQUE index on (sender_id, payload->>'id') rejects the dup with
-- 23505 — the client treats that as "already delivered" and clears the outbox row.
--
-- Note message_queue rows are deleted after delivery, so this only guards the
-- window while the row is still queued; a retry after the recipient has drained
-- the row inserts a fresh row that the recipient dedups via messageExists().

create unique index if not exists uq_message_queue_sender_payload_id
  on public.message_queue (sender_id, (payload->>'id'));
