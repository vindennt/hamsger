// Durable SEND outbox flusher. Delivers pending rows to `message_queue`, one
// conversation at a time IN ORDER (keeps message `n` monotonic), retries with
// exponential backoff, and gives up after MAX_ATTEMPTS (surfaced as tap-to-retry).
// See docs/impl/p2-reliability-outbox.md.
import { outboxRepo, OutboxRow } from "../database/outboxRepository";
import { useChatStore } from "../store/useChatStore";
import { supabase } from "../supabase";

const MAX_ATTEMPTS = 10;

/** Exponential backoff, capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 300) * 1000;
}

function setStatus(
  convId: string,
  msgId: string,
  status: "pending" | "sent" | "failed",
): void {
  useChatStore.getState().updateMessageStatus(convId, msgId, status);
}

/**
 * One delivery attempt. Idempotent: a Postgres unique-violation (23505) means
 * the row was already delivered by a prior attempt, so treat it as success.
 * Network errors and rate_limit_exceeded (P1d) are retryable — back off.
 */
async function deliver(row: OutboxRow): Promise<boolean> {
  const payload = JSON.parse(row.payload);
  const { error } = await supabase.from("message_queue").insert({
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    recipient_device_id: row.recipient_device_id ?? payload.recipient_device_id,
    payload,
  });

  // The logical message maps to N device rows; reflect the AGGREGATE onto the
  // single chat bubble (sent only once every device row has delivered).
  const base = row.base_msg_id ?? row.msg_id;
  const reflect = async () => {
    const status = await outboxRepo.getBaseStatus(base);
    setStatus(row.conversation_id, base, status ?? "sent");
  };

  if (!error || (error as any).code === "23505") {
    await outboxRepo.markSent(row.msg_id);
    await reflect();
    return true;
  }

  await outboxRepo.bumpAttempt(row.msg_id);
  if (row.attempts + 1 >= MAX_ATTEMPTS) {
    await outboxRepo.markFailed(row.msg_id);
    await reflect();
  }
  return false;
}

// Single-flight guard: never run two flushes at once (they'd double-deliver the
// same pending rows). A flush requested while one is running re-runs once after.
let flushing = false;
let flushQueued = false;

async function flushOnce(): Promise<void> {
  const pending = await outboxRepo.getPending();
  if (pending.length === 0) return;

  const byLane = new Map<string, OutboxRow[]>();
  for (const r of pending) {
    const lane = `${r.conversation_id}::${r.recipient_device_id ?? ""}`;
    const list = byLane.get(lane) ?? [];
    list.push(r);
    byLane.set(lane, list);
  }

  await Promise.all(
    [...byLane.values()].map(async (rows) => {
      for (const row of rows) {
        // Respect per-row backoff; stop this conversation so order is preserved.
        if (row.last_attempt_at) {
          const nextAt =
            new Date(row.last_attempt_at).getTime() + backoffMs(row.attempts);
          if (Date.now() < nextAt) break;
        }
        const ok = await deliver(row);
        if (!ok) break; // preserve order: stop this conversation on first failure
      }
    }),
  );
}

/**
 * Flush all pending sends. Call on: send, app foreground, network reconnect,
 * and a backoff timer. Safe to call concurrently.
 */
export async function flushOutbox(): Promise<void> {
  if (flushing) {
    flushQueued = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushQueued = false;
      await flushOnce();
    } while (flushQueued);
  } catch (e) {
    console.error("[outbox] flush failed:", e);
  } finally {
    flushing = false;
  }
}

/** Manual tap-to-retry for a failed message. */
export async function retrySend(convId: string, msgId: string): Promise<void> {
  await outboxRepo.retry(msgId);
  setStatus(convId, msgId, "pending");
  await flushOutbox();
}
