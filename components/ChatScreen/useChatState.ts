import { useState } from "react";
import { EncryptedDbMessage } from "./types";
import { useDecryption } from "./useDecryption";
import { useSessionManager } from "./useSessionManager";

export const useChatState = () => {
  const {
    isReady,
    identities,
    currentUser,
    switchUser,
    currentPeer,
    setCurrentPeer,
    activeConversationId,
    activeSession,
    activeMessages,
    addMessage,
  } = useSessionManager();

  const [inputText, setInputText] = useState("");

  const { decryptedMessages, encryptMessage } = useDecryption(
    identities[currentUser],
    activeSession,
    activeMessages,
  );

  const sendMessage = () => {
    if (!inputText.trim()) return;

    if (!encryptMessage || !activeConversationId) {
      console.error("Encryption failed or not ready");
      return;
    }

    let ratchetMsg;
    try {
      ratchetMsg = encryptMessage(inputText.trim());
    } catch (e: any) {
      // TODO: remove this mock via hidden initial X3DH
      if (e.message.includes("no sending chain key")) {
        alert(
          "Mock Signal Protocol Constraint:\n\nSomeone needs to message Stanley first to initiate initial X3DH handshake",
        );
      } else {
        console.error(e);
      }
      return;
    }

    if (!ratchetMsg) return;

    const newDbMsg: EncryptedDbMessage = {
      id: `msg_new_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      conversation_id: activeConversationId,
      sender: currentUser,
      ciphertext: ratchetMsg.ciphertext,
      iv: ratchetMsg.iv,
      auth_tag: ratchetMsg.authTag,
      dh_pub: ratchetMsg.header.DHpub,
      pn: ratchetMsg.header.PN,
      n: ratchetMsg.header.N,
      timestamp: new Date().toISOString(),
      text: "", // placeholder
    };

    console.log(
      `[Server DB] Received encrypted blob from ${currentUser} for conv ${activeConversationId}:`,
      newDbMsg,
    );

    addMessage(activeConversationId, newDbMsg);
    setInputText("");
  };

  return {
    isReady,
    identities,
    currentUser,
    switchUser,
    currentPeer,
    setCurrentPeer,
    messages: decryptedMessages,
    inputText,
    setInputText,
    sendMessage,
  };
};
