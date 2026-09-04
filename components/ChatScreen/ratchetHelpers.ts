import {
  deserializeRatchetState,
  RatchetState,
  serializeRatchetState,
} from "../../lib/crypto/ratchet";
import {
  EncryptedStateUnreadableError,
  loadEncryptedStateStrict,
} from "../../lib/crypto/secureStore";
import { kv } from "../../lib/database/kv";
import { ConversationId } from "./types";

// KV key per device
export function ratchetStateKey(
  userId: string,
  convId: ConversationId,
  peerDeviceId: string,
): string {
  return `ratchetState_v3_${userId}_${convId}_${peerDeviceId}`;
}

/**
 * Loads and deserializes the stored ratchet state for one peer device. Returns
 * null ONLY when no state exists yet. Do not abandon existing history in case
 */
export async function loadRatchetState(
  convId: ConversationId,
  userId: string,
  peerDeviceId: string,
): Promise<RatchetState | null> {
  const stateKey = ratchetStateKey(userId, convId, peerDeviceId);
  const stored = await loadEncryptedStateStrict(stateKey);
  if (!stored) return null;

  try {
    return deserializeRatchetState(JSON.parse(stored));
  } catch (e) {
    throw new EncryptedStateUnreadableError(stateKey, e);
  }
}

/**
 * Get device ids we already hold a ratchet for in local KV keyspace. Reduces RTTs to get them again
 */
export async function listRatchetPeerDeviceIds(
  convId: ConversationId,
  userId: string,
): Promise<string[]> {
  const prefix = `ratchetState_v3_${userId}_${convId}_`;
  const rows = await kv.getAllByPrefix(prefix);
  // _ is single char wildcard
  return rows
    .filter((r) => r.key.startsWith(prefix))
    .map((r) => r.key.slice(prefix.length));
}

export { deserializeRatchetState, serializeRatchetState };
