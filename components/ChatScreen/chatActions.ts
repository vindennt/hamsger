import { EncryptedDbMessage } from "./types";
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
import { flushOutbox } from "../../lib/outbox/outbox";

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
    return true;
  });

  // Deliver outside the lock so a slow network doesn't block the next encrypt.
  // The flusher delivers pending rows per-conversation in order.
  if (enqueued) {
    flushOutbox();
  }
}
