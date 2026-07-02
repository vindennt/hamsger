import { type SQLiteDatabase } from "expo-sqlite";
import { aesDecrypt, aesEncrypt, getMasterKey } from "../crypto/secureStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a row in the `messages` table. */
export interface MessageRow {
  /** Unique message identifier (UUID). */
  id: string;
  /** Conversation this message belongs to. */
  conversation_id: string;
  /** User ID of the sender. */
  sender_id: string;
  /** User ID of the recipient. */
  recipient_id: string;
  /** UTC ISO-8601 timestamp assigned by the server (Supabase). */
  created_at_server: string;
  /** Client-side timestamp at send time. */
  timestamp: string;
  /** Decrypted plaintext encrypted at rest with device AES key */
  local_plaintext?: string;
}

/** Shape of a row in the `errors` table. */
export interface ErrorRow {
  /** Auto-incremented error ID. */
  id: number;
  /** Error category (e.g. "decryption", "delivery", "ratchet"). */
  type: string;
  /** Optional conversation context. */
  conversation_id: string | null;
  /** Optional message context. */
  message_id: string | null;
  /** Human-readable error description / stack trace. */
  error: string;
  /** UTC timestamp when the error was recorded. */
  created_at: string;
}

/**
 * Parameters accepted by {@link messageRepo.insertMessage}.
 * Identical to {@link MessageRow} — kept as a separate type so call-sites
 * don't need to depend on the DB row shape.
 */
export type InsertMessageParams = MessageRow;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Holds the SQLite database reference once initialised. */
let db: SQLiteDatabase | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the active database handle or throws if it hasn't been set yet.
 * Centralises the null-check so every public method stays lean.
 */
function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error(
      "[messageRepository] Database not initialised. Call setMessageDb(db) first.",
    );
  }
  return db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Binds the SQLite database instance used by the message repository.
 * Must be called once during app startup (typically inside
 * `<DatabaseInitializer>`).
 *
 * @param database - The open `SQLiteDatabase` handle from expo-sqlite.
 */
export function setMessageDb(database: SQLiteDatabase): void {
  db = database;
}

/**
 * Singleton message repository.
 *
 * All methods use the **async** SQLite API (`runAsync`, `getAllAsync`,
 * `getFirstAsync`). This is intentional:
 *
 *   thread on iOS/Android, keeping the JS thread free for UI work.
 * - **Uniform API** — all platforms behave identically.
 */
export const messageRepo = {
  // -----------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------

  /**
   * Persists a ciphertext-only message row.
   *
   * Uses `INSERT OR IGNORE` so duplicate message IDs (e.g. from replayed
   * real-time events) are silently skipped — this makes the operation
   * idempotent.
   *
   * @param msg - All fields required for the `messages` table.
   */
  async insertMessage(msg: InsertMessageParams): Promise<void> {
    let encryptedPlaintext: string | null = null;
    if (msg.local_plaintext) {
      const masterKey = await getMasterKey();
      if (masterKey) {
        encryptedPlaintext = await aesEncrypt(msg.local_plaintext, masterKey);
      } else {
        encryptedPlaintext = msg.local_plaintext;
      }
    }

    await getDb().runAsync(
      `INSERT OR IGNORE INTO messages
        (id, conversation_id, sender_id, recipient_id, created_at_server, timestamp, local_plaintext)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.conversation_id,
        msg.sender_id,
        msg.recipient_id,
        msg.created_at_server,
        msg.timestamp,
        encryptedPlaintext,
      ],
    );
  },

  /**
   * Returns the most recent messages for a conversation, ordered newest
   * first.
   *
   * Uses the `idx_messages_conv_created` composite index for efficient
   * pagination.
   *
   * @param conversationId - The conversation to query.
   * @param limit          - Maximum number of rows to return (default 30).
   * @param offset         - Number of rows to skip (default 0).
   * @returns A promise resolving to an array of {@link MessageRow} objects.
   */
  async getRecentMessages(
    conversationId: string,
    limit: number = 30,
    offset: number = 0,
  ): Promise<MessageRow[]> {
    const rows = await getDb().getAllAsync<MessageRow>(
      `SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at_server DESC
        LIMIT ? OFFSET ?`,
      [conversationId, limit, offset],
    );

    const masterKey = await getMasterKey();
    for (const row of rows) {
      if (row.local_plaintext) {
        if (masterKey) {
          try {
            row.local_plaintext = await aesDecrypt(
              row.local_plaintext,
              masterKey,
            );
          } catch {
            row.local_plaintext = "[Decryption Failed]";
          }
        } else {
          // Native encrypts loaclly becayse of secure enclave
          // Web does not, and does not use dot structure, so we should not render natively encrypted text since it would be unreadable
          // TODO: Make sure text cross platform is readable on web and native
          if (row.local_plaintext.includes(".")) {
            row.local_plaintext = "[Encrypted on Native]";
          }
        }
      }
    }
    return rows;
  },

  /**
   * Fetches a single message by its unique ID.
   *
   * @param id - The message UUID.
   * @returns A promise resolving to the matching {@link MessageRow}, or
   *   `null` if not found.
   */
  async getMessageById(id: string): Promise<MessageRow | null> {
    const row = await getDb().getFirstAsync<MessageRow>(
      "SELECT * FROM messages WHERE id = ?",
      [id],
    );
    if (row && row.local_plaintext) {
      const masterKey = await getMasterKey();
      if (masterKey) {
        try {
          row.local_plaintext = await aesDecrypt(
            row.local_plaintext,
            masterKey,
          );
        } catch {
          row.local_plaintext = "[Decryption Failed]";
        }
      } else {
        if (row.local_plaintext.includes(".")) {
          row.local_plaintext = "[Encrypted on Native]";
        }
      }
    }
    return row;
  },

  // -----------------------------------------------------------------------
  // Error logging
  // -----------------------------------------------------------------------

  /**
   * Records a structured error entry in the `errors` table.
   *
   * Use this to capture decryption failures, ratchet mismatches, delivery
   * errors, etc. for later diagnostics.
   *
   * @param type           - Error category (e.g. "decryption", "delivery").
   * @param conversationId - Related conversation ID, or `null`.
   * @param messageId      - Related message ID, or `null`.
   * @param error          - Human-readable description or serialised stack.
   */
  async logError(
    type: string,
    conversationId: string | null,
    messageId: string | null,
    error: string,
  ): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO errors (type, conversation_id, message_id, error)
       VALUES (?, ?, ?, ?)`,
      [type, conversationId, messageId, error],
    );
  },

  /**
   * Returns the most recent error entries, newest first.
   *
   * @param limit - Maximum number of rows to return (default 50).
   * @returns A promise resolving to an array of {@link ErrorRow} objects.
   */
  async getErrors(limit: number = 50): Promise<ErrorRow[]> {
    return getDb().getAllAsync<ErrorRow>(
      "SELECT * FROM errors ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
  },

  // Returns all messages with local_plaintext decrypted from the device key,
  // so the result is portable to other devices via the backup bundle.
  async getAllMessagesDecrypted(): Promise<MessageRow[]> {
    const rows = await getDb().getAllAsync<MessageRow>(
      "SELECT * FROM messages ORDER BY created_at_server ASC",
    );
    const masterKey = await getMasterKey();
    for (const row of rows) {
      if (row.local_plaintext && masterKey) {
        try {
          row.local_plaintext = await aesDecrypt(row.local_plaintext, masterKey);
        } catch {
          row.local_plaintext = undefined;
        }
      }
    }
    return rows;
  },
};
