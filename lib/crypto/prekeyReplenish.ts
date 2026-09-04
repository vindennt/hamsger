import { supabase } from "../supabase";
import { keystore } from "./keystore";
import { KeyPair } from "./x3dh";

const MIN_OPK = 5;
const TARGET_OPK = 10;

// Keep counted session in memory
const checkedThisSession = new Set<string>();

export async function refreshDevicePresence(
  userId: string,
  deviceId: string,
): Promise<void> {
  await touchOwnBundle(userId, deviceId);
  await replenishOwnPrekeys(userId, deviceId);
}
async function touchOwnBundle(userId: string, deviceId: string): Promise<void> {
  const { error } = await supabase
    .from("prekey_bundles")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (error)
    console.warn("[prekeyReplenish] touch last_seen failed:", error.message);
}

export async function replenishOwnPrekeys(
  userId: string,
  deviceId: string,
): Promise<void> {
  if (checkedThisSession.has(deviceId)) return;

  const { count, error } = await supabase
    .from("one_time_prekeys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (error) {
    // Leave the guard unset so a later call retries the check.
    console.warn("[prekeyReplenish] count failed:", error.message);
    return;
  }

  checkedThisSession.add(deviceId);

  const current = count ?? 0;
  if (current >= MIN_OPK) return;

  const records: {
    user_id: string;
    device_id: string;
    public_key: string;
  }[] = [];
  for (let i = 0; i < TARGET_OPK - current; i++) {
    const opk = new KeyPair("OPK");
    await keystore.set(`opk_priv_${userId}_${opk.publicKey}`, opk.privateKey);
    records.push({
      user_id: userId,
      device_id: deviceId,
      public_key: opk.publicKey,
    });
  }
  const { error: insErr } = await supabase
    .from("one_time_prekeys")
    .insert(records);
  if (insErr) console.error("[prekeyReplenish] insert failed:", insErr.message);
}

// TEST ONLY
export function __resetReplenishGuard(): void {
  checkedThisSession.clear();
}
