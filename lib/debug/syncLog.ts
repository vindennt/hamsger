import { Platform } from "react-native";
import { kv } from "../database/kv";
import { supabase } from "../supabase";

const FLAG_KEY = "debug_logging_enabled";

let enabledCache: boolean | null = null;

async function isEnabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  const v = await kv.get(FLAG_KEY).catch(() => null);
  enabledCache = v === "1";
  return enabledCache;
}

export async function getSyncLoggingEnabled(): Promise<boolean> {
  return isEnabled();
}

export async function setSyncLoggingEnabled(on: boolean): Promise<void> {
  enabledCache = on;
  await kv.set(FLAG_KEY, on ? "1" : "0");
}

// Stable per-device tag so the two devices of one account are distinguishable
// in the logs. Persisted in KV, cached in memory after first read.
let deviceIdCache: string | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  let id = await kv.get("debug_device_id").catch(() => null);
  if (!id) {
    id = `${Platform.OS}-${Math.random().toString(36).slice(2, 8)}`;
    await kv.set("debug_device_id", id).catch(() => {});
  }
  deviceIdCache = id;
  return id;
}

export function syncLog(
  event: string,
  conversationId: string | null,
  detail?: Record<string, unknown>,
): void {
  void (async () => {
    try {
      if (!(await isEnabled())) return;
      const device = await getDeviceId();
      await supabase.from("debug_logs").insert({
        device,
        event,
        conversation_id: conversationId,
        detail: detail ? JSON.stringify(detail) : null,
      });
    } catch {
      // diagnostic only; swallow so logging never disrupts messaging
    }
  })();
}
