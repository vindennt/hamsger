import { useMemo } from "react";
import {
  initAlice,
  initBob,
  kdfMsgChain,
  ratchetDecrypt,
  RatchetState,
} from "../../lib/crypto/ratchet";
import { KeyPair, X3DH } from "../../lib/crypto/x3dh";
import { EncryptedDbMessage, Message, toMessage, User } from "./types";

export function useDecryption(
  currentUser: User,
  mockLog: { _meta: any; messages: EncryptedDbMessage[] },
): Message[] {
  return useMemo(() => {
    try {
      const keys = mockLog._meta.keys;
      let state: RatchetState;

      // Init user state
      if (currentUser === "Alice") {
        // Recreate mock Alice's exact initial state
        const aliceDHs = new KeyPair("Alice_DHs_0", keys.aliceDHsCore);
        state = initAlice(keys.SK, keys.bobRatchetPub, aliceDHs);
      } else {
        // Recreate mock Bob's exact initial state using his SPK
        const bobRatchetKP = new KeyPair(
          "Bob_SPK",
          keys.bobRatchetPriv.replace("priv_", ""),
        );
        state = initBob(keys.SK, bobRatchetKP);
      }

      const noop = () => {};

      // Decrypt messages
      const decrypted = mockLog.messages.map((dbMsg) => {
        let plaintext = "";

        try {
          if (dbMsg.sender === currentUser) {
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
            plaintext = ratchetDecrypt(state, ratchetMsg, noop);
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

      return decrypted;
    } catch (e) {
      console.warn("[useDecryption] Failed to initialize decryption state:", e);
      return mockLog.messages.map(toMessage);
    }
  }, [currentUser, mockLog]);
}
