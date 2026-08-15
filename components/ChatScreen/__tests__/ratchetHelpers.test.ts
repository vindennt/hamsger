// Exercises loadRatchetState's absent-vs-corrupt distinction: a present-but-
// unreadable row must THROW (so the caller routes to session recovery) rather
// than silently returning null and re-initializing the ratchet, which would
// abandon the conversation's history. Mocks only the at-rest reader; the real
// EncryptedStateUnreadableError and ratchet (de)serialization are used.
jest.mock("../../../lib/crypto/secureStore", () => {
  const actual = jest.requireActual("../../../lib/crypto/secureStore");
  return { ...actual, loadEncryptedStateStrict: jest.fn() };
});

/* eslint-disable import/first */
import { initAlice, serializeRatchetState } from "../../../lib/crypto/ratchet";
import {
  EncryptedStateUnreadableError,
  loadEncryptedStateStrict,
} from "../../../lib/crypto/secureStore";
import { KeyPair } from "../../../lib/crypto/x3dh";
import { loadRatchetState } from "../ratchetHelpers";

const mockStrict = loadEncryptedStateStrict as jest.MockedFunction<
  typeof loadEncryptedStateStrict
>;

const CONV = "a:b";
const USER = "user-1";

beforeEach(() => {
  mockStrict.mockReset();
});

describe("loadRatchetState", () => {
  it("returns null when no state exists yet", async () => {
    mockStrict.mockResolvedValue(null);
    expect(await loadRatchetState(CONV, USER)).toBeNull();
  });

  it("deserializes a present, valid state", async () => {
    const ek = new KeyPair("EK");
    const spk = new KeyPair("SPK");
    const state = initAlice("00".repeat(32), spk.publicKey, ek);
    mockStrict.mockResolvedValue(JSON.stringify(serializeRatchetState(state)));

    const loaded = await loadRatchetState(CONV, USER);
    expect(loaded?.name).toBe("Alice");
  });

  it("throws (not null) when a present row is unparseable", async () => {
    mockStrict.mockResolvedValue("not-json{");
    await expect(loadRatchetState(CONV, USER)).rejects.toBeInstanceOf(
      EncryptedStateUnreadableError,
    );
  });

  it("propagates an unreadable-state error from the reader", async () => {
    mockStrict.mockRejectedValue(new EncryptedStateUnreadableError("key"));
    await expect(loadRatchetState(CONV, USER)).rejects.toBeInstanceOf(
      EncryptedStateUnreadableError,
    );
  });
});
