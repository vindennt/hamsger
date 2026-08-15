import { ratchetDecrypt } from "../../lib/crypto/ratchet";
import { saveEncryptedState } from "../../lib/crypto/secureStore";
import { messageRepo } from "../../lib/database/messageRepository";
import { loadRatchetState, serializeRatchetState } from "./ratchetHelpers";
import { establishResponderSession } from "./sessionHelpers";
import { ConversationId, EncryptedDbMessage } from "./types";

export type InboundResult =
  | { status: "skipped" } // Already stored
  | { status: "no_state" } // No session locally
  | { status: "stored"; plaintext: string };

/**
 * Ratchet advancer
 * Call in withRatchetLock() so everything is serialized
 * KEEP WATCH HERE. Previously known bug of duped reads
 */
export async function decryptStoreInbound(
  convId: ConversationId,
  userId: string,
  msg: EncryptedDbMessage,
  trustedSender: string,
): Promise<InboundResult> {
  // duplicate delivery is skipped before
  // the ratchet is touched, so it can't decrypt against an advanced state and start desync recovery when uncessary
  if (await messageRepo.messageExists(msg.id)) return { status: "skipped" };

  const state = msg.prekey
    ? await establishResponderSession(userId, msg.prekey)
    : await loadRatchetState(convId, userId);
  if (!state) return { status: "no_state" };

  const ratchetMsg = {
    header: { DHpub: msg.dh_pub, PN: msg.pn, N: msg.n },
    ciphertext: msg.ciphertext,
    iv: msg.iv,
    authTag: msg.auth_tag,
  };
  const plaintext = await ratchetDecrypt(state, ratchetMsg, () => {});

  await saveEncryptedState(
    `ratchetState_v3_${userId}_${convId}`,
    JSON.stringify(serializeRatchetState(state)),
  );

  try {
    await messageRepo.insertMessage({
      id: msg.id,
      conversation_id: convId,
      sender_id: trustedSender,
      recipient_id: userId,
      created_at_server: msg.timestamp,
      timestamp: new Date().toISOString(),
      local_plaintext: plaintext,
    });
  } catch (dbErr) {
    console.error(
      "[inboundMessage] Failed to insert decrypted message to DB:",
      dbErr,
    );
  }

  return { status: "stored", plaintext };
}
