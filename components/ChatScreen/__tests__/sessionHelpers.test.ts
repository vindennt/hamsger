// establishInitiatorSessionsForAllDevices must fan a handshake out to EVERY one
// of a peer's per-device bundles (≤3), keyed by peer device id, verifying each
// SPK against the peer's SHARED signing key and stamping this device's id onto
// the header. Real X3DH/ratchet crypto runs; only the network, local key store,
// this device's id, and the OPK pop are mocked.

const mockFrom = jest.fn();
const mockGet = jest.fn();
const mockGetDeviceId = jest.fn();
const mockPop = jest.fn();

jest.mock("../../../lib/supabase", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}));
jest.mock("../../../lib/crypto/keystore", () => ({
  keystore: { get: (...a: unknown[]) => mockGet(...a) },
}));
jest.mock("../../../lib/crypto/deviceId", () => ({
  getDeviceId: (...a: unknown[]) => mockGetDeviceId(...a),
}));
jest.mock("../../../lib/crypto/onboarding", () => ({
  popOneTimePrekey: (...a: unknown[]) => mockPop(...a),
}));

/* eslint-disable import/first */
import { createResponderSession } from "../../../lib/crypto/createSession";
import { ratchetDecrypt, ratchetEncrypt } from "../../../lib/crypto/ratchet";
import { KeyPair, SigningKeyPair } from "../../../lib/crypto/x3dh";
import { initSessionsAllDevices } from "../sessionHelpers";
import { UserIdentity } from "../types";

const USER = "me-user-id";
const MY_DEVICE = "my-device-1";
const noop = () => {};

// My (initiator) shared identity, kept stable across the suite.
const myIk = new KeyPair("IK");

const peer: UserIdentity = {
  name: "bob",
  uuid: "bob-user-id",
  publicKey: "unused-here",
};

// A peer device: shared IK + shared signing key, per-device SPK signed by it.
function makePeerDevice(deviceId: string, sigKP: SigningKeyPair, ikB: KeyPair) {
  const spk = new KeyPair("SPK");
  return {
    deviceId,
    spk,
    ikB,
    row: {
      device_id: deviceId,
      identity_key: ikB.publicKey,
      signed_prekey: spk.publicKey,
      spk_signature: sigKP.sign(spk.publicKey),
      signing_key: sigKP.publicKey,
    },
  };
}

// supabase.from("prekey_bundles").select(...).eq("user_id", uuid) → {data,error}
function mockBundles(rows: unknown[] | null, error: unknown = null) {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => Promise.resolve({ data: rows, error }) }),
  });
}

beforeEach(() => {
  mockFrom.mockReset();
  mockGet.mockReset();
  mockGetDeviceId.mockReset();
  mockPop.mockReset();
  mockGet.mockImplementation(async (k: string) =>
    k === `ik_priv_${USER}` ? myIk.privateKey : null,
  );
  mockGetDeviceId.mockResolvedValue(MY_DEVICE);
  mockPop.mockResolvedValue(null); // OPK pool exhausted (still a valid session)
});

describe("establishInitiatorSessionsForAllDevices", () => {
  it("returns one session per peer device, keyed by device id, stamped with my device", async () => {
    const sigKP = new SigningKeyPair();
    const ikB = new KeyPair("IK");
    const d1 = makePeerDevice("bob-dev-A", sigKP, ikB);
    const d2 = makePeerDevice("bob-dev-B", sigKP, ikB);
    mockBundles([d1.row, d2.row]);

    const sessions = await initSessionsAllDevices(USER, peer);

    expect([...sessions.keys()].sort()).toEqual(["bob-dev-A", "bob-dev-B"]);
    for (const s of sessions.values()) {
      expect(s.header.sender_device_id).toBe(MY_DEVICE);
      expect(s.header.ik).toBe(myIk.publicKey);
    }
    // One OPK popped per device, each targeting that specific peer device.
    expect(mockPop).toHaveBeenCalledWith(peer.uuid, "bob-dev-A");
    expect(mockPop).toHaveBeenCalledWith(peer.uuid, "bob-dev-B");
  });

  it("derives a session the matching peer device can decrypt", async () => {
    const sigKP = new SigningKeyPair();
    const ikB = new KeyPair("IK");
    const dev = makePeerDevice("bob-dev-A", sigKP, ikB);
    mockBundles([dev.row]);

    const sessions = await initSessionsAllDevices(USER, peer);
    const initiator = sessions.get("bob-dev-A")!;

    const rm = await ratchetEncrypt(initiator.state, "hello device", noop);
    const bob = createResponderSession(
      { ikPriv: dev.ikB.privateKey, spk: dev.spk, opkPriv: null },
      { ik: initiator.header.ik, ek: initiator.header.ek },
    ).state;
    const plaintext = await ratchetDecrypt(
      bob,
      {
        header: { DHpub: rm.header.DHpub, PN: rm.header.PN, N: rm.header.N },
        ciphertext: rm.ciphertext,
        iv: rm.iv,
        authTag: rm.authTag,
      },
      noop,
    );
    expect(plaintext).toBe("hello device");
  });

  it("skips a device whose SPK signature is invalid, keeps the rest", async () => {
    const sigKP = new SigningKeyPair();
    const ikB = new KeyPair("IK");
    const good = makePeerDevice("bob-dev-A", sigKP, ikB);
    const bad = makePeerDevice("bob-dev-B", sigKP, ikB);
    bad.row.spk_signature = good.row.spk_signature; // now invalid for bad's SPK
    mockBundles([good.row, bad.row]);

    const sessions = await initSessionsAllDevices(USER, peer);
    expect([...sessions.keys()]).toEqual(["bob-dev-A"]);
  });

  it("throws when the peer has no bundles", async () => {
    mockBundles([]);
    await expect(initSessionsAllDevices(USER, peer)).rejects.toThrow(
      /Missing encryption keys/,
    );
  });

  it("throws when every device bundle is invalid", async () => {
    const sigKP = new SigningKeyPair();
    const ikB = new KeyPair("IK");
    const bad = makePeerDevice("bob-dev-A", sigKP, ikB);
    bad.row.spk_signature = "00".repeat(64); // wrong signature
    mockBundles([bad.row]);
    await expect(initSessionsAllDevices(USER, peer)).rejects.toThrow(
      /Missing encryption keys/,
    );
  });
});
