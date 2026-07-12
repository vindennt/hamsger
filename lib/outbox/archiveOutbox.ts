// Durable ARCHIVE outbox flusher. Batch-delivers staged rows to Supabase
// `message_archive` (each row's ciphertext is already encrypted under the user's
// archive_key), retries with exponential backoff, and gives up after
// MAX_ATTEMPTS. Unlike the P2 send outbox there is no per-conversation ordering
// constraint, so rows are batched across conversations in one insert.
// See docs/impl/p3-cloud-archive-hybrid.md.
import {
  archiveOutboxRepo,
  ArchiveOutboxRow,
} from "../database/archiveOutboxRepository";
import { supabase } from "../supabase";

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 100;

/** Exponential backoff, capped at 5 minutes (shared shape with the send outbox). */
export function archiveBackoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 300) * 1000;
}

/** A row is due if it has never been attempted or its backoff window has elapsed. */
function isDue(row: ArchiveOutboxRow, now: number): boolean {
  if (!row.last_attempt_at) return true;
  return (
    now >=
    new Date(row.last_attempt_at).getTime() + archiveBackoffMs(row.attempts)
  );
}

/**
 * Deliver one batch. `upsert(..., ignoreDuplicates)` maps to INSERT ... ON
 * CONFLICT DO NOTHING, so a row already archived by a prior attempt (unique
 * user_id,msg_id) is silently skipped without erroring the batch — and DO
 * NOTHING needs only the INSERT privilege we grant. Returns true if the batch
 * landed (rows dropped), false if it should be retried.
 */
async function deliverBatch(rows: ArchiveOutboxRow[]): Promise<boolean> {
  const { error } = await supabase.from("message_archive").upsert(
    rows.map((r) => ({
      user_id: r.user_id,
      conversation_id: r.conversation_id,
      msg_id: r.msg_id,
      ciphertext: r.ciphertext,
      iv: r.iv,
      auth_tag: r.auth_tag,
      created_at_server: r.created_at_server,
    })),
    { onConflict: "user_id,msg_id", ignoreDuplicates: true },
  );

  const ids = rows.map((r) => r.msg_id);

  if (!error) {
    await archiveOutboxRepo.markDone(ids);
    return true;
  }

  await archiveOutboxRepo.bumpAttempts(ids);
  // Attempts were just bumped; a row now at/over the cap is abandoned.
  const exhausted = rows
    .filter((r) => r.attempts + 1 >= MAX_ATTEMPTS)
    .map((r) => r.msg_id);
  await archiveOutboxRepo.markFailed(exhausted);
  return false;
}

// Single-flight guard: never run two flushes at once (they'd double-deliver the
// same pending rows). A flush requested while one is running re-runs once after.
let flushing = false;
let flushQueued = false;

/** Deliver one due batch. Returns true if a batch landed (rows dropped). */
async function flushOnce(): Promise<boolean> {
  const now = Date.now();
  const pending = await archiveOutboxRepo.getPending(BATCH_SIZE);
  const due = pending.filter((r) => isDue(r, now));
  if (due.length === 0) return false;
  return deliverBatch(due);
}

/**
 * Flush staged archive rows. Fire-and-forget from the chat path; also called on
 * boot, after backfill, and on the useOutbox triggers (foreground / reconnect /
 * timer). Safe to call concurrently.
 */
export async function flushArchiveOutbox(): Promise<void> {
  if (flushing) {
    flushQueued = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushQueued = false;
      // Drain while batches keep landing; stop on empty, all-backed-off, or a
      // retryable failure (those rows retry on the next flush trigger).
      while (await flushOnce()) {
        /* keep draining */
      }
    } while (flushQueued);
  } catch (e) {
    console.error("[archiveOutbox] flush failed:", e);
  } finally {
    flushing = false;
  }
}
