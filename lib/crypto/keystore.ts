import { kv } from "../database/kv";

//TODO: encryption on mobile and recovery of private keys for device restoration
export const keystore = {
  async get(key: string): Promise<string | null> {
    return await kv.get(key);
  },

  async set(key: string, value: string): Promise<void> {
    await kv.set(key, value);
  },

  async delete(key: string): Promise<void> {
    await kv.remove(key);
  },
};
