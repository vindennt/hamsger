// Targets the duplicate-processing bug: an inbound message delivered/processed
// twice (duplicate realtime channel, or fetchInitial racing the realtime
// callback) must be handled at-most-once. The 1st pass decrypts + advances the
// ratchet + stores; a 2nd pass must be SKIPPED before decrypt. Without the
// in-lock existence guard the 2nd pass decrypts against the already-advanced
// ratchet, derives the wrong key, throws OperationError, and falsely trips
// desync recovery (the reset cascade seen in the live logs).
//
// Real ratchet + AES-GCM run; only the at-rest store and message repo are
// mocked to in-memory. supabase is stubbed (sessionHelpers imports it at load).

// `mock`-prefixed so jest permits referencing them inside the hoisted factories.
const mockStore = new Map<string, string>();
const mockIds = new Set<string>();

jest.mock("../../../lib/supabase", () => ({ supabase: {} }));

jest.mock("../../../lib/database/messageRepository", () => ({
  messageRepo: {
    messageExists: jest.fn(async (id: string) => mockIds.has(id)),
    insertMessage: jest.fn(async (m: { id: string }) => {
      mockIds.add(m.id);
    }),
  },
}));

jest.mock("../../../lib/crypto/secureStore", () => {
  const actual = jest.requireActual("../../../lib/crypto/secureStore");
  return {
    ...actual,
    saveEncryptedState: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    loadEncryptedStateStrict: jest.fn(
      async (k: string) => mockStore.get(k) ?? null,
    ),
  };
});

/* eslint-disable import/first */
import {
  createInitiatorSession,
  createResponderSession,
} from "../../../lib/crypto/createSession";
import {
  ratchetEncrypt,
  RatchetState,
  serializeRatchetState,
} from "../../../lib/crypto/ratchet";
import { withRatchetLock } from "../../../lib/crypto/ratchetLock";
import { KeyPair } from "../../../lib/crypto/x3dh";
import { messageRepo } from "../../../lib/database/messageRepository";
import { decryptStoreInbound } from "../inboundMessage";
import { EncryptedDbMessage } from "../types";

const noop = () => {};
const CONV = "alice:bob";
const BOB = "bob-user-id";

// Fresh Alice(initiator)/Bob(responder) pair; Bob is seeded into the mocked
// at-rest store so the receive core loads it via loadRatchetState.
function seedPair(): RatchetState {
  const ikA = new KeyPair("IK_A");
  const ikB = new KeyPair("IK_B");
  const spkB = new KeyPair("SPK_B");
  const ek = new KeyPair("EK_A");

  const alice = createInitiatorSession(ikA.privateKey, ek, {
    identityKey: ikB.publicKey,
    signedPrekey: spkB.publicKey,
    oneTimePrekey: null,
  }).state;

  const bob = createResponderSession(
    { ikPriv: ikB.privateKey, spk: spkB, opkPriv: null },
    { ik: ikA.publicKey, ek: ek.publicKey },
  ).state;

  mockStore.set(
    `ratchetState_v3_${BOB}_${CONV}`,
    JSON.stringify(serializeRatchetState(bob)),
  );
  return alice;
}

async function makeInbound(
  alice: RatchetState,
  text: string,
  id: string,
): Promise<EncryptedDbMessage> {
  const rm = await ratchetEncrypt(alice, text, noop);
  return {
    id,
    conversation_id: CONV,
    ciphertext: rm.ciphertext,
    iv: rm.iv,
    auth_tag: rm.authTag,
    dh_pub: rm.header.DHpub,
    pn: rm.header.PN,
    n: rm.header.N,
    timestamp: new Date().toISOString(),
  } as unknown as EncryptedDbMessage;
}

beforeEach(() => {
  mockStore.clear();
  mockIds.clear();
  jest.clearAllMocks();
});

describe("decryptStoreInbound idempotency", () => {
  it("first delivery decrypts and stores the message", async () => {
    const alice = seedPair();
    const msg = await makeInbound(alice, "hello", "m1");

    const r = await withRatchetLock(CONV, () =>
      decryptStoreInbound(CONV, BOB, msg, "alice"),
    );

    expect(r).toEqual({ status: "stored", plaintext: "hello" });
    expect(messageRepo.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("a duplicate delivery is skipped, not re-decrypted (no OperationError)", async () => {
    const alice = seedPair();
    const msg = await makeInbound(alice, "hello", "m1");

    const first = await withRatchetLock(CONV, () =>
      decryptStoreInbound(CONV, BOB, msg, "alice"),
    );
    const second = await withRatchetLock(CONV, () =>
      decryptStoreInbound(CONV, BOB, msg, "alice"),
    );

    expect(first.status).toBe("stored");
    expect(second).toEqual({ status: "skipped" });
    expect(messageRepo.insertMessage).toHaveBeenCalledTimes(1);

    // Ratchet advanced exactly once (Nr === 1), not double-advanced.
    const saved = JSON.parse(mockStore.get(`ratchetState_v3_${BOB}_${CONV}`)!);
    expect(saved.Nr).toBe(1);
  });

  it("concurrent duplicate deliveries store exactly once", async () => {
    const alice = seedPair();
    const msg = await makeInbound(alice, "hello", "m1");

    const [a, b] = await Promise.all([
      withRatchetLock(CONV, () => decryptStoreInbound(CONV, BOB, msg, "alice")),
      withRatchetLock(CONV, () => decryptStoreInbound(CONV, BOB, msg, "alice")),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["skipped", "stored"]);
    expect(messageRepo.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("distinct sequential messages both decrypt and store", async () => {
    const alice = seedPair();
    const m1 = await makeInbound(alice, "one", "m1");
    const m2 = await makeInbound(alice, "two", "m2");

    const r1 = await withRatchetLock(CONV, () =>
      decryptStoreInbound(CONV, BOB, m1, "alice"),
    );
    const r2 = await withRatchetLock(CONV, () =>
      decryptStoreInbound(CONV, BOB, m2, "alice"),
    );

    expect(r1).toEqual({ status: "stored", plaintext: "one" });
    expect(r2).toEqual({ status: "stored", plaintext: "two" });
    expect(messageRepo.insertMessage).toHaveBeenCalledTimes(2);
  });
});
