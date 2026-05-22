import { useMemo, useRef } from "react";
import {
  initAlice,
  initBob,
  kdfMsgChain,
  ratchetDecrypt,
  ratchetEncrypt,
  RatchetState,
} from "../../lib/crypto/ratchet";
import { KeyPair, X3DH } from "../../lib/crypto/x3dh";
import {
  EncryptedDbMessage,
  SessionContext,
  toMessage,
  UserIdentity,
} from "./types";

export function useDecryption(
  currentUserIdentity: UserIdentity | undefined,
  sessionContext: SessionContext | undefined,
  dbMessages: EncryptedDbMessage[],
) {
  const encryptorRef = useRef<{
    encrypt: (text: string) => ReturnType<typeof ratchetEncrypt>;
  } | null>(null);

  const decryptedMessages = useMemo(() => {
    if (!sessionContext || !currentUserIdentity) return [];
    try {
      const { initiator, responder, SK, meta } = sessionContext;
      let state: RatchetState;

      // Init user state
      if (currentUserIdentity.uuid === initiator.uuid) {
        const initiatorDHs = new KeyPair("Init_DHs_0", meta.initiatorDHsCore);
        state = initAlice(SK, meta.responderRatchetPub, initiatorDHs);
        state.name = currentUserIdentity.name;
      } else if (currentUserIdentity.uuid === responder.uuid) {
        const responderRatchetKP = new KeyPair(
          "Resp_SPK",
          meta.responderRatchetPriv.replace("priv_", ""),
        );
        state = initBob(SK, responderRatchetKP);
        state.name = currentUserIdentity.name;
      } else {
        throw new Error("Current user is not part of this session");
      }

      const noop = () => {};

      // Decrypt messages
      const decrypted = dbMessages.map((dbMsg) => {
        let plaintext = "";

        try {
          if (dbMsg.sender === currentUserIdentity.name) {
            // Decrypt our own outgoing messages by stepping the sending chain
            if (!state.CKs) throw new Error("No sending chain key available");
            const { nextCK, messageKey } = kdfMsgChain(state.CKs);
            state.CKs = nextCK;
            state.Ns += 1;
            plaintext = X3DH.decrypt(
              messageKey,
              dbMsg.ciphertext,
              dbMsg.iv,
              dbMsg.auth_tag,
            );
          } else {
            // Decrypt incoming messages
            const ratchetMsg = {
              header: { DHpub: dbMsg.dh_pub, PN: dbMsg.pn, N: dbMsg.n },
              ciphertext: dbMsg.ciphertext,
              iv: dbMsg.iv,
              authTag: dbMsg.auth_tag,
            };

            const isNew = !dbMsg.id.startsWith("msg_00");
            if (isNew) {
              console.log(
                `[${currentUserIdentity.name}] Received raw blob from server:`,
                ratchetMsg,
              );
            }

            plaintext = ratchetDecrypt(state, ratchetMsg, noop);

            if (isNew) {
              console.log(
                `[${currentUserIdentity.name}] Decrypted plaintext:`,
                plaintext,
              );
            }
          }
        } catch (e) {
          console.error(`Failed to decrypt message ${dbMsg.id}`, e);
          // TODO: Add a better depiction for failed decryption
          plaintext = "[Decryption Failed]";
        }

        // Send text in readable format
        const baseMessage = toMessage(dbMsg);
        return {
          ...baseMessage,
          text: plaintext,
        };
      });

      encryptorRef.current = {
        encrypt: (text: string) => ratchetEncrypt(state, text, () => {}),
      };

      return decrypted;
    } catch (e) {
      console.warn("[useDecryption] Failed to initialize decryption state:", e);
      return dbMessages.map(toMessage);
    }
  }, [currentUserIdentity?.uuid, sessionContext, dbMessages]);

  return {
    decryptedMessages,
    encryptMessage: (text: string) => encryptorRef.current?.encrypt(text),
  };
}
