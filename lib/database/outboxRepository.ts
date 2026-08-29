import { type SQLiteDatabase } from "expo-sqlite";

/**
 * Durable SEND outbox (schema v4, `outbox` table). Holds the encrypted payload
 * of each message we send until the server confirms delivery, so a retry never
 * re-runs the ratchet (which would advance `n` and reorder). See
 * docs/impl/p2-reliability-outbox.md and lib/outbox/outbox.ts.
 */
export interface OutboxRow {
  msg_id: string; // composite `${base_msg_id}__${recipient_device_id}` (fan-out)
  base_msg_id: string | null; // logical message id (NULL on pre-fan-out rows)
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  recipient_device_id: string | null; // target peer device (NULL on legacy rows)
  payload: string; // JSON of the server EncryptedDbMessage, fixed at send time
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
}

// A logical message maps to N device rows; strip the composite suffix to group
// them back to the chat bubble. Legacy rows have no `__` suffix (base === id).
function baseIdOf(row: { base_msg_id: string | null; msg_id: string }): string {
  return row.base_msg_id ?? row.msg_id;
}

let db: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error(
      "[outboxRepository] Database not initialised. Call setOutboxDb(db) first.",
    );
  }
  return db;
}

export function setOutboxDb(database: SQLiteDatabase): void {
  db = database;
}

export const outboxRepo = {
  /** Persist a pending send BEFORE the network attempt. Idempotent by msg_id. */
  async enqueue(row: {
    msg_id: string;
    base_msg_id: string;
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    recipient_device_id: string;
    payload: string;
  }): Promise<void> {
    await getDb().runAsync(
      `INSERT OR IGNORE INTO outbox
        (msg_id, base_msg_id, conversation_id, sender_id, recipient_id, recipient_device_id, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [
        row.msg_id,
        row.base_msg_id,
        row.conversation_id,
        row.sender_id,
        row.recipient_id,
        row.recipient_device_id,
        row.payload,
        new Date().toISOString(),
      ],
    );
  },

  /** Delivery confirmed — drop the row (durable message history lives in `messages`). */
  async markSent(msgId: string): Promise<void> {
    await getDb().runAsync(`DELETE FROM outbox WHERE msg_id = ?`, [msgId]);
  },

  async bumpAttempt(msgId: string): Promise<void> {
    await getDb().runAsync(
      `UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE msg_id = ?`,
      [new Date().toISOString(), msgId],
    );
  },

  /** Give up after too many attempts; excluded from getPending() until retry(). */
  async markFailed(msgId: string): Promise<void> {
    await getDb().runAsync(
      `UPDATE outbox SET status = 'failed' WHERE msg_id = ?`,
      [msgId],
    );
  },

  /** Manual tap-to-retry: re-arm every device row of a logical message. */
  async retry(baseMsgId: string): Promise<void> {
    await getDb().runAsync(
      `UPDATE outbox SET status = 'pending', attempts = 0, last_attempt_at = NULL
         WHERE base_msg_id = ? OR msg_id = ?`,
      [baseMsgId, baseMsgId],
    );
  },

  async getPending(): Promise<OutboxRow[]> {
    return getDb().getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC`,
    );
  },

  /**
   * Aggregated status of a sent message from its remaining device
   * rows: 'failed' if any device row failed, else 'pending' if any is still
   * pending, else null
   * TODO: considered "sent" if sent to all devices, but might be misleading
   */
  async getBaseStatus(baseMsgId: string): Promise<"pending" | "failed" | null> {
    const rows = await getDb().getAllAsync<{ status: string }>(
      `SELECT status FROM outbox WHERE base_msg_id = ? OR msg_id = ?`,
      [baseMsgId, baseMsgId],
    );
    if (rows.some((r) => r.status === "failed")) return "failed";
    if (rows.some((r) => r.status === "pending")) return "pending";
    return null;
  },

  /**
   * Undelivered send statuses for a conversation, keyed by LOGICAL message id
   * (device rows aggregated). Used on load so a message still in the outbox
   * keeps its pending/failed indicator across app restarts (fully delivered
   * messages are absent → they render with no indicator).
   */
  async getStatusesByConversation(
    conversationId: string,
  ): Promise<Record<string, "pending" | "failed">> {
    const rows = await getDb().getAllAsync<{
      msg_id: string;
      base_msg_id: string | null;
      status: string;
    }>(
      `SELECT msg_id, base_msg_id, status FROM outbox WHERE conversation_id = ?`,
      [conversationId],
    );
    const map: Record<string, "pending" | "failed"> = {};
    for (const r of rows) {
      const base = baseIdOf(r);
      // 'failed' on any device row wins; otherwise 'pending' if not already failed.
      if (r.status === "failed") map[base] = "failed";
      else if (r.status === "pending" && map[base] !== "failed")
        map[base] = "pending";
    }
    return map;
  },
};
