import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { UserIdentity } from "../../components/ChatScreen/types";
import { initAlice, initBob, RatchetState } from "./ratchet";
import { fromHex, KeyPair, toHex } from "./x3dh";

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
