// Stage 1 of keystore at-rest (item 6c): the secret-key predicate and the
// tolerant reader's legacy-plaintext branch. The decrypt branch delegates to
// aesDecrypt (covered end-to-end by the migration + pinBackup tests). Uses an
// in-memory kv. See lib/crypto/secureStore.ts.
const mockStore = new Map<string, string>();
jest.mock("../../database/kv", () => ({
  kv: {
    get: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
  },
}));

/* eslint-disable import/first */
import { isSecretKvKey, readMaybeEncrypted } from "../secureStore";

const USER = "user-uuid-1234";

beforeEach(() => {
  mockStore.clear();
});

describe("isSecretKvKey", () => {
  it("flags private key material and archive_key", () => {
    for (const k of [
      `ik_priv_${USER}`,
      `spk_priv_${USER}`,
      `sig_priv_${USER}`,
      `opk_priv_${USER}_pub1`,
      `archive_key_${USER}`,
    ]) {
      expect(isSecretKvKey(k)).toBe(true);
    }
  });

  it("leaves public keys and unrelated keys plaintext", () => {
    for (const k of [
      `ik_pub_${USER}`,
      `spk_pub_${USER}`,
      `sig_pub_${USER}`,
      "web_at_rest_migrated",
    ]) {
      expect(isSecretKvKey(k)).toBe(false);
    }
  });
});

describe("readMaybeEncrypted", () => {
  it("returns null for a missing key", async () => {
    expect(await readMaybeEncrypted(`ik_priv_${USER}`)).toBeNull();
  });

  it("passes legacy plaintext (no iv.tag.ct format) straight through", async () => {
    mockStore.set(`ik_priv_${USER}`, "deadbeef");
    expect(await readMaybeEncrypted(`ik_priv_${USER}`)).toBe("deadbeef");
  });
});
