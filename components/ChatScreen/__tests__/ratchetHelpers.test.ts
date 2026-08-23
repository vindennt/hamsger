// Exercises loadRatchetState's absent-vs-corrupt distinction: a present-but-
// unreadable row must THROW (so the caller routes to session recovery) rather
// than silently returning null and re-initializing the ratchet, which would
// abandon the conversation's history. Mocks only the at-rest reader; the real
// EncryptedStateUnreadableError and ratchet (de)serialization are used.
jest.mock("../../../lib/crypto/secureStore", () => {
  const actual = jest.requireActual("../../../lib/crypto/secureStore");
  return { ...actual, loadEncryptedStateStrict: jest.fn() };
});

jest.mock("../../../lib/database/kv", () => ({
  kv: { getAllByPrefix: jest.fn() },
}));

/* eslint-disable import/first */
import { initAlice, serializeRatchetState } from "../../../lib/crypto/ratchet";
import {
  EncryptedStateUnreadableError,
  loadEncryptedStateStrict,
} from "../../../lib/crypto/secureStore";
import { KeyPair } from "../../../lib/crypto/x3dh";
import { kv } from "../../../lib/database/kv";
import {
  listRatchetPeerDeviceIds,
  loadRatchetState,
  ratchetStateKey,
} from "../ratchetHelpers";

const mockStrict = loadEncryptedStateStrict as jest.MockedFunction<
  typeof loadEncryptedStateStrict
>;
const mockGetAllByPrefix = kv.getAllByPrefix as jest.Mock;

const CONV = "a:b";
const USER = "user-1";
const DEV = "device-9";

beforeEach(() => {
  mockStrict.mockReset();
  mockGetAllByPrefix.mockReset();
});

describe("loadRatchetState", () => {
  it("returns null when no state exists yet", async () => {
    mockStrict.mockResolvedValue(null);
    expect(await loadRatchetState(CONV, USER, DEV)).toBeNull();
  });

  it("reads the per-device key", async () => {
    mockStrict.mockResolvedValue(null);
    await loadRatchetState(CONV, USER, DEV);
    expect(mockStrict).toHaveBeenCalledWith(ratchetStateKey(USER, CONV, DEV));
    expect(ratchetStateKey(USER, CONV, DEV)).toBe(
      `ratchetState_v3_${USER}_${CONV}_${DEV}`,
    );
  });

  it("deserializes a present, valid state", async () => {
    const ek = new KeyPair("EK");
    const spk = new KeyPair("SPK");
    const state = initAlice("00".repeat(32), spk.publicKey, ek);
    mockStrict.mockResolvedValue(JSON.stringify(serializeRatchetState(state)));

    const loaded = await loadRatchetState(CONV, USER, DEV);
    expect(loaded?.name).toBe("Alice");
  });

  it("throws (not null) when a present row is unparseable", async () => {
    mockStrict.mockResolvedValue("not-json{");
    await expect(loadRatchetState(CONV, USER, DEV)).rejects.toBeInstanceOf(
      EncryptedStateUnreadableError,
    );
  });

  it("propagates an unreadable-state error from the reader", async () => {
    mockStrict.mockRejectedValue(new EncryptedStateUnreadableError("key"));
    await expect(loadRatchetState(CONV, USER, DEV)).rejects.toBeInstanceOf(
      EncryptedStateUnreadableError,
    );
  });
});

describe("listRatchetPeerDeviceIds", () => {
  it("returns the peer device ids we hold a ratchet for", async () => {
    const prefix = `ratchetState_v3_${USER}_${CONV}_`;
    mockGetAllByPrefix.mockResolvedValue([
      { key: `${prefix}dev-A`, value: "x" },
      { key: `${prefix}dev-B`, value: "y" },
    ]);
    expect(await listRatchetPeerDeviceIds(CONV, USER)).toEqual([
      "dev-A",
      "dev-B",
    ]);
    expect(mockGetAllByPrefix).toHaveBeenCalledWith(prefix);
  });

  it("drops SQL-LIKE wildcard false matches that don't literally match the prefix", async () => {
    const prefix = `ratchetState_v3_${USER}_${CONV}_`;
    mockGetAllByPrefix.mockResolvedValue([
      { key: `${prefix}dev-A`, value: "x" },
      // `_` is a LIKE wildcard, so a different conv could slip through.
      { key: `ratchetState_v3_${USER}_zzzzz_dev-Z`, value: "z" },
    ]);
    expect(await listRatchetPeerDeviceIds(CONV, USER)).toEqual(["dev-A"]);
  });
});
