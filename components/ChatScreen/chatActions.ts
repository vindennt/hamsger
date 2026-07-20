import { EncryptedDbMessage, makeConversationId } from "./types";
import {
  markReset,
  resetConversationRatchet,
} from "../../lib/crypto/ratchetRecovery";
import {
  RESET_NOTE_LOCAL,
  makeSystemNote,
  sendSessionReset,
} from "./sessionReset";
import { messageRepo } from "../../lib/database/messageRepository";
import { outboxRepo } from "../../lib/database/outboxRepository";
import { useChatStore } from "../../lib/store/useChatStore";
import {
  getOrCreateRatchetState,
  serializeRatchetState
} from "./ratchetHelpers";
import { saveEncryptedState } from "../../lib/crypto/secureStore";
import { ratchetEncrypt } from "../../lib/crypto/ratchet";
import { withRatchetLock } from "../../lib/crypto/ratchetLock";
import { archiveMessage, type ArchiveInput } from "../../lib/crypto/messageArchive";
import { noteMessageForBackupRefresh } from "../../lib/crypto/backupAutoRefresh";
import { flushOutbox } from "../../lib/outbox/outbox";

/**
 * Manual "Reset session" for the active conversation: wipe local ratchet state so
 * it re-inits from the deterministic session, and signal the peer to do the same.
 * The fallback for when auto-detection misses (or to break a wedged chat by hand).
 */
export async function resetConversation(): Promise<void> {
  const { currentUserId, currentPeer, identities } = useChatStore.getState();
  const peer = identities[currentPeer];
  if (!peer) return;

  const convId = makeConversationId(currentUserId, peer.uuid);
  await withRatchetLock(convId, () =>
    resetConversationRatchet(currentUserId, convId),
  );
  markReset(convId); // start cooldown so the auto-path doesn't immediately re-fire
  useChatStore
    .getState()
    .addMessage(convId, makeSystemNote(convId, RESET_NOTE_LOCAL));
  await sendSessionReset(currentUserId, peer.uuid);
}

export async function sendMessage(inputText: string) {
  if (!inputText.trim()) return;

  const state = useChatStore.getState();
  const {
    currentUser,
    currentUserId,
    currentPeer,
    identities,
    sessions,
    addMessage
  } = state;

  if (!currentPeer) return;

  const recipientIdentity = identities[currentPeer];
  if (!recipientIdentity) return;

  const activeConversationId = [identities[currentUser]?.uuid, recipientIdentity.uuid].sort().join(":");
  const session = sessions[activeConversationId];

  if (!session || !activeConversationId) {
    console.error("Encryption failed or late");
    return;
  }

  const text = inputText.trim();

  // Captured inside the ratchet lock (needs the generated msg id), archived
  // outside it so cloud archiving never blocks the next encrypt.
  let archiveInput: ArchiveInput | null = null;

  // Serialize the ratchet encrypt + state-save + enqueue per conversation so
  // concurrent sends get a monotonically increasing counter `n` (fixes the
  // "out of sequence" bug). The lock is shared with the receive path.
  const enqueued = await withRatchetLock(activeConversationId, async () => {
    let ratchetMsg;
    try {
      const ratchetState = await getOrCreateRatchetState(
        activeConversationId,
        session,
        currentUserId,
        currentUser
      );
      ratchetMsg = await ratchetEncrypt(ratchetState, text, () => {});

      // Save updated ratchet state
      await saveEncryptedState(
        `ratchetState_v3_${currentUserId}_${activeConversationId}`,
        JSON.stringify(serializeRatchetState(ratchetState)),
      );
    } catch (e: any) {
      console.error("Encryption Ratchet Error:", e);
      return null;
    }

    if (!ratchetMsg) return null;

    // Encrypted DB message payload for the server. Fixed at send time and
    // persisted verbatim in the outbox — a retry never re-runs the ratchet.
    const serverDbMsg: EncryptedDbMessage = {
      id: `msg_new_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      conversation_id: activeConversationId,
      sender: currentUser,
      ciphertext: ratchetMsg.ciphertext,
      iv: ratchetMsg.iv,
      auth_tag: ratchetMsg.authTag,
      dh_pub: ratchetMsg.header.DHpub,
      pn: ratchetMsg.header.PN,
      n: ratchetMsg.header.N,
      timestamp: new Date().toISOString(),
      text: ratchetMsg.ciphertext, // Server never sees plaintext
    };

    // Durable outbox row BEFORE any network call: an offline/transient send is
    // now retried until delivered instead of being silently dropped.
    try {
      await outboxRepo.enqueue({
        msg_id: serverDbMsg.id,
        conversation_id: activeConversationId,
        sender_id: currentUserId,
        recipient_id: recipientIdentity.uuid,
        payload: JSON.stringify(serverDbMsg),
      });
    } catch (outboxErr) {
      console.error("Failed to enqueue message to outbox:", outboxErr);
      return null;
    }

    // Local plaintext (kept local only) + optimistic UI, marked pending.
    try {
      await messageRepo.insertMessage({
        id: serverDbMsg.id,
        conversation_id: activeConversationId,
        sender_id: currentUser,
        recipient_id: recipientIdentity.uuid,
        created_at_server: serverDbMsg.timestamp,
        timestamp: new Date().toISOString(),
        local_plaintext: text,
      });
    } catch (dbErr) {
      console.error("Failed to insert sent message to local DB:", dbErr);
    }

    const localDbMsg: EncryptedDbMessage = {
      ...serverDbMsg,
      text,
      isDecrypted: true,
      send_status: "pending",
    } as any;

    addMessage(activeConversationId, localDbMsg);

    archiveInput = {
      msg_id: serverDbMsg.id,
      conversation_id: activeConversationId,
      sender_id: currentUser,
      recipient_id: recipientIdentity.uuid,
      text,
      created_at_server: serverDbMsg.timestamp,
    };
    return true;
  });

  // Deliver outside the lock so a slow network doesn't block the next encrypt.
  // The flusher delivers pending rows per-conversation in order.
  if (enqueued) {
    flushOutbox();
    // Fire-and-forget: stage this message into the durable cloud archive.
    if (archiveInput) {
      archiveMessage(currentUserId, archiveInput).catch((e) =>
        console.error("Failed to archive sent message:", e),
      );
    }
    // Throttled #8: keep the durable ratchet-state backup from going stale.
    noteMessageForBackupRefresh(currentUserId);
  }
}
