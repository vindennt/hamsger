import { initAlice, initBob, RatchetState } from "./ratchet";
import { KeyPair, X3DH } from "./x3dh";

// ─── Real Signal X3DH (ephemeral + one-time prekey) ──────────────────────────
// A new ephemeral EK is mixed on every establishment, restoring
// post-compromise security state

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
