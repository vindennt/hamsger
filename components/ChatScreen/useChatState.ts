import { useState } from "react";
import { EncryptedDbMessage, User } from "./types";
import { useDecryption } from "./useDecryption";

// Load the encrypted mock chat log
const mockLog = require("../../scripts/combined/mock_messages.json") as {
  _meta: any;
  messages: EncryptedDbMessage[];
};

// For now this will use local state.
export const useChatState = () => {
  const [currentUser, setCurrentUser] = useState<User>("Alice");
  const [dbMessages, setDbMessages] = useState<EncryptedDbMessage[]>(
    mockLog.messages,
  );
  const [inputText, setInputText] = useState("");

  const { decryptedMessages, encryptMessage } = useDecryption(currentUser, {
    _meta: mockLog._meta,
    messages: dbMessages,
  });

  const sendMessage = () => {
    if (!inputText.trim()) return;

    const ratchetMsg = encryptMessage(inputText.trim());
    if (!ratchetMsg) {
      console.error("Encryption failed or not ready");
      return;
    }

    const newDbMsg: EncryptedDbMessage = {
      id: `msg_new_${Date.now()}`,
      sender: currentUser,
      ciphertext: ratchetMsg.ciphertext,
      iv: ratchetMsg.iv,
      auth_tag: ratchetMsg.authTag,
      dh_pub: ratchetMsg.header.DHpub,
      pn: ratchetMsg.header.PN,
      n: ratchetMsg.header.N,
      timestamp: new Date().toISOString(),
      // empty fields for now
      conversation_id: "",
      text: "",
    };

    console.log(
      `[Server DB] Received encrypted blob from ${currentUser}:`,
      newDbMsg,
    );

    setDbMessages((prev) => [...prev, newDbMsg]);
    setInputText("");
  };

  const switchUser = (user: User) => {
    setCurrentUser(user);
  };

  return {
    currentUser,
    messages: decryptedMessages,
    inputText,
    setInputText,
    sendMessage,
    switchUser,
  };
};
