import { Platform } from "react-native";
import { kv } from "../database/kv";
import { supabase } from "../supabase";

// Diagnostic-only sync logging for the mobile/web multi-device desync
// investigation. Writes structured events to Supabase `debug_logs` (owner-only)
// so mobile traces, where the console is unreachable, can be read from the SQL
// editor. Fire-and-forget: never awaited, never throws, never blocks the
// message path. Kill switch: set ENABLED = false.
const ENABLED = true;

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
  if (!ENABLED) return;
  void (async () => {
    try {
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
