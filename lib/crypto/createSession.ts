import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { UserIdentity } from "../../components/ChatScreen/types";
import { initAlice, initBob, RatchetState } from "./ratchet";
import { fromHex, KeyPair, toHex, X3DH } from "./x3dh";

export interface SessionResult {
  SK: string;
  initiatorState?: RatchetState;
  responderState?: RatchetState;
  meta: {
    initiatorDHsCore: string; // Alice's initial ratchet private key hex
    initiatorDHsPub: string; // Alice's initial ratchet public key hex
    responderRatchetPub: string; // Bob's SPK public key hex
    responderRatchetPriv?: string; // Bob's SPK private key hex
  };
}

/**
 * Bootstraps a secure X3DH session between two identities using a long term Curve25519 shared secret.
 * 
 * To initialize without a separate session negotiation protocol, the initial keys are derived
 * deterministically using HKDF over the ECDH shared secret between the two long-term Identity Keys.

 */
export function createSession(
  initiator: UserIdentity,
  responder: UserIdentity,
  initiatorPrivateKeyHex?: string,
  responderPrivateKeyHex?: string,
): SessionResult {
  // 1. Resolve long-term Identity Keys
  const initPubKey = initiator.publicKey.replace("pub_", "");
  const respPubKey = responder.publicKey.replace("pub_", "");

  let sharedSecretBytes: Uint8Array;

  // Deriving the shared secret SS = X25519(privA, pubB)
  if (initiatorPrivateKeyHex) {
    sharedSecretBytes = x25519.getSharedSecret(
      fromHex(initiatorPrivateKeyHex),
      fromHex(respPubKey),
    );
  } else if (responderPrivateKeyHex) {
    sharedSecretBytes = x25519.getSharedSecret(
      fromHex(responderPrivateKeyHex),
      fromHex(initPubKey),
    );
  } else {
    throw new Error("createSession requires either initiator or responder private key");
  }

  const SS = toHex(sharedSecretBytes);
  const salt = fromHex(
    "0000000000000000000000000000000000000000000000000000000000000000",
  );

  // 2. Derive initial session parameters deterministically from long-term shared secret
  const SK = toHex(
    hkdf(sha256, fromHex(SS), salt, new TextEncoder().encode("X3DH_SK"), 32),
  );
  const initiatorDHsPriv = toHex(
    hkdf(
      sha256,
      fromHex(SS),
      salt,
      new TextEncoder().encode("X3DH_initiatorDHs"),
      32,
    ),
  );
  const responderSPKPriv = toHex(
    hkdf(
      sha256,
      fromHex(SS),
      salt,
      new TextEncoder().encode("X3DH_responderSPK"),
      32,
    ),
  );

  const initiatorDHsPub = toHex(x25519.getPublicKey(fromHex(initiatorDHsPriv)));
  const responderSPKPub = toHex(x25519.getPublicKey(fromHex(responderSPKPriv)));

  // 3. Initialize initiator ratchet state (Alice) if initiator private key is present
  let initiatorState: RatchetState | undefined;
  if (initiatorPrivateKeyHex) {
    const initiatorDHs = new KeyPair(
      `${initiator.name}_DHs_0`,
      initiatorDHsPriv,
    );
    initiatorState = initAlice(SK, responderSPKPub, initiatorDHs);
    initiatorState.name = initiator.name;
  }

  let responderState: RatchetState | undefined;
  if (responderPrivateKeyHex) {
    const responderSPK = new KeyPair(`${responder.name}_SPK`, responderSPKPriv);
    responderState = initBob(SK, responderSPK, initiatorDHsPub);
    responderState.name = responder.name;
  }

  return {
    SK,
    initiatorState,
    responderState,
    meta: {
      initiatorDHsCore: initiatorDHsPriv,
      initiatorDHsPub: initiatorDHsPub,
      responderRatchetPub: responderSPKPub,
      responderRatchetPriv: responderSPKPriv,
    },
  };
}

