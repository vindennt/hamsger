import { kv } from "../database/kv";
import {
  isSecretKvKey,
  readMaybeEncrypted,
  saveEncryptedState,
} from "./secureStore";

// Device key storage. Secret material (private keys) is AES-GCM encrypted at rest
// under the device master key; public keys stay plaintext (they're published to the
// server anyway, and verifyUserKeysExist reads ik_pub during bootstrap).
export const keystore = {
  async get(key: string): Promise<string | null> {
    // Tolerant read: decrypts secret keys, passes public keys / legacy plaintext through.
    return await readMaybeEncrypted(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (isSecretKvKey(key)) {
      await saveEncryptedState(key, value);
    } else {
      await kv.set(key, value);
    }
  },

  async delete(key: string): Promise<void> {
    await kv.remove(key);
  },
};
