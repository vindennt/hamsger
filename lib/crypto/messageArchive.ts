// Hybrid cloud archive (docs/impl/p3-cloud-archive-hybrid.md).
//
// History is stored as an append-only, per-message encrypted archive on Supabase
// (`message_archive`) instead of being re-serialized into the monolithic backup
// blob on every refresh. Each message is encrypted under a dedicated long-lived
// `archive_key` (32 random bytes, generated once at setup) that rides inside the
// Argon2id-wrapped backup blob, so it is restorable but never leaves the device.
// The server sees only ciphertext → content zero-knowledge is preserved.
//
// Forward-secrecy note: like the old blob, recoverable cloud history inherently
// stores plaintext under a durable key. `archive_key` must therefore be protected
// exactly like the backup (it lives inside the Argon2id-wrapped blob). It must
// never be rotated while archive rows exist, or those rows become undecryptable.
import { kv } from "../database/kv";
import { archiveOutboxRepo } from "../database/archiveOutboxRepository";
import { messageRepo } from "../database/messageRepository";
import { supabase } from "../supabase";
import { flushArchiveOutbox } from "../outbox/archiveOutbox";
import { readMaybeEncrypted, saveEncryptedState } from "./secureStore";
import { toHex, X3DH } from "./x3dh";

// KV keys. `archive_key_${userId}` is deliberately backed up by exportKeyBundle;
// the backfill flag is device-local and NOT backed up.
export const archiveKeyId = (userId: string): string =>
  `archive_key_${userId}`;
const backfilledFlag = (userId: string): string =>
  `archive_backfilled_${userId}`;

// The plaintext we encrypt per message. sender/recipient ride inside the
// ciphertext (the server only needs conversation_id + msg_id + timing to store
// and order the row), so a restore can fully reconstruct the local message row.
interface ArchiveEnvelope {
  sender_id: string;
  recipient_id: string;
  text: string;
}

export interface ArchiveInput {
  msg_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  created_at_server: string;
}

function getRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * Returns the user's archive key, generating and persisting a fresh 32-byte key
 * on first use. The key is long-lived: never regenerate it while archive rows
 * exist (that would orphan every prior row). New keys are captured by the next
 * backup via exportKeyBundle; setup-pin calls this before the first export.
 */
export async function ensureArchiveKey(userId: string): Promise<string> {
  const existing = await readMaybeEncrypted(archiveKeyId(userId));
  if (existing) return existing;
  const key = toHex(getRandomBytes(32));
  await saveEncryptedState(archiveKeyId(userId), key);
  return key;
}

/**
 * Encrypt one message under the archive key and stage it in the durable archive
 * outbox. Fire-and-forget with retry: the flusher batch-delivers to the cloud so
 * archiving never blocks or fails the chat path. Idempotent by msg_id (the
 * outbox INSERT OR IGNORE + the server's unique(user_id,msg_id) both dedupe).
 *
 * Pass `flush: false` for bulk callers (backfill) that flush once at the end.
 */
export async function archiveMessage(
  userId: string,
  input: ArchiveInput,
  flush: boolean = true,
): Promise<void> {
  const key = await ensureArchiveKey(userId);
  const envelope: ArchiveEnvelope = {
    sender_id: input.sender_id,
    recipient_id: input.recipient_id,
    text: input.text,
  };
  const { ciphertext, iv, authTag } = await X3DH.encrypt(
    key,
    JSON.stringify(envelope),
  );

  await archiveOutboxRepo.enqueue({
    msg_id: input.msg_id,
    user_id: userId,
    conversation_id: input.conversation_id,
    ciphertext,
    iv,
    auth_tag: authTag,
    created_at_server: input.created_at_server,
  });

  if (flush) void flushArchiveOutbox();
}

/**
 * One-time migration for users whose history predates the archive: stage every
 * existing local message into the archive outbox. Gated behind a device-local KV
 * flag so it runs at most once; dedup is handled by the outbox + server unique
 * constraint even if it runs again. Callers must ensure `archive_key` exists and
 * is persisted (backed up) BEFORE backfilling.
 */
export async function backfillArchive(userId: string): Promise<void> {
  if (await kv.get(backfilledFlag(userId))) return;

  await ensureArchiveKey(userId);
  const rows = await messageRepo.getAllMessagesDecrypted();

  for (const row of rows) {
    if (!row.local_plaintext) continue;
    await archiveMessage(
      userId,
      {
        msg_id: row.id,
        conversation_id: row.conversation_id,
        sender_id: row.sender_id,
        recipient_id: row.recipient_id,
        text: row.local_plaintext,
        created_at_server: row.created_at_server,
      },
      false,
    );
  }

  await kv.set(backfilledFlag(userId), "1");
  void flushArchiveOutbox();
}

const RESTORE_PAGE_SIZE = 200;

interface ArchiveRow {
  conversation_id: string;
  msg_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at_server: string;
}

/**
 * Cursor-paginate the user's cloud archive (newest first), decrypt each row with
 * the restored archive_key, and re-insert into local SQLite (INSERT OR IGNORE via
 * messageRepo.insertMessage). Call after importKeyBundle has restored the keys.
 */
export async function restoreArchive(userId: string): Promise<number> {
  const key = await readMaybeEncrypted(archiveKeyId(userId));
  if (!key) return 0; // pre-archive backup: history (if any) came from the blob

  let restored = 0;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("message_archive")
      .select("conversation_id, msg_id, ciphertext, iv, auth_tag, created_at_server")
      .eq("user_id", userId)
      .order("created_at_server", { ascending: false })
      .range(from, from + RESTORE_PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load archive: ${error.message}`);
    const page = (data ?? []) as ArchiveRow[];
    if (page.length === 0) break;

    for (const row of page) {
      let envelope: ArchiveEnvelope;
      try {
        const plaintext = await X3DH.decrypt(
          key,
          row.ciphertext,
          row.iv,
          row.auth_tag,
        );
        envelope = JSON.parse(plaintext) as ArchiveEnvelope;
      } catch (e) {
        console.warn(
          `[messageArchive] Skipping undecryptable archive row ${row.msg_id}:`,
          e,
        );
        continue;
      }

      await messageRepo.insertMessage({
        id: row.msg_id,
        conversation_id: row.conversation_id,
        sender_id: envelope.sender_id,
        recipient_id: envelope.recipient_id,
        created_at_server: row.created_at_server,
        timestamp: new Date().toISOString(),
        local_plaintext: envelope.text,
      });
      restored += 1;
    }

    if (page.length < RESTORE_PAGE_SIZE) break;
    from += RESTORE_PAGE_SIZE;
  }

  return restored;
}
