import { kv } from "../database/kv";
import { readMaybeEncrypted } from "./secureStore";

//TODO: encryption on mobile and recovery of private keys for device restoration
export const keystore = {
  async get(key: string): Promise<string | null> {
    // Tolerant read: decrypts secret keys, passes public keys / legacy plaintext through.
    return await readMaybeEncrypted(key);
  },

  async set(key: string, value: string): Promise<void> {
    await kv.set(key, value);
  },

  async delete(key: string): Promise<void> {
    await kv.remove(key);
  },
};
