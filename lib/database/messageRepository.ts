import { type SQLiteDatabase } from "expo-sqlite";
import { aesDecrypt, aesEncrypt, getMasterKey } from "../crypto/secureStore";

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  created_at_server: string;
  timestamp: string;
  local_plaintext?: string;
}

export interface ErrorRow {
  id: number;
  type: string;
  conversation_id: string | null;
  message_id: string | null;
  error: string;
  created_at: string;
}

let db: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error(
      "[messageRepository] Database not initialised. Call setMessageDb(db) first.",
    );
  }
  return db;
}

export function setMessageDb(database: SQLiteDatabase): void {
  db = database;
}

export const messageRepo = {
  async messageExists(id: string): Promise<boolean> {
    const row = await getDb().getFirstAsync<{ id: string }>(
      "SELECT id FROM messages WHERE id = ? LIMIT 1",
      [id],
    );
    return row !== null;
  },

  async insertMessage(msg: MessageRow): Promise<void> {
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
          if (row.local_plaintext.includes(".")) {
            row.local_plaintext = "[Encrypted on Native]";
          }
        }
      }
    }
    return rows;
  },

  // Returns up to `limit` raw (still-encrypted) local_plaintext blobs, for the
  // master-key desync check — we only need to know whether the current key can
  // decrypt them, not their contents. Filters to the encrypted `iv.tag.ct` form.
  async sampleEncryptedPlaintext(limit: number = 5): Promise<string[]> {
    const rows = await getDb().getAllAsync<{ local_plaintext: string | null }>(
      "SELECT local_plaintext FROM messages WHERE local_plaintext IS NOT NULL LIMIT ?",
      [limit],
    );
    return rows
      .map((r) => r.local_plaintext)
      .filter((v): v is string => !!v && v.includes("."));
  },

  // Discards all local messages. Used on desync recovery so a restore repopulates
  // cleanly (restoreArchive's INSERT OR IGNORE would otherwise keep stale rows).
  async clearAllMessages(): Promise<void> {
    await getDb().runAsync("DELETE FROM messages");
  },

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
