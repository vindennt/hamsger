import { type SQLiteDatabase } from "expo-sqlite";

/**
 * Durable ARCHIVE outbox (schema v5, `archive_outbox` table). Stages each
 * message's ciphertext (already AES-256-GCM encrypted under the user's
 * archive_key) until Supabase `message_archive` confirms the insert, so
 * archiving is fire-and-forget with retry and never blocks the chat path.
 * See docs/impl/p3-cloud-archive-hybrid.md and lib/outbox/archiveOutbox.ts.
 *
 * Mirrors the P2 send outbox (lib/database/outboxRepository.ts) but has no
 * per-conversation ordering constraint: archive rows are ordered at read time by
 * `created_at_server`, so the flusher can batch across conversations freely.
 */
export interface ArchiveOutboxRow {
  msg_id: string;
  user_id: string;
  conversation_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at_server: string;
  status: "pending" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
}

let db: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error(
      "[archiveOutboxRepository] Database not initialised. Call setArchiveOutboxDb(db) first.",
    );
  }
  return db;
}

export function setArchiveOutboxDb(database: SQLiteDatabase): void {
  db = database;
}

export const archiveOutboxRepo = {
  /** Stage a pending archive row. Idempotent by msg_id (INSERT OR IGNORE). */
  async enqueue(row: {
    msg_id: string;
    user_id: string;
    conversation_id: string;
    ciphertext: string;
    iv: string;
    auth_tag: string;
    created_at_server: string;
  }): Promise<void> {
    await getDb().runAsync(
      `INSERT OR IGNORE INTO archive_outbox
        (msg_id, user_id, conversation_id, ciphertext, iv, auth_tag, created_at_server, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [
        row.msg_id,
        row.user_id,
        row.conversation_id,
        row.ciphertext,
        row.iv,
        row.auth_tag,
        row.created_at_server,
        new Date().toISOString(),
      ],
    );
  },

  async getPending(limit: number): Promise<ArchiveOutboxRow[]> {
    return getDb().getAllAsync<ArchiveOutboxRow>(
      `SELECT * FROM archive_outbox WHERE status = 'pending'
        ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
  },

  /** Server confirmed the batch — drop the rows (history lives in message_archive). */
  async markDone(msgIds: string[]): Promise<void> {
    if (msgIds.length === 0) return;
    const placeholders = msgIds.map(() => "?").join(", ");
    await getDb().runAsync(
      `DELETE FROM archive_outbox WHERE msg_id IN (${placeholders})`,
      msgIds,
    );
  },

  async bumpAttempts(msgIds: string[]): Promise<void> {
    if (msgIds.length === 0) return;
    const placeholders = msgIds.map(() => "?").join(", ");
    await getDb().runAsync(
      `UPDATE archive_outbox
         SET attempts = attempts + 1, last_attempt_at = ?
       WHERE msg_id IN (${placeholders})`,
      [new Date().toISOString(), ...msgIds],
    );
  },

  /** Give up after too many attempts; excluded from getPending() thereafter. */
  async markFailed(msgIds: string[]): Promise<void> {
    if (msgIds.length === 0) return;
    const placeholders = msgIds.map(() => "?").join(", ");
    await getDb().runAsync(
      `UPDATE archive_outbox SET status = 'failed' WHERE msg_id IN (${placeholders})`,
      msgIds,
    );
  },
};
