import { useState } from "react";
import { EncryptedDbMessage } from "./types";
import { useDecryption } from "./useDecryption";
import { useSessionManager } from "./useSessionManager";

export const useChatState = () => {
  const {
    isReady,
    identities,
    currentUser,
    currentUserId,
    contacts,
    currentPeer,
    setCurrentPeer,
    activeConversationId,
    activeSession,
    activeMessages,
    addMessage,
    encryptOutgoingMessage,
    sendMessageToServer,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  } = useSessionManager();

  const [inputText, setInputText] = useState("");

  const { decryptedMessages } = useDecryption(
    identities[currentUser],
    activeSession,
    activeMessages,
  );

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    if (!activeConversationId) {
      console.error("Encryption failed or late");
      return;
    }

    let ratchetMsg;
    try {
      ratchetMsg = await encryptOutgoingMessage(
        activeConversationId,
        inputText.trim(),
      );
    } catch (e: any) {
      console.error("Encryption Ratchet Error:", e);
      return;
    }

    if (!ratchetMsg) return;

    // Encrypted DB message payload for the server
    const serverDbMsg: EncryptedDbMessage = {
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
      text: ratchetMsg.ciphertext, // Server never sees plaintext
    };

    // TODO: REmove
    console.log(
      `[Server DB] Sending encrypted blob from ${currentUser} for conv ${activeConversationId}:`,
      serverDbMsg,
    );

    const recipientIdentity = identities[currentPeer];
    if (recipientIdentity) {
      sendMessageToServer(recipientIdentity.uuid, serverDbMsg);
    }

    // Local DB message representation preserving plaintext and marked decrypted
    const localDbMsg: EncryptedDbMessage = {
      ...serverDbMsg,
      text: inputText.trim(), // plaintext is kept local only
      isDecrypted: true, // marked decrypted to prevent reprocessing on reload
      // TODO: can we avoid hardcoded flag?
    } as any;

    addMessage(activeConversationId, localDbMsg);
    setInputText("");
  };

  return {
    isReady,
    identities,
    currentUser,
    currentUserId,
    contacts,
    currentPeer,
    setCurrentPeer,
    messages: decryptedMessages,
    inputText,
    setInputText,
    sendMessage,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  };
};
