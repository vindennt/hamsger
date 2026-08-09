// Pure-crypto tests for the ratchet skip bound. ratchet.ts + createSession.ts import
// no supabase/db, so AES-GCM + KDF run for real with no stubs.
import {
  createInitiatorSession,
  createResponderSession,
} from "../createSession";
import {
  __setSkipStoreCapForTests,
  MAX_SKIP,
  ratchetDecrypt,
  ratchetEncrypt,
  RatchetState,
  TooManySkippedError,
} from "../ratchet";
import { KeyPair } from "../x3dh";

const noop = () => {};

// A consistent Alice(initiator)/Bob(responder) ratchet pair from a real X3DH handshake.
function makePair(): { alice: RatchetState; bob: RatchetState } {
  const ikA = new KeyPair("IK_A");
  const ikB = new KeyPair("IK_B");
  const spkB = new KeyPair("SPK_B");
  const ek = new KeyPair("EK_A");

  const initiator = createInitiatorSession(ikA.privateKey, ek, {
    identityKey: ikB.publicKey,
    signedPrekey: spkB.publicKey,
    oneTimePrekey: null,
  });

  const responder = createResponderSession(
    { ikPriv: ikB.privateKey, spk: spkB, opkPriv: null },
    { ik: ikA.publicKey, ek: ek.publicKey },
  );

  return { alice: initiator.state, bob: responder.state };
}

describe("ratchet skip bound", () => {
  it("MAX_SKIP is the raised value", () => {
    expect(MAX_SKIP).toBe(1000);
  });

  it("decrypts a message that skips just under MAX_SKIP keys in a chain", async () => {
    const { alice, bob } = makePair();
    let last;
    for (let i = 0; i < 600; i++) {
      last = await ratchetEncrypt(alice, `m${i}`, noop);
    }
    // Bob jumps straight to N=599 (skips 599 < 1000) — must succeed.
    const pt = await ratchetDecrypt(bob, last!, noop);
    expect(pt).toBe("m599");
  });

  it("throws TooManySkippedError when the gap exceeds MAX_SKIP", async () => {
    const { alice, bob } = makePair();
    let last;
    for (let i = 0; i <= MAX_SKIP + 50; i++) {
      last = await ratchetEncrypt(alice, `m${i}`, noop);
    }
    // Gap of 1050 > 1000 — a typed signal the receive path routes to recovery.
    await expect(ratchetDecrypt(bob, last!, noop)).rejects.toBeInstanceOf(
      TooManySkippedError,
    );
  });

  it("caps the skipped-key store and evicts the oldest keys", async () => {
    __setSkipStoreCapForTests(5);
    try {
      const { alice, bob } = makePair();
      let last;
      for (let i = 0; i < 11; i++) {
        last = await ratchetEncrypt(alice, `m${i}`, noop);
      }
      // Bob jumps to N=10, skipping 0..9 → 10 keys stored, capped to the newest 5.
      await ratchetDecrypt(bob, last!, noop);
      expect(bob.skippedKeys.size).toBe(5);
      const keys = [...bob.skippedKeys.keys()];
      expect(keys.some((k) => k.endsWith(":0"))).toBe(false); // oldest evicted
      expect(keys.some((k) => k.endsWith(":9"))).toBe(true); // newest kept
    } finally {
      __setSkipStoreCapForTests(null);
    }
  });
});
