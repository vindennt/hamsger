import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { refreshBackupNow } from "../../lib/crypto/backupAutoRefresh";

/**
 * Fires a best-effort #8 backup refresh when the app is backgrounded / the web
 * tab is hidden, as a natural checkpoint on top of the message-count throttle.
 * A no-op unless the backup-wrapping key is cached from a PIN/mnemonic entry this
 * session (see backupAutoRefresh). fire-and-forget; safe if the tab is closing.
 */
export function useBackupAutoRefresh(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        void refreshBackupNow(userId);
      }
    });

    let removeWeb: (() => void) | undefined;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const onHidden = () => {
        if (document.visibilityState === "hidden") void refreshBackupNow(userId);
      };
      const onPageHide = () => void refreshBackupNow(userId);
      document.addEventListener("visibilitychange", onHidden);
      window.addEventListener("pagehide", onPageHide);
      removeWeb = () => {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onPageHide);
      };
    }

    return () => {
      appStateSub.remove();
      removeWeb?.();
    };
  }, [userId]);
}
