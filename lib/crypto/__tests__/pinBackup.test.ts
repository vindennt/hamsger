// Tests the PURE crypto fns only (no kv/messageRepo/DB). Keeps AES + KDF real.
// pinBackup.ts imports ../supabase (creates a client at module load and throws
// without env vars) plus the DB repos; the pure crypto fns under test never call
// them, so stub the modules out to keep the import graph pure. See docs/impl/p0-tests.md.
jest.mock("../../supabase", () => ({ supabase: {} }));
jest.mock("../../database/kv", () => ({ kv: {} }));
jest.mock("../../database/messageRepository", () => ({ messageRepo: {} }));

import {
  generateMnemonic,
  mnemonicToSeed,
  encryptKeyBundle,
  decryptKeyBundleWithPIN,
  decryptKeyBundleWithMnemonic,
  refreshBackupBundle,
} from "../pinBackup";

const USER = "user-uuid-1234";
const PIN = "123456";
const BUNDLE = JSON.stringify({
  keyEntries: { ik_priv_user: "deadbeef" },
  ratchetStates: {},
  messageHistory: [],
});

function flipHex(h: string): string {
  const first = h[0] === "a" ? "b" : "a";
  return first + h.slice(1);
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
    expect(await decryptKeyBundleWithMnemonic(payload, seedHex, USER)).toBe(BUNDLE);
  });

  it("fails with the wrong PIN", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    await expect(decryptKeyBundleWithPIN(payload, "000000", USER)).rejects.toThrow();
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
    const tampered = { ...payload, auth_tag_bundle: flipHex(payload.auth_tag_bundle) };
    await expect(decryptKeyBundleWithPIN(tampered, PIN, USER)).rejects.toThrow();
  });
});

describe("refreshBackupBundle", () => {
  it("keeps the wraps, updates the bundle, still decrypts both ways", async () => {
    const { seedHex } = generateMnemonic();
    const payload = await encryptKeyBundle(BUNDLE, PIN, seedHex, USER);
    const NEXT = JSON.stringify({ keyEntries: { ik_priv_user: "cafe" }, ratchetStates: {}, messageHistory: [] });

    const refreshed = await refreshBackupBundle(payload, NEXT, PIN, USER);

    expect(refreshed.wrapped_key_pin).toBe(payload.wrapped_key_pin);
    expect(refreshed.wrapped_key_mnemonic).toBe(payload.wrapped_key_mnemonic);
    expect(await decryptKeyBundleWithPIN(refreshed, PIN, USER)).toBe(NEXT);
    expect(await decryptKeyBundleWithMnemonic(refreshed, seedHex, USER)).toBe(NEXT);
  });
});

// NOTE: when P1b (Argon2id) lands, add a sibling test that a payload carrying
// `kdf:"argon2id"` round-trips, and that a legacy `kdf` absent/"pbkdf2" payload still decrypts.
