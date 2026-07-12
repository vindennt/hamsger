// Tests the PURE crypto fns only (no kv/messageRepo/DB). Keeps AES + KDF real.
// pinBackup.ts imports ../supabase (creates a client at module load and throws
// without env vars) plus the DB repos; the pure crypto fns under test never call
// them, so stub the modules out to keep the import graph pure. See docs/impl/p0-tests.md.
import {
  __resetArgon2Params,
  __setArgon2ParamsForTests,
  deriveWrappingKeyHex,
} from "../kdf";
import {
  decryptKeyBundleWithMnemonic,
  decryptKeyBundleWithPIN,
  encryptKeyBundle,
  generateMnemonic,
  mnemonicToSeed,
  refreshBackupBundle,
  type BackupPayload,
} from "../pinBackup";
import { toHex, X3DH } from "../x3dh";

jest.mock("../../supabase", () => ({ supabase: {} }));
jest.mock("../../database/kv", () => ({ kv: {} }));
jest.mock("../../database/messageRepository", () => ({ messageRepo: {} }));

const USER = "user-uuid-1234";
const PIN = "123456";
const BUNDLE = JSON.stringify({
  keyEntries: { ik_priv_user: "deadbeef" },
  ratchetStates: {},
  messageHistory: [],
});

// Argon2id at production params (64 MiB) would make this suite slow. Shrink to tiny
// params for tests — correctness of the wiring is independent of cost parameters.
beforeAll(() => __setArgon2ParamsForTests({ t: 2, m: 256, p: 1, dkLen: 32 }));
afterAll(() => __resetArgon2Params());

function flipHex(h: string): string {
  const first = h[0] === "a" ? "b" : "a";
  return first + h.slice(1);
}

// Builds a legacy (pre-Argon2id) payload the way the old code did: PBKDF2-derived
// wraps, bare-userId salt for both, and NO `kdf` field. Used to prove backward compat.
async function makeLegacyPbkdf2Payload(
  bundle: string,
  pin: string,
  seedHex: string,
  userId: string,
): Promise<BackupPayload> {
  const kBackupHex = toHex(
    globalThis.crypto.getRandomValues(new Uint8Array(32)),
  );
  const bundleEnc = await X3DH.encrypt(kBackupHex, bundle);
  const kPinHex = await deriveWrappingKeyHex(pin, userId, "pbkdf2");
  const pinEnc = await X3DH.encrypt(kPinHex, kBackupHex);
  const kMnemonicHex = await deriveWrappingKeyHex(seedHex, userId, "pbkdf2");
  const mnemonicEnc = await X3DH.encrypt(kMnemonicHex, kBackupHex);
  return {
    ciphertext_bundle: bundleEnc.ciphertext,
    iv_bundle: bundleEnc.iv,
    auth_tag_bundle: bundleEnc.authTag,
    wrapped_key_pin: pinEnc.ciphertext,
    iv_pin: pinEnc.iv,
    auth_tag_pin: pinEnc.authTag,
    wrapped_key_mnemonic: mnemonicEnc.ciphertext,
    iv_mnemonic: mnemonicEnc.iv,
    auth_tag_mnemonic: mnemonicEnc.authTag,
    // no kdf field → decrypt paths treat as "pbkdf2"
  };
}

describe("mnemonic", () => {
  it("generates a valid 12-word phrase that round-trips to its seed", () => {
    const { mnemonic, seedHex } = generateMnemonic();
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(mnemonicToSeed(mnemonic)).toBe(seedHex);
  });

  it("rejects wrong word count", () => {
    expect(() => mnemonicToSeed("abandon ability able")).toThrow();
  });

  it("rejects a non-wordlist word", () => {
    const words = generateMnemonic().mnemonic.split(" ");
    words[0] = "zzzzzz";
    expect(() => mnemonicToSeed(words.join(" "))).toThrow();
  });

  it("rejects a tampered checksum (swap last word for another valid word)", () => {
    const words = generateMnemonic().mnemonic.split(" ");
    words[11] = words[11] === "zoo" ? "zone" : "zoo";
    expect(() => mnemonicToSeed(words.join(" "))).toThrow();
  });
});

