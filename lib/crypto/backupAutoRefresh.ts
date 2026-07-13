// #8 auto blob-refresh (docs/impl/p3-cloud-archive-hybrid.md).
//
// The backup blob now holds only identity keys + `archive_key` + ratchet state
// (history lives in the incremental cloud archive), so it stays tiny and cheap
// to re-upload. This keeps the durable copy of the *ratchet state* fresh so a
// restore doesn't fall too far behind, and it closes the existing-user gap where
// a freshly generated `archive_key` only reaches the cloud on the next manual
// backup.
//
// Constraint: re-wrapping the blob needs `kBackupHex`, recoverable only via the
// PIN (memory-hard Argon2id) or mnemonic. We therefore never re-derive it here;
// we reuse the session cache populated on PIN/mnemonic entry (backupKeyCache).
// If the user booted without entering their PIN this session the cache is empty
// and refresh is a silent no-op — the security-correct behaviour (we won't cache
// the PIN or persist the key). Throttled so we don't re-upload on every message.
import { backupKeyCache } from "./backupKeyCache";
import {
  exportKeyBundle,
  loadBackupFromCloud,
  rewrapBundleWithBackupKey,
  saveBackupToCloud,
} from "./pinBackup";

// Refresh after this many messages (sent or received). Small because the blob is
// only a few KB; the point is bounded staleness of ratchet state, not batching.
const REFRESH_EVERY_MESSAGES = 8;

let messagesSinceRefresh = 0;
let refreshing = false;

/**
 * Count one message toward the throttle and trigger a refresh once the threshold
 * is hit. Fire-and-forget: never blocks or fails the chat path. Call from both
 * the send and receive paths after the message is persisted + archived.
 */
export function noteMessageForBackupRefresh(userId: string): void {
  messagesSinceRefresh += 1;
  if (messagesSinceRefresh >= REFRESH_EVERY_MESSAGES) {
    messagesSinceRefresh = 0;
    void refreshBackupNow(userId);
  }
}

/**
 * Re-wrap the current backup blob with the session-cached K_backup and upload it.
 * No-op (returns false) when the key isn't cached (no PIN entered this session),
 * when no backup exists yet, or when a refresh is already in flight. Errors are
 * swallowed (logged) so this is always safe to call fire-and-forget.
 */
export async function refreshBackupNow(userId: string): Promise<boolean> {
  const kBackupHex = backupKeyCache.get(userId);
  if (!kBackupHex) return false;
  if (refreshing) return false;
  refreshing = true;
  try {
    const existing = await loadBackupFromCloud(userId);
    if (!existing) return false; // backup not set up yet
    const bundle = await exportKeyBundle(userId);
    const payload = await rewrapBundleWithBackupKey(existing, bundle, kBackupHex);
    await saveBackupToCloud(userId, payload);
    messagesSinceRefresh = 0;
    return true;
  } catch (e) {
    console.error("[backupAutoRefresh] Auto-refresh failed:", e);
    return false;
  } finally {
    refreshing = false;
  }
}

// Test-only: reset the module counter between cases.
export function __resetBackupRefreshCounterForTests(): void {
  messagesSinceRefresh = 0;
  refreshing = false;
}
