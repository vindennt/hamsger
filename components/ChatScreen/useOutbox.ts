import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { flushOutbox } from "../../lib/outbox/outbox";

// How often to sweep the outbox as a backstop for the event triggers below and
// to service rows that are still within their backoff window.
const FLUSH_INTERVAL_MS = 15_000;

/**
 * Drives delivery of the durable send outbox. Flushes on mount, on app
 * foreground, on network reconnect (web), and on a periodic backstop timer.
 */
export function useOutbox(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    flushOutbox();

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") flushOutbox();
    });

    const interval = setInterval(() => flushOutbox(), FLUSH_INTERVAL_MS);

    const onOnline = () => flushOutbox();
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
