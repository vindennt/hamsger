// Session-scoped, in-memory cache of the recovered backup-wrapping key
// (`kBackupHex`). It is populated whenever the user proves knowledge of the PIN
// or mnemonic (setup-pin, restore-keys, or a manual Settings refresh) and read
// by #8 auto-refresh so the (now slim) backup blob can be re-wrapped WITHOUT
// re-running the memory-hard Argon2id KDF or re-prompting for the PIN.
//
// Security note: this is deliberately NOT persisted (no Keychain / storage) and
// is cleared on sign-out / session expiry, so `kBackupHex` never outlives the
// process. A PIN-free boot leaves the cache empty, in which case auto-refresh is
// a silent no-op (see backupAutoRefresh). This is the accepted trade-off in
// docs/impl/p3-cloud-archive-hybrid.md.
let cached: { userId: string; kBackupHex: string } | null = null;

export const backupKeyCache = {
  set(userId: string, kBackupHex: string): void {
    cached = { userId, kBackupHex };
  },
  // Returns the cached key only for the matching user, so a stale key from a
  // previous account can never be used to re-wrap a different user's backup.
  get(userId: string): string | null {
    return cached && cached.userId === userId ? cached.kBackupHex : null;
  },
  clear(): void {
    cached = null;
  },
};
