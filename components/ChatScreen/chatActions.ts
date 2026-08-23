import { noteMessageForBackupRefresh } from "../../lib/crypto/backupAutoRefresh";
import { getDeviceId } from "../../lib/crypto/deviceId";
import {
  archiveMessage,
  type ArchiveInput,
} from "../../lib/crypto/messageArchive";
import { RatchetState, ratchetEncrypt } from "../../lib/crypto/ratchet";
import { withRatchetLock } from "../../lib/crypto/ratchetLock";
import {
  hydrateCooldown,
  markReset,
  resetConversationRatchet,
  shouldReset,
} from "../../lib/crypto/ratchetRecovery";
import {
  EncryptedStateUnreadableError,
  saveEncryptedState,
} from "../../lib/crypto/secureStore";
import { messageRepo } from "../../lib/database/messageRepository";
import { outboxRepo } from "../../lib/database/outboxRepository";
import { syncLog } from "../../lib/debug/syncLog";
import { flushOutbox } from "../../lib/outbox/outbox";
import { useChatStore } from "../../lib/store/useChatStore";
import {
  listRatchetPeerDeviceIds,
  loadRatchetState,
  ratchetStateKey,
  serializeRatchetState,
} from "./ratchetHelpers";
import { initSessionsAllDevices } from "./sessionHelpers";
import {
  RESET_NOTE_LOCAL,
  makeSystemNote,
  sendSessionReset,
} from "./sessionReset";
import { EncryptedDbMessage, makeConversationId } from "./types";

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
  syncLog("reset_local", convId, { reason: "manual" });
  useChatStore
    .getState()
    .addMessage(convId, makeSystemNote(convId, RESET_NOTE_LOCAL));
  await sendSessionReset(currentUserId, peer.uuid);
}

export async function sendMessage(inputText: string) {
  if (!inputText.trim()) return;

  const state = useChatStore.getState();
  const { currentUser, currentUserId, currentPeer, identities, addMessage } =
    state;

  if (!currentPeer) return;

  const recipientIdentity = identities[currentPeer];
  if (!recipientIdentity) return;

  const activeConversationId = [
    identities[currentUser]?.uuid,
    recipientIdentity.uuid,
  ]
    .sort()
    .join(":");

  if (!activeConversationId) {
    console.error("Encryption failed or late");
    return;
  }

  const text = inputText.trim();

  const myDeviceId = await getDeviceId(currentUserId);

  // Captured inside the ratchet lock (needs the generated msg id), archived
  // outside it so cloud archiving never blocks the next encrypt.
  let archiveInput: ArchiveInput | null = null;

  // Serialize the ratchet encrypt + state-save + enqueue per conversation so
  // concurrent sends get a monotonically increasing counter `n` (fixes the
  // "out of sequence" bug). The lock is shared with the receive path.
  const enqueued = await withRatchetLock(activeConversationId, async () => {
    let ratchetMsg;
    let prekeyHeader: EncryptedDbMessage["prekey"];
    let peerDeviceId: string | null = null;
    try {
      let ratchetState: RatchetState | null = null;

      const existing = await listRatchetPeerDeviceIds(
        activeConversationId,
        currentUserId,
      );
      if (existing.length > 0) {
        peerDeviceId = existing[0];
        try {
          ratchetState = await loadRatchetState(
            activeConversationId,
            currentUserId,
            peerDeviceId,
          );
        } catch (e) {
          if (!(e instanceof EncryptedStateUnreadableError)) throw e;
          // Local ratchet state exists but is unreadable  Reset instead of starting a new ratchet so that history is preserved
          await hydrateCooldown(activeConversationId);
          if (!shouldReset(activeConversationId, { immediate: true })) {
            console.warn(
              `[chatActions] Ratchet state unreadable for ${activeConversationId} but within reset cooldown; send aborted`,
            );
            return null;
          }
          markReset(activeConversationId);
          syncLog("reset_unreadable", activeConversationId, {});
          await resetConversationRatchet(currentUserId, activeConversationId);
          await messageRepo
            .logError(
              "ratchet_reset",
              activeConversationId,
              null,
              "Local ratchet state unreadable on send; reset and re-handshaked",
            )
            .catch(() => {});
          console.warn(
            `[chatActions] Ratchet state unreadable for ${activeConversationId}; reset and re-handshaking`,
          );
          // reset cleared the device-pair state
          ratchetState = null;
          peerDeviceId = null;
        }
      }

      if (!ratchetState) {
        const sessions = await initSessionsAllDevices(
          currentUserId,
          recipientIdentity,
        );
        const [devId, established] = [...sessions.entries()][0];
        peerDeviceId = devId;
        ratchetState = established.state;
        prekeyHeader = established.header;
      }
      ratchetMsg = await ratchetEncrypt(ratchetState, text, () => {});

      // Save updated ratchet state
      await saveEncryptedState(
        ratchetStateKey(currentUserId, activeConversationId, peerDeviceId!),
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
      sender_device_id: myDeviceId,
      recipient_device_id: peerDeviceId!,
      ...(prekeyHeader ? { prekey: prekeyHeader } : {}),
    };

    syncLog("send", activeConversationId, {
      msgId: serverDbMsg.id,
      n: serverDbMsg.n,
      pn: serverDbMsg.pn,
      dh: serverDbMsg.dh_pub?.slice(0, 8),
      newHandshake: !!prekeyHeader,
    });

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
