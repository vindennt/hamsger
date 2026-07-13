// #8 auto blob-refresh. Keeps AES + KDF real; stubs the modules pinBackup imports
// at load (supabase/kv/messageRepo) since the paths under test don't touch them,
// and spies pinBackup's cloud fns for the orchestration cases. See docs/impl/p3-cloud-archive-hybrid.md.
import { __resetArgon2Params, __setArgon2ParamsForTests } from "../kdf";
import {
  __resetBackupRefreshCounterForTests,
  noteMessageForBackupRefresh,
  refreshBackupNow,
} from "../backupAutoRefresh";
import { backupKeyCache } from "../backupKeyCache";
import * as pinBackup from "../pinBackup";
import {
  decryptKeyBundleWithMnemonic,
  decryptKeyBundleWithPIN,
  encryptKeyBundle,
  generateMnemonic,
  rewrapBundleWithBackupKey,
} from "../pinBackup";
import { toHex, X3DH } from "../x3dh";

jest.mock("../../supabase", () => ({ supabase: {} }));
jest.mock("../../database/kv", () => ({ kv: {} }));
jest.mock("../../database/messageRepository", () => ({ messageRepo: {} }));

const USER = "user-uuid-1234";
const OTHER_USER = "user-uuid-9999";
const PIN = "123456";
const OLD_BUNDLE = JSON.stringify({ keyEntries: { a: "1" }, ratchetStates: {} });
const NEW_BUNDLE = JSON.stringify({ keyEntries: { a: "2" }, ratchetStates: { r: "x" } });
const KHEX = toHex(new Uint8Array(32).fill(7));

// Shrink Argon2id so encrypt/decrypt round-trips are fast; wiring correctness is
// independent of cost params.
beforeAll(() => __setArgon2ParamsForTests({ t: 2, m: 256, p: 1, dkLen: 32 }));
afterAll(() => __resetArgon2Params());

beforeEach(() => {
  jest.restoreAllMocks();
  backupKeyCache.clear();
  __resetBackupRefreshCounterForTests();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("backupKeyCache", () => {
  it("returns the cached key only for the matching user, null otherwise", () => {
    backupKeyCache.set(USER, KHEX);
    expect(backupKeyCache.get(USER)).toBe(KHEX);
    expect(backupKeyCache.get(OTHER_USER)).toBeNull();
    backupKeyCache.clear();
    expect(backupKeyCache.get(USER)).toBeNull();
  });
});

describe("rewrapBundleWithBackupKey", () => {
  it("re-encrypts the bundle while leaving the PIN/mnemonic wraps decryptable", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(OLD_BUNDLE, PIN, seedHex, USER);

    // encryptKeyBundle caches the fresh K_backup; use it to re-wrap a new bundle.
    const cached = backupKeyCache.get(USER);
    expect(cached).toBeTruthy();
    const rewrapped = await rewrapBundleWithBackupKey(payload, NEW_BUNDLE, cached!);

    // Wraps unchanged, so both secrets still recover the (same) K_backup.
    expect(rewrapped.wrapped_key_pin).toBe(payload.wrapped_key_pin);
    expect(rewrapped.wrapped_key_mnemonic).toBe(payload.wrapped_key_mnemonic);
    expect(await decryptKeyBundleWithPIN(rewrapped, PIN, USER)).toBe(NEW_BUNDLE);
    expect(await decryptKeyBundleWithMnemonic(rewrapped, seedHex, USER)).toBe(
      NEW_BUNDLE,
    );
  });
});

describe("refreshBackupNow", () => {
  it("no-ops when no key is cached (PIN-free boot)", async () => {
    const save = jest.spyOn(pinBackup, "saveBackupToCloud");
    const load = jest.spyOn(pinBackup, "loadBackupFromCloud");
    expect(await refreshBackupNow(USER)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("no-ops when no cloud backup exists yet", async () => {
    backupKeyCache.set(USER, KHEX);
    jest.spyOn(pinBackup, "loadBackupFromCloud").mockResolvedValue(null);
    const save = jest.spyOn(pinBackup, "saveBackupToCloud").mockResolvedValue();
    expect(await refreshBackupNow(USER)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("re-wraps the current blob under the cached key and uploads it", async () => {
    const { seedHex } = generateMnemonic();
    const existing = await encryptKeyBundle(OLD_BUNDLE, PIN, seedHex, USER);
    backupKeyCache.set(USER, KHEX);

    jest.spyOn(pinBackup, "loadBackupFromCloud").mockResolvedValue(existing);
    jest.spyOn(pinBackup, "exportKeyBundle").mockResolvedValue(NEW_BUNDLE);
    const save = jest.spyOn(pinBackup, "saveBackupToCloud").mockResolvedValue();

    expect(await refreshBackupNow(USER)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    const savedPayload = save.mock.calls[0][1];
    // Bundle now decrypts under the cached K_backup; wraps preserved.
    expect(savedPayload.wrapped_key_pin).toBe(existing.wrapped_key_pin);
    const plaintext = await X3DH.decrypt(
      KHEX,
      savedPayload.ciphertext_bundle,
      savedPayload.iv_bundle,
      savedPayload.auth_tag_bundle,
    );
    expect(plaintext).toBe(NEW_BUNDLE);
  });
});

describe("noteMessageForBackupRefresh", () => {
  it("triggers exactly one refresh once the message threshold is reached", async () => {
    const { seedHex } = generateMnemonic();
    const existing = await encryptKeyBundle(OLD_BUNDLE, PIN, seedHex, USER);
    backupKeyCache.set(USER, KHEX);

    jest.spyOn(pinBackup, "loadBackupFromCloud").mockResolvedValue(existing);
    jest.spyOn(pinBackup, "exportKeyBundle").mockResolvedValue(NEW_BUNDLE);
    const save = jest.spyOn(pinBackup, "saveBackupToCloud").mockResolvedValue();

    // Below threshold: no upload.
    for (let i = 0; i < 7; i++) noteMessageForBackupRefresh(USER);
    await flush();
    expect(save).not.toHaveBeenCalled();

    // 8th message crosses the threshold.
    noteMessageForBackupRefresh(USER);
    await flush();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
