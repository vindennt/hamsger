// Pulls from message_archive into local SQLite + store to sync outbound messages to user's devices
//
// TODO: archive-synced rows are trusted (self-authored under the
// owner's key), not re-verified against a per-message signature.
// TODO: `archive_key` is long-lived with no forward secrecy and is
// now on the live sync path, not just the restore path.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { kv } from "../database/kv";
import { messageRepo } from "../database/messageRepository";
import { supabase } from "../supabase";
import { archiveKeyId } from "./messageArchive";
import { readMaybeEncrypted } from "./secureStore";
import { X3DH } from "./x3dh";

export const archiveCursorId = (userId: string): string =>
  `archive_cursor_${userId}`;

// Number of rows to load
const PAGE_SIZE = 50;

// sender_id` = platintext username
interface ArchiveEnvelope {
  sender_id: string;
  recipient_id: string;
  text: string;
}

interface ArchiveRow {
  id: number;
  conversation_id: string;
  msg_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at_server: string;
}

export interface ArchiveSyncInsert {
  convId: string;
  msgId: string;
  sender: string;
  text: string;
  created_at_server: string;
}
async function ingestRow(
  key: string,
  row: ArchiveRow,
): Promise<ArchiveSyncInsert | null> {
  if (await messageRepo.messageExists(row.msg_id)) return null;

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
      `[archiveSync] Skipping undecryptable archive row ${row.msg_id}:`,
      e,
    );
    return null;
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

  return {
    convId: row.conversation_id,
    msgId: row.msg_id,
    sender: envelope.sender_id,
    text: envelope.text,
    created_at_server: row.created_at_server,
  };
}

/**
 * Follow KV sync cursor to inform archive syncing
 * (keyset-paginated by `id`
 * Decrypts each new row and keeps on local SQLite
 */
export async function drainArchive(
  userId: string,
  onInsert?: (insert: ArchiveSyncInsert) => void,
): Promise<number> {
  const key = await readMaybeEncrypted(archiveKeyId(userId));
  if (!key) return 0; // pre-archive account: nothing to decrypt

  let inserted = 0;

  for (;;) {
    const cursor = (await kv.get(archiveCursorId(userId))) ?? "0";
    const { data, error } = await supabase
      .from("message_archive")
      .select(
        "id, conversation_id, msg_id, ciphertext, iv, auth_tag, created_at_server",
      )
      .eq("user_id", userId)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .range(0, PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to drain archive: ${error.message}`);
    const page = (data ?? []) as ArchiveRow[];
    if (page.length === 0) break;

    for (const row of page) {
      const insert = await ingestRow(key, row);
      if (insert) {
        onInsert?.(insert);
        inserted += 1;
      }
    }

    // Advance the cursor AFTER the page is persisted (idempotent re-drain on crash).
    await kv.set(archiveCursorId(userId), String(page[page.length - 1].id));

    if (page.length < PAGE_SIZE) break;
  }

  return inserted;
}

/**
 * Subscribe to INSERTs on the owner's archive so that two powered devices can real time sync
 */
export function subscribeArchive(
  userId: string,
  onInsert: (insert: ArchiveSyncInsert) => void,
): RealtimeChannel {
  const channelName = `message_archive_${userId}_${Date.now()}`;
  return supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "message_archive",
      },
      async (payload) => {
        const row = payload.new as ArchiveRow | undefined;
        if (!row) return;
        const key = await readMaybeEncrypted(archiveKeyId(userId));
        if (!key) return;
        try {
          const insert = await ingestRow(key, row);
          if (insert) onInsert(insert);
        } catch (e) {
          console.error("[archiveSync] Realtime archive insert failed:", e);
        }
      },
    )
    .subscribe();
}
