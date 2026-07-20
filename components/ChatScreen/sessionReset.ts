// Shared bits for session-reset recovery, used by both the automatic path
// (SessionManager) and the manual "Reset session" control (chatActions/ChatHeader).
import { SESSION_RESET_TYPE } from "../../lib/crypto/ratchetRecovery";
import { supabase } from "../../lib/supabase";
import { EncryptedDbMessage } from "./types";

export const RESET_NOTE_LOCAL =
  "🔒 Secure session was reset — some earlier messages may be missing.";
export const RESET_NOTE_PEER = "🔒 The other device reset the secure session.";

// Tell the peer to re-establish the session. Carries no ciphertext/secret; RLS
// restricts message_queue inserts to accepted friends with auth.uid() = sender_id.
export async function sendSessionReset(
  senderId: string,
  recipientId: string,
): Promise<void> {
  const { error } = await supabase.from("message_queue").insert({
    sender_id: senderId,
    recipient_id: recipientId,
    payload: { type: SESSION_RESET_TYPE },
  });
  if (error)
    console.warn("[sessionReset] Failed to send session reset:", error);
}

// In-thread system note (in-memory only). addMessage dedupes by id + sorts by ts.
export function makeSystemNote(
  convId: string,
  text: string,
): EncryptedDbMessage {
  return {
    id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: convId,
    sender: "system",
    timestamp: new Date().toISOString(),
    text,
    system: true,
    isDecrypted: true,
  } as any;
}
