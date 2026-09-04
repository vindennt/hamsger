import { kv } from "../database/kv";

// Device based X3DH (dont backup to general account)

const cache = new Map<string, string>();

function newUuid(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return require("expo-crypto").randomUUID();
}

export async function getDeviceId(userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached) return cached;

  const kvKey = `device_id_${userId}`;
  let id = await kv.get(kvKey);
  if (!id) {
    id = newUuid();
    await kv.set(kvKey, id);
  }
  cache.set(userId, id);
  return id;
}

// TEST ONLY
export function __resetDeviceIdCache(): void {
  cache.clear();
}
