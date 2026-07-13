// Detects a master-key / data desync so the app can route to Restore Keys
// instead of showing a silent "[Decryption Failed]" wall.
//
// Why this can happen (web): the at-rest master key lives in IndexedDB
// (webMasterKey.ts) while the data it encrypts lives in OPFS SQLite. Those are
// independent storage backends — clearing IndexedDB but not OPFS (e.g. Chrome's
// "Clear site data") leaves the ciphertext behind while a brand-new master key is
// minted, so nothing decrypts. Identity keys are stored plaintext and survive, so
// verifyUserKeysExist would otherwise think everything's fine and never offer
// restore. The witness below closes that gap. (Native has an analogous
// Keychain-vs-SQLite lifecycle, so this runs platform-agnostically.)
import { kv } from "../database/kv";
import { messageRepo } from "../database/messageRepository";
import { aesDecrypt, aesEncrypt, getMasterKey } from "./secureStore";

const canaryKey = (userId: string): string => `mk_canary_${userId}`;

// Writes a witness that the CURRENT master key encrypts this device's data.
// Call at the points where the key is authoritative for the local data: fresh
// PIN setup and after a restore.
export async function writeMasterKeyCanary(userId: string): Promise<void> {
  const masterKey = await getMasterKey();
  if (!masterKey) return; // no at-rest encryption → nothing to witness
  await kv.set(canaryKey(userId), await aesEncrypt(userId, masterKey));
}

/**
 * True when the current master key can decrypt this device's at-rest data. A
 * false result means the key desynced from the ciphertext (unrecoverable in
 * place) and the caller should route to Restore Keys.
 */
export async function masterKeyMatchesLocalData(
  userId: string,
): Promise<boolean> {
  const masterKey = await getMasterKey();
  if (!masterKey) return true; // no at-rest encryption → nothing can desync

  const raw = await kv.get(canaryKey(userId));
  if (raw) {
    try {
      return (await aesDecrypt(raw, masterKey)) === userId;
    } catch {
      return false;
    }
  }

  // Pre-canary install: infer health from existing ciphertext, then bootstrap the
  // canary so later boots are a single cheap decrypt.
  const healthy = await localCiphertextDecrypts(userId, masterKey);
  if (healthy) await writeMasterKeyCanary(userId);
  return healthy;
}

// Messages are the durable user data, so they're the authoritative witness: if
// message ciphertext exists and none of it decrypts, the key is desynced even if
// ratchet state happens to decrypt (ratchet is self-healing, messages are not).
async function localCiphertextDecrypts(
  userId: string,
  masterKey: string,
): Promise<boolean> {
  const messages = await messageRepo.sampleEncryptedPlaintext(5);
  if (messages.length > 0) return anyDecrypts(messages, masterKey);

  const ratchet = (await kv.getAllByPrefix(`ratchetState_v3_${userId}`))
    .map((r) => r.value)
    .filter((v): v is string => !!v && v.includes("."));
  if (ratchet.length > 0) return anyDecrypts(ratchet, masterKey);

  return true; // no ciphertext → nothing to contradict
}

async function anyDecrypts(blobs: string[], masterKey: string): Promise<boolean> {
  for (const blob of blobs) {
    try {
      await aesDecrypt(blob, masterKey);
      return true;
    } catch {
      /* try the next blob */
    }
  }
  return false;
}

/**
 * Discards the unreadable local ciphertext (messages + ratchet state + the stale
 * canary) so a subsequent restore repopulates cleanly under the current master
 * key. MUST run before importKeyBundle/restoreArchive: restoreArchive's
 * INSERT OR IGNORE and importKeyBundle's "restore only where none exists" would
 * otherwise keep the stale rows. Harmless no-op on a fresh device (nothing local).
 */
export async function clearLocalEncryptedData(userId: string): Promise<void> {
  await messageRepo.clearAllMessages();
  const ratchet = await kv.getAllByPrefix(`ratchetState_v3_${userId}`);
  for (const { key } of ratchet) await kv.remove(key);
  await kv.remove(canaryKey(userId));
}