describe("backup encrypt/decrypt round-trip", () => {
  it("recovers the bundle via BOTH PIN and mnemonic", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    expect(await decryptKeyBundleWithPIN(payload, PIN, USER)).toBe(BUNDLE);
    expect(await decryptKeyBundleWithMnemonic(payload, seedHex, USER)).toBe(
      BUNDLE,
    );
  });

  it("fails with the wrong PIN", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    await expect(
      decryptKeyBundleWithPIN(payload, "000000", USER),
    ).rejects.toThrow();
  });

  it("fails with the wrong mnemonic seed", async () => {
    const { seedHex } = generateMnemonic();
    const other = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    await expect(
      decryptKeyBundleWithMnemonic(payload, other.seedHex, USER),
    ).rejects.toThrow();
  });

  it("fails when the auth tag is tampered", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    const tampered = {
      ...payload,
      auth_tag_bundle: flipHex(payload.auth_tag_bundle),
    };
    await expect(
      decryptKeyBundleWithPIN(tampered, PIN, USER),
    ).rejects.toThrow();
  });
});

describe("refreshBackupBundle", () => {
  it("keeps the wraps, updates the bundle, still decrypts both ways", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    const NEXT = JSON.stringify({
      keyEntries: { ik_priv_user: "cafe" },
      ratchetStates: {},
      messageHistory: [],
    });

    const refreshed = await refreshBackupBundle(payload, NEXT, PIN, USER);

    expect(refreshed.wrapped_key_pin).toBe(payload.wrapped_key_pin);
    expect(refreshed.wrapped_key_mnemonic).toBe(payload.wrapped_key_mnemonic);
    expect(await decryptKeyBundleWithPIN(refreshed, PIN, USER)).toBe(NEXT);
    expect(await decryptKeyBundleWithMnemonic(refreshed, seedHex, USER)).toBe(
      NEXT,
    );
  });
});

describe("kdf versioning (Argon2id + PBKDF2 back-compat)", () => {
  it("stamps new backups as argon2id and decrypts them both ways", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    expect(payload.kdf).toBe("argon2id");
    expect(await decryptKeyBundleWithPIN(payload, PIN, USER)).toBe(BUNDLE);
    expect(await decryptKeyBundleWithMnemonic(payload, seedHex, USER)).toBe(
      BUNDLE,
    );
  });

  it("still decrypts a legacy PBKDF2 backup (no kdf field) both ways", async () => {
    const { seedHex } = generateMnemonic();
    const legacy = await makeLegacyPbkdf2Payload(BUNDLE, PIN, seedHex, USER);
    expect(legacy.kdf).toBeUndefined();
    expect(await decryptKeyBundleWithPIN(legacy, PIN, USER)).toBe(BUNDLE);
    expect(await decryptKeyBundleWithMnemonic(legacy, seedHex, USER)).toBe(
      BUNDLE,
    );
  });

  it("preserves the kdf tag through refresh (no silent upgrade of a legacy backup)", async () => {
    const { seedHex } = generateMnemonic();
    const legacy = await makeLegacyPbkdf2Payload(BUNDLE, PIN, seedHex, USER);
    const NEXT = JSON.stringify({
      keyEntries: {},
      ratchetStates: {},
      messageHistory: [],
    });
    const refreshed = await refreshBackupBundle(legacy, NEXT, PIN, USER);
    expect(refreshed.kdf).toBeUndefined(); // stays PBKDF2; upgrade needs both secrets
    expect(await decryptKeyBundleWithPIN(refreshed, PIN, USER)).toBe(NEXT);
    expect(await decryptKeyBundleWithMnemonic(refreshed, seedHex, USER)).toBe(
      NEXT,
    );
  });
});
