// WEB ONLY, one-time. Before P1a, web stored ratchet state (JSON) and message
// local_plaintext as PLAINTEXT in SQLite (getMasterKey() returned null on web).
// Now getMasterKey() is non-null on web, so loadEncryptedState()/getRecentMessages()
// would try to AES-decrypt that legacy plaintext and fail ("[Decryption Failed]", or
// ratchet re-init). This pass re-encrypts legacy plaintext in place exactly once, gated
// on a KV flag, and MUST run before any decrypt on first post-upgrade launch.
// See docs/impl/p1a-web-at-rest.md.
import { type SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import { kv } from "../database/kv";
import { aesEncrypt, getMasterKey } from "./secureStore";

const MIGRATION_FLAG = "web_at_rest_migrated";
const RATCHET_PREFIX = "ratchetState_v3_";

// Our at-rest format is `ivHex.authTagHex.ciphertextHex` — exactly three non-empty hex
// segments. Legacy values (ratchet JSON starts with "{"; message plaintext is arbitrary
// text) don't match, so this reliably distinguishes already-encrypted from legacy.
function looksEncrypted(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 3 && parts.every((p) => p.length > 0 && /^[0-9a-f]+$/i.test(p))
  );
}

export async function migrateWebAtRestIfNeeded(db: SQLiteDatabase): Promise<void> {
  if (Platform.OS !== "web") return;
  if (await kv.get(MIGRATION_FLAG)) return;

  const masterKey = await getMasterKey();
  if (!masterKey) return; // should not happen on web, but never encrypt with no key

  // 1. Ratchet state KV rows: legacy JSON plaintext → AES-GCM.
  const ratchetRows = await kv.getAllByPrefix(RATCHET_PREFIX);
  for (const { key, value } of ratchetRows) {
    if (!looksEncrypted(value)) {
      await kv.set(key, await aesEncrypt(value, masterKey));
    }
  }

  // 2. Message local_plaintext: legacy plaintext → AES-GCM, in place.
  const rows = await db.getAllAsync<{ id: string; local_plaintext: string }>(
    "SELECT id, local_plaintext FROM messages WHERE local_plaintext IS NOT NULL",
  );
  for (const row of rows) {
    if (row.local_plaintext && !looksEncrypted(row.local_plaintext)) {
      const encrypted = await aesEncrypt(row.local_plaintext, masterKey);
      await db.runAsync("UPDATE messages SET local_plaintext = ? WHERE id = ?", [
        encrypted,
        row.id,
      ]);
    }
  }

  await kv.set(MIGRATION_FLAG, "1");
}
