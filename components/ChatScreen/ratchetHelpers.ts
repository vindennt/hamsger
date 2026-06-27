import { loadEncryptedState } from "../../lib/crypto/secureStore";
import { KeyPair } from "../../lib/crypto/x3dh";
import {
  deserializeRatchetState,
  initAlice,
  initBob,
  RatchetState,
  serializeRatchetState,
} from "../../lib/crypto/ratchet";
import { ConversationId, SessionContext } from "./types";

export async function getOrCreateRatchetState(
  convId: ConversationId,
  session: SessionContext,
  currentUserId: string,
  currentUser: string
): Promise<RatchetState> {
  const stateKey = `ratchetState_v3_${currentUserId}_${convId}`;
  const stored = await loadEncryptedState(stateKey);
  if (stored) {
    try {
      return deserializeRatchetState(JSON.parse(stored));
    } catch (e) {
      console.error("Failed to parse stored ratchet state for " + convId, e);
    }
  }

  // If not found, initialize a new state from session context
  let state: RatchetState;
  if (currentUserId === session.initiator.uuid) {
    const initiatorDHs = new KeyPair("Init_DHs_0", session.meta.initiatorDHsCore);
    state = initAlice(session.SK, session.meta.responderRatchetPub, initiatorDHs);
    state.name = currentUser;
  } else if (currentUserId === session.responder.uuid) {
    const responderRatchetKP = new KeyPair(
      "Resp_SPK",
      session.meta.responderRatchetPriv!.replace("priv_", ""),
    );
    state = initBob(session.SK, responderRatchetKP, session.meta.initiatorDHsPub);
    state.name = currentUser;
  } else {
    throw new Error("Current user is not part of this session");
  }

  return state;
}

export { serializeRatchetState, deserializeRatchetState };
