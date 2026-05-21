import { UserIdentity } from "../../components/ChatScreen/types";
import { initAlice, initBob, RatchetState } from "./ratchet";
import { KeyPair, SigningKeyPair, X3DH } from "./x3dh";

export interface SessionResult {
  SK: string;
  initiatorState: RatchetState;
  responderState: RatchetState;
  meta: {
    initiatorDHsCore: string;
    responderRatchetPub: string;
    responderRatchetPriv: string;
  };
}

/**
 * Simulates a full X3DH handshake between two identities and initializes their RatchetStates.
 * In production, the responder's SPK bundle would be fetched from a server.
 */
export function createSession(
  initiator: UserIdentity,
  responder: UserIdentity
): SessionResult {
  // 1. Initiator's keys
  const initiatorID = new KeyPair(`${initiator.name}_ID`, initiator.publicKey);
  const initiatorSig = new SigningKeyPair(); // ephemeral for mock

  // 2. Responder's keys
  const responderID = new KeyPair(`${responder.name}_ID`, responder.publicKey);
  const responderSig = new SigningKeyPair();

  // Responder publishes an SPK
  const responderSPK = new KeyPair(`${responder.name}_SPK`);
  const responderSPKSignature = responderSig.sign(responderSPK.publicKey);

  // 3. Initiator performs X3DH
  const EK = new KeyPair(`EK_${initiator.name}`);
  const dh1 = initiatorID.dh(responderSPK.publicKey);
  const dh2 = EK.dh(responderID.publicKey);
  const dh3 = EK.dh(responderSPK.publicKey);
  const SK_initiator = X3DH.deriveSessionKey(dh1, dh2, dh3, "salt", "X3DH_Session");

  // 4. Responder performs X3DH
  const dh1r = responderSPK.dh(initiatorID.publicKey);
  const dh2r = responderID.dh(EK.publicKey);
  const dh3r = responderSPK.dh(EK.publicKey);
  const SK_responder = X3DH.deriveSessionKey(dh1r, dh2r, dh3r, "salt", "X3DH_Session");

  if (SK_initiator !== SK_responder) {
    throw new Error("X3DH SK mismatch in createSession");
  }

  // 5. Initialize Double Ratchet States
  // Initiator needs an initial DH pair to send the first message
  const initiatorDHs = new KeyPair(`${initiator.name}_DHs_0`);
  const initiatorState = initAlice(SK_initiator, responderSPK.publicKey, initiatorDHs);
  
  const responderState = initBob(SK_responder, responderSPK);

  // Override names for the state objects so logs match the UI identities
  initiatorState.name = initiator.name;
  responderState.name = responder.name;

  return {
    SK: SK_initiator,
    initiatorState,
    responderState,
    meta: {
      initiatorDHsCore: initiatorDHs.privateKey.replace("priv_", ""),
      responderRatchetPub: responderSPK.publicKey,
      responderRatchetPriv: responderSPK.privateKey.replace("priv_", ""),
    },
  };
}
