import { useState } from "react";
import { EncryptedDbMessage } from "./types";
import { useDecryption } from "./useDecryption";
import { useSessionManager } from "./useSessionManager";
import { messageRepo } from "../../lib/database/messageRepository";

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
    activeMessages,
    addMessage,
    loadOlderMessages,
    encryptOutgoingMessage,
    sendMessageToServer,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  } = useSessionManager();

  const [inputText, setInputText] = useState("");

  const { decryptedMessages } = useDecryption(activeMessages);

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

    const recipientIdentity = identities[currentPeer];
    if (recipientIdentity) {
      sendMessageToServer(recipientIdentity.uuid, serverDbMsg);
    }

    // Local DB message representation preserving plaintext and marked decrypted
    const localDbMsg: EncryptedDbMessage = {
      ...serverDbMsg,
      text: inputText.trim(), // plaintext is kept local only
      isDecrypted: true, // marked decrypted to prevent reprocessing on reload
    } as any;

    if (recipientIdentity) {
      try {
        await messageRepo.insertMessage({
          id: localDbMsg.id,
          conversation_id: localDbMsg.conversation_id,
          sender_id: localDbMsg.sender,
          recipient_id: recipientIdentity.uuid,
          ciphertext: localDbMsg.ciphertext,
          iv: localDbMsg.iv,
          auth_tag: localDbMsg.auth_tag,
          dh_pub: localDbMsg.dh_pub,
          pn: localDbMsg.pn,
          n: localDbMsg.n,
          created_at_server: localDbMsg.timestamp,
          timestamp: new Date().toISOString(),
          local_plaintext: inputText.trim()
        });
      } catch (dbErr) {
        console.error("Failed to insert sent message to local DB:", dbErr);
      }
    }

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
    loadOlderMessages,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  };
};