// ─── Real Signal X3DH (ephemeral + one-time prekey) ──────────────────────────
// The deterministic createSession above is still used by the eager session path
// and its tests; it is removed in B4 when those callers go lazy. The functions
// below are the real handshake: a fresh ephemeral EK is mixed on every
// (re)establishment, restoring post-compromise security.

// HKDF salt for the X3DH root derivation: 32 zero bytes (Signal convention).
const X3DH_SALT =
  "0000000000000000000000000000000000000000000000000000000000000000";
// Application-scoped HKDF info string, versioned so a future scheme can diverge.
const X3DH_INFO = "hamsger_x3dh_v1";

// Bob's published public prekey bundle, as seen by the initiator.
export interface PeerPrekeyBundle {
  identityKey: string; // IK_B public (hex)
  signedPrekey: string; // SPK_B public (hex)
  oneTimePrekey?: string | null; // OPK_B public (hex), omitted when exhausted
}

export interface X3DHSession {
  SK: string;
  state: RatchetState;
}

/**
 * Initiator (Alice) side of X3DH. Derives SK from four DHs against Bob's public
 * bundle, then bootstraps the sending ratchet. The ephemeral `ek` doubles as
 * Alice's initial DH-ratchet key: its public is what the responder receives as
 * the prekey header `ek`, so no separate ratchet key is generated.
 */
export function createInitiatorSession(
  myIkPriv: string,
  ek: KeyPair,
  peer: PeerPrekeyBundle,
): X3DHSession {
  const ikA = new KeyPair("IK", myIkPriv);

  const dhs = [
    ikA.dh(peer.signedPrekey), // DH1 = DH(IK_A, SPK_B)
    ek.dh(peer.identityKey), // DH2 = DH(EK_A, IK_B)
    ek.dh(peer.signedPrekey), // DH3 = DH(EK_A, SPK_B)
  ];
  if (peer.oneTimePrekey) {
    dhs.push(ek.dh(peer.oneTimePrekey)); // DH4 = DH(EK_A, OPK_B)
  }

  const SK = X3DH.deriveSessionKey(dhs, X3DH_SALT, X3DH_INFO);
  const state = initAlice(SK, peer.signedPrekey, ek);
  return { SK, state };
}

// Bob's private key material needed to recompute the X3DH secret. `opkPriv` is
// set only when the initiator's header referenced one of Bob's one-time prekeys.
export interface ResponderKeys {
  ikPriv: string; // IK_B private (hex)
  spk: KeyPair; // SPK_B keypair
  opkPriv?: string | null; // OPK_B private (hex)
}

// The public keys the initiator sends in the first message's prekey header.
export interface PrekeyHeaderKeys {
  ik: string; // IK_A public (hex)
  ek: string; // EK_A public (hex)
}

/**
 * Responder (Bob) side of X3DH. Recomputes the identical SK from Bob's private
 * keys against Alice's public header, then bootstraps the receiving ratchet with
 * Alice's ephemeral (header `ek`) as the peer's initial ratchet key.
 */
export function createResponderSession(
  keys: ResponderKeys,
  header: PrekeyHeaderKeys,
): X3DHSession {
  const ikB = new KeyPair("IK", keys.ikPriv);

  const dhs = [
    keys.spk.dh(header.ik), // DH1 = DH(SPK_B, IK_A)
    ikB.dh(header.ek), // DH2 = DH(IK_B, EK_A)
    keys.spk.dh(header.ek), // DH3 = DH(SPK_B, EK_A)
  ];
  if (keys.opkPriv) {
    const opk = new KeyPair("OPK", keys.opkPriv);
    dhs.push(opk.dh(header.ek)); // DH4 = DH(OPK_B, EK_A)
  }

  const SK = X3DH.deriveSessionKey(dhs, X3DH_SALT, X3DH_INFO);
  const state = initBob(SK, keys.spk, header.ek);
  return { SK, state };
}
