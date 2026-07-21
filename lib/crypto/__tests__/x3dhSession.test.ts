// Pure crypto: createInitiatorSession/createResponderSession touch no supabase,
// kv, or messageRepo, so no mocks are needed.
import {
  createInitiatorSession,
  createResponderSession,
} from "../createSession";
import { ratchetDecrypt, ratchetEncrypt } from "../ratchet";
import { KeyPair } from "../x3dh";

const noop = () => {};

// Builds a matching initiator/responder pair from fresh identities. `withOpk`
// toggles whether a one-time prekey participates (DH4).
function handshake(withOpk: boolean) {
  const ikA = new KeyPair("IK_A");
  const ikB = new KeyPair("IK_B");
  const spkB = new KeyPair("SPK_B");
  const opkB = withOpk ? new KeyPair("OPK_B") : null;
  const ek = new KeyPair("EK_A");

  const initiator = createInitiatorSession(ikA.privateKey, ek, {
    identityKey: ikB.publicKey,
    signedPrekey: spkB.publicKey,
    oneTimePrekey: opkB?.publicKey ?? null,
  });

  const responder = createResponderSession(
    { ikPriv: ikB.privateKey, spk: spkB, opkPriv: opkB?.privateKey ?? null },
    { ik: ikA.publicKey, ek: ek.publicKey },
  );

  return { initiator, responder };
}

describe("X3DH session establishment", () => {
  it("both sides derive an equal SK with a one-time prekey", () => {
    const { initiator, responder } = handshake(true);
    expect(initiator.SK).toBe(responder.SK);
  });

  it("both sides derive an equal SK without a one-time prekey", () => {
    const { initiator, responder } = handshake(false);
    expect(initiator.SK).toBe(responder.SK);
  });

  it("the OPK changes the SK (DH4 is actually mixed in)", () => {
    // Same identities, differing only by whether an OPK is present, must not
    // collide — proves DH4 contributes to the derivation.
    const ikA = new KeyPair("IK_A");
    const ikB = new KeyPair("IK_B");
    const spkB = new KeyPair("SPK_B");
    const opkB = new KeyPair("OPK_B");
    const ek = new KeyPair("EK_A");

    const withOpk = createInitiatorSession(ikA.privateKey, ek, {
      identityKey: ikB.publicKey,
      signedPrekey: spkB.publicKey,
      oneTimePrekey: opkB.publicKey,
    });
    const withoutOpk = createInitiatorSession(ikA.privateKey, ek, {
      identityKey: ikB.publicKey,
      signedPrekey: spkB.publicKey,
      oneTimePrekey: null,
    });

    expect(withOpk.SK).not.toBe(withoutOpk.SK);
  });

  it("bootstraps a ratchet that decrypts in both directions", async () => {
    const { initiator, responder } = handshake(true);

    // Alice (initiator) → Bob (responder).
    const m1 = await ratchetEncrypt(initiator.state, "hello bob", noop);
    expect(await ratchetDecrypt(responder.state, m1, noop)).toBe("hello bob");

    // Bob → Alice (exercises the DH-ratchet step on Alice's receive).
    const m2 = await ratchetEncrypt(responder.state, "hi alice", noop);
    expect(await ratchetDecrypt(initiator.state, m2, noop)).toBe("hi alice");
  });

  it("a fresh ephemeral produces a different SK (post-compromise seed)", () => {
    const ikA = new KeyPair("IK_A");
    const ikB = new KeyPair("IK_B");
    const spkB = new KeyPair("SPK_B");
    const peer = {
      identityKey: ikB.publicKey,
      signedPrekey: spkB.publicKey,
      oneTimePrekey: null,
    };

    const first = createInitiatorSession(ikA.privateKey, new KeyPair("EK"), peer);
    const second = createInitiatorSession(
      ikA.privateKey,
      new KeyPair("EK"),
      peer,
    );

    expect(first.SK).not.toBe(second.SK);
  });
});
