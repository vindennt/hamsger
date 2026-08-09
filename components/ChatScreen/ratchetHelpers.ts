import {
  deserializeRatchetState,
  RatchetState,
  serializeRatchetState,
} from "../../lib/crypto/ratchet";
import {
  EncryptedStateUnreadableError,
  loadEncryptedStateStrict,
} from "../../lib/crypto/secureStore";
import { ConversationId } from "./types";

/**
 * Loads and deserializes the stored ratchet state. Returns null ONLY when no
 * state exists yet. Do not abandon existing history in case
 */
export async function loadRatchetState(
  convId: ConversationId,
  userId: string,
): Promise<RatchetState | null> {
  const stateKey = `ratchetState_v3_${userId}_${convId}`;
  const stored = await loadEncryptedStateStrict(stateKey);
  if (!stored) return null;

  try {
    return deserializeRatchetState(JSON.parse(stored));
  } catch (e) {
    throw new EncryptedStateUnreadableError(stateKey, e);
  }
}

export { deserializeRatchetState, serializeRatchetState };
