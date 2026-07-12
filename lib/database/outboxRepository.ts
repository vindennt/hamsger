import { type SQLiteDatabase } from "expo-sqlite";

/**
 * Durable SEND outbox (schema v4, `outbox` table). Holds the encrypted payload
 * of each message we send until the server confirms delivery, so a retry never
 * re-runs the ratchet (which would advance `n` and reorder). See
 * docs/impl/p2-reliability-outbox.md and lib/outbox/outbox.ts.
 */
export interface OutboxRow {
  msg_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  payload: string; // JSON of the server EncryptedDbMessage, fixed at send time
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
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
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    payload: string;
  }): Promise<void> {
    await getDb().runAsync(
      `INSERT OR IGNORE INTO outbox
        (msg_id, conversation_id, sender_id, recipient_id, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [
        row.msg_id,
        row.conversation_id,
        row.sender_id,
        row.recipient_id,
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
    await getDb().runAsync(`UPDATE outbox SET status = 'failed' WHERE msg_id = ?`, [
      msgId,
    ]);
  },

  /** Manual tap-to-retry: re-arm a failed row. */
  async retry(msgId: string): Promise<void> {
    await getDb().runAsync(
      `UPDATE outbox SET status = 'pending', attempts = 0, last_attempt_at = NULL WHERE msg_id = ?`,
      [msgId],
    );
  },

  async getPending(): Promise<OutboxRow[]> {
    return getDb().getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC`,
    );
  },

  /**
   * Undelivered send statuses for a conversation, keyed by msg_id. Used on load
   * so a message still in the outbox keeps its pending/failed indicator across
   * app restarts (delivered messages are absent → they render with no indicator).
   */
  async getStatusesByConversation(
    conversationId: string,
  ): Promise<Record<string, "pending" | "failed">> {
    const rows = await getDb().getAllAsync<{ msg_id: string; status: string }>(
      `SELECT msg_id, status FROM outbox WHERE conversation_id = ?`,
      [conversationId],
    );
    const map: Record<string, "pending" | "failed"> = {};
    for (const r of rows) {
      if (r.status === "pending" || r.status === "failed") {
        map[r.msg_id] = r.status;
      }
    }
    return map;
  },
};
