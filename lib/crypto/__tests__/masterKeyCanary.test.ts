// Master-key desync detection. Keeps AES real; mocks getMasterKey (so we can
// swap the "device key"), an in-memory kv, and messageRepo's sampling. See the
// web IndexedDB-vs-OPFS split in masterKeyCanary.ts.
jest.mock("../secureStore", () => {
  const actual = jest.requireActual("../secureStore");
  return { __esModule: true, ...actual, getMasterKey: jest.fn() };
});

const mockStore = new Map<string, string>();
jest.mock("../../database/kv", () => ({
  kv: {
    get: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    set: (k: string, v: string) => {
      mockStore.set(k, v);
      return Promise.resolve();
    },
    remove: (k: string) => {
      mockStore.delete(k);
      return Promise.resolve();
    },
    getAllByPrefix: (p: string) =>
      Promise.resolve(
        [...mockStore.entries()]
          .filter(([k]) => k.startsWith(p))
          .map(([key, value]) => ({ key, value })),
      ),
  },
}));

const mockSample = jest.fn(async () => [] as string[]);
const mockClearAll = jest.fn(async () => {});
jest.mock("../../database/messageRepository", () => ({
  messageRepo: {
    sampleEncryptedPlaintext: (_limit?: number) => mockSample(),
    clearAllMessages: () => mockClearAll(),
  },
}));

// Imports follow the mock setup: the factories above close over mockStore/mock*,
// which must be initialised before those modules are first required below.
/* eslint-disable import/first */
import {
  clearLocalEncryptedData,
  masterKeyMatchesLocalData,
  writeMasterKeyCanary,
} from "../masterKeyCanary";
import { aesEncrypt, getMasterKey } from "../secureStore";

const USER = "user-uuid-1234";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const setKey = (k: string) => (getMasterKey as jest.Mock).mockResolvedValue(k);

beforeEach(() => {
  mockStore.clear();
  mockSample.mockReset().mockResolvedValue([]);
  mockClearAll.mockReset().mockResolvedValue(undefined);
});

describe("masterKeyMatchesLocalData", () => {
  it("returns true when the canary decrypts under the current key", async () => {
    setKey(KEY_A);
    await writeMasterKeyCanary(USER);
    expect(await masterKeyMatchesLocalData(USER)).toBe(true);
  });

  it("returns false when the master key changed under an existing canary (desync)", async () => {
    setKey(KEY_A);
    await writeMasterKeyCanary(USER);
    setKey(KEY_B); // IndexedDB wiped → new key minted, canary still under KEY_A
    expect(await masterKeyMatchesLocalData(USER)).toBe(false);
  });

  it("bootstraps a canary and returns true when there is no ciphertext yet", async () => {
    setKey(KEY_A);
    expect(await masterKeyMatchesLocalData(USER)).toBe(true);
    // Canary now present → second call is the cheap decrypt path.
    expect(await masterKeyMatchesLocalData(USER)).toBe(true);
  });

  it("returns true (pre-canary) when existing message ciphertext decrypts", async () => {
    setKey(KEY_A);
    mockSample.mockResolvedValue([await aesEncrypt("hello", KEY_A)]);
    expect(await masterKeyMatchesLocalData(USER)).toBe(true);
  });

  it("returns false (pre-canary) when message ciphertext does NOT decrypt", async () => {
    // Ciphertext written under KEY_A, current device key is KEY_B.
    const stale = await aesEncrypt("hello", KEY_A);
    setKey(KEY_B);
    mockSample.mockResolvedValue([stale]);
    expect(await masterKeyMatchesLocalData(USER)).toBe(false);
  });

  it("falls back to ratchet ciphertext when there are no messages", async () => {
    setKey(KEY_B);
    mockStore.set(
      `ratchetState_v3_${USER}_conv`,
      await aesEncrypt("state", KEY_A),
    );
    mockSample.mockResolvedValue([]); // no messages
    expect(await masterKeyMatchesLocalData(USER)).toBe(false);
  });

  it("returns true when no at-rest key is present (native fallback)", async () => {
    setKey(null as any);
    expect(await masterKeyMatchesLocalData(USER)).toBe(true);
  });
});

describe("clearLocalEncryptedData", () => {
  it("clears messages, ratchet rows, and the canary", async () => {
    setKey(KEY_A);
    await writeMasterKeyCanary(USER);
    mockStore.set(`ratchetState_v3_${USER}_c1`, "x.y.z");
    mockStore.set(`ratchetState_v3_${USER}_c2`, "x.y.z");
    mockStore.set(`unrelated_${USER}`, "keep");

    await clearLocalEncryptedData(USER);

    expect(mockClearAll).toHaveBeenCalledTimes(1);
    expect(mockStore.has(`ratchetState_v3_${USER}_c1`)).toBe(false);
    expect(mockStore.has(`ratchetState_v3_${USER}_c2`)).toBe(false);
    expect(mockStore.has(`mk_canary_${USER}`)).toBe(false);
    expect(mockStore.get(`unrelated_${USER}`)).toBe("keep"); // untouched
  });
});
