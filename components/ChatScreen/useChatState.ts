import { useState } from "react";
import { EncryptedDbMessage, Message, User } from "./types";
import { useDecryption } from "./useDecryption";

// Load the encrypted mock chat log
const mockLog = require("../../scripts/combined/mock_messages.json") as {
  _meta: any;
  messages: EncryptedDbMessage[];
};

// For now this will use local state.
export const useChatState = () => {
  // Debug state for testing diff users
  const [currentUser, setCurrentUser] = useState<User>("Alice");

  // Feed the encrypted DB messages through the Double Ratchet engine
  const decryptedMessages = useDecryption(currentUser, mockLog);

  // Track newly sent messages in the current session
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  const [inputText, setInputText] = useState("");

  const messages = [...decryptedMessages, ...localMessages];

  const sendMessage = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: currentUser,
      text: inputText.trim(),
      timestamp: new Date(),
    };

    console.log(
      `[Message Sent] Sender: ${currentUser}, Text: ${newMessage.text}`,
    );

    setLocalMessages((prev) => [...prev, newMessage]);
    setInputText("");
  };

  const switchUser = (user: User) => {
    setCurrentUser(user);
    // TODO: send messags in encrypted state so we dont have to clear the new messages.
    setLocalMessages([]);
  };

  return {
    currentUser,
    messages,
    inputText,
    setInputText,
    sendMessage,
    switchUser,
  };
};
