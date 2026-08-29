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
import {
  EncryptedDbMessage,
  PrekeyHeader,
  UserIdentity,
  makeConversationId,
} from "./types";

// Target device
// either has ratchet or handshake header
type SendTarget = {
  peerDeviceId: string;
  state: RatchetState;
  header?: PrekeyHeader;
};

async function collectSendTargets(
  userId: string,
  convId: string,
  peer: UserIdentity,
  opts?: { forceHandshakeAll?: boolean },
): Promise<SendTarget[]> {
  const existing = opts?.forceHandshakeAll
    ? []
    : await listRatchetPeerDeviceIds(convId, userId);

  const targets: SendTarget[] = [];
  for (const peerDeviceId of existing) {
    const state = await loadRatchetState(convId, userId, peerDeviceId);
    if (state) targets.push({ peerDeviceId, state });
  }

  try {
    const fresh = await initSessionsAllDevices(userId, peer, {
      skipDeviceIds: new Set(existing),
    });
    for (const [peerDeviceId, est] of fresh) {
      targets.push({ peerDeviceId, state: est.state, header: est.header });
    }
  } catch (e) {
    // if offline, continue as normal
    if (targets.length === 0) throw e;
    console.warn(
      `[chatActions] Peer device discovery failed for ${convId}; sending to known devices only.`,
      e,
    );
  }
  return targets;
}

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
    // retries are device independent
    const baseMsgId = `msg_new_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 6)}`;

    // 1. Resolve the peer devices to deliver to (fan-out).
    let targets: SendTarget[];
    try {
      targets = await collectSendTargets(
        currentUserId,
        activeConversationId,
        recipientIdentity,
      );
    } catch (e) {
      if (e instanceof EncryptedStateUnreadableError) {
        // A known device's ratchet state is unreadable. History can't be kept;
        // reset (cooldown-gated) and re-handshake every device from scratch.
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
        try {
          targets = await collectSendTargets(
            currentUserId,
            activeConversationId,
            recipientIdentity,
            { forceHandshakeAll: true },
          );
        } catch (e2) {
          console.error("Encryption Ratchet Error:", e2);
          return null;
        }
      } else {
        console.error("Encryption Ratchet Error:", e);
        return null;
      }
    }

    if (targets.length === 0) return null;

    // 2. Encrypt once per device (each device-pair is an independent ratchet)
    //    and build the per-device server payload + composite outbox id.
    const timestamp = new Date().toISOString();
    const perDevice: {
      serverDbMsg: EncryptedDbMessage;
      peerDeviceId: string;
    }[] = [];
    for (const t of targets) {
      let ratchetMsg;
      try {
        ratchetMsg = await ratchetEncrypt(t.state, text, () => {});
        await saveEncryptedState(
          ratchetStateKey(currentUserId, activeConversationId, t.peerDeviceId),
          JSON.stringify(serializeRatchetState(t.state)),
        );
      } catch (e) {
        // One device failing (e.g. its OPK pop) must not block the others.
        console.error(
          `[chatActions] Encrypt failed for device ${t.peerDeviceId}:`,
          e,
        );
        continue;
      }
      perDevice.push({
        peerDeviceId: t.peerDeviceId,
        serverDbMsg: {
          id: `${baseMsgId}__${t.peerDeviceId}`,
          conversation_id: activeConversationId,
          sender: currentUser,
          ciphertext: ratchetMsg.ciphertext,
          iv: ratchetMsg.iv,
          auth_tag: ratchetMsg.authTag,
          dh_pub: ratchetMsg.header.DHpub,
          pn: ratchetMsg.header.PN,
          n: ratchetMsg.header.N,
          timestamp,
          text: ratchetMsg.ciphertext, // Server never sees plaintext
          sender_device_id: myDeviceId,
          recipient_device_id: t.peerDeviceId,
          ...(t.header ? { prekey: t.header } : {}),
        },
      });
    }

    if (perDevice.length === 0) return null;

    syncLog("send", activeConversationId, {
      msgId: baseMsgId,
      devices: perDevice.length,
      n: perDevice[0].serverDbMsg.n,
      pn: perDevice[0].serverDbMsg.pn,
      newHandshake: perDevice.some((p) => !!p.serverDbMsg.prekey),
    });

    // 3. Durable outbox row per device BEFORE any network call, so an
    //    offline send is retried per device
    try {
      for (const { serverDbMsg, peerDeviceId } of perDevice) {
        await outboxRepo.enqueue({
          msg_id: serverDbMsg.id,
          base_msg_id: baseMsgId,
          conversation_id: activeConversationId,
          sender_id: currentUserId,
          recipient_id: recipientIdentity.uuid,
          recipient_device_id: peerDeviceId,
          payload: JSON.stringify(serverDbMsg),
        });
      }
    } catch (outboxErr) {
      console.error("Failed to enqueue message to outbox:", outboxErr);
      return null;
    }

    // 4. Local plaintext (kept local only) + optimistic UI, inserted ONCE under
    //    the logical id (not per device).
    try {
      await messageRepo.insertMessage({
        id: baseMsgId,
        conversation_id: activeConversationId,
        sender_id: currentUser,
        recipient_id: recipientIdentity.uuid,
        created_at_server: timestamp,
        timestamp: new Date().toISOString(),
        local_plaintext: text,
      });
    } catch (dbErr) {
      console.error("Failed to insert sent message to local DB:", dbErr);
    }

    const localDbMsg = {
      id: baseMsgId,
      conversation_id: activeConversationId,
      sender: currentUser,
      timestamp,
      text,
      isDecrypted: true,
      send_status: "pending",
    } as unknown as EncryptedDbMessage;
    addMessage(activeConversationId, localDbMsg);

    archiveInput = {
      msg_id: baseMsgId,
      conversation_id: activeConversationId,
      sender_id: currentUser,
      recipient_id: recipientIdentity.uuid,
      text,
      created_at_server: timestamp,
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
