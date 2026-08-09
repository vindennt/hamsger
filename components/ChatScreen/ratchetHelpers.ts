import {
  deserializeRatchetState,
  RatchetState,
  serializeRatchetState,
} from "../../lib/crypto/ratchet";
import { loadEncryptedState } from "../../lib/crypto/secureStore";
import { ConversationId } from "./types";

/**
 * Loads and deserializes local X3DH or starts a new one if null
 */
export async function loadRatchetState(
  convId: ConversationId,
  userId: string,
): Promise<RatchetState | null> {
  const stateKey = `ratchetState_v3_${userId}_${convId}`;
  const stored = await loadEncryptedState(stateKey);
  if (!stored) return null;

  try {
    return deserializeRatchetState(JSON.parse(stored));
  } catch (e) {
    console.error("Failed to parse stored ratchet state for " + convId, e);
    return null;
  }
}

export { deserializeRatchetState, serializeRatchetState };
