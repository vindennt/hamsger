import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { flushArchiveOutbox } from "../../lib/outbox/archiveOutbox";
import { flushOutbox } from "../../lib/outbox/outbox";

// How often to sweep the outbox as a backstop for the event triggers below and
// to service rows that are still within their backoff window.
const FLUSH_INTERVAL_MS = 15_000;

// Flush both durable outboxes together: the send outbox delivers to
// message_queue, the archive outbox delivers to message_archive. Both retry a
// transiently-failed row on the same foreground / reconnect / timer triggers.
function flushAll(): void {
  flushOutbox();
  flushArchiveOutbox();
}

/**
 * Drives delivery of the durable send + archive outboxes. Flushes on mount, on
 * app foreground, on network reconnect (web), and on a periodic backstop timer.
 */
export function useOutbox(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    flushAll();

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") flushAll();
    });

    const interval = setInterval(() => flushAll(), FLUSH_INTERVAL_MS);

    const onOnline = () => flushAll();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onOnline);
    }

    return () => {
      appStateSub.remove();
      clearInterval(interval);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("focus", onOnline);
      }
    };
  }, [enabled]);
}
