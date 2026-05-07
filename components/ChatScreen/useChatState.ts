import { useState } from "react";
import {
  EncryptedDbMessage,
  FALLBACK_MESSAGES,
  Message,
  User,
  toMessage,
} from "./types";

// Load the encrypted mock chat log
// TODO: remove this test case and implement zero knowledge database reading
const mockLog = require("../../scripts/combined/mock_messages.json") as {
  _meta: Record<string, unknown>;
  messages: EncryptedDbMessage[];
};

const MOCK_MESSAGES: Message[] = (() => {
  try {
    return mockLog.messages.map(toMessage);
  } catch (e) {
    console.warn("[useChatState] Failed to load mock_messages.json:", e);
    return FALLBACK_MESSAGES;
  }
})();

// For now this will use local state.
export const useChatState = () => {
  // Debug state for testing diff users
  const [currentUser, setCurrentUser] = useState<User>("Alice");
  // TODO: implement decryption
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [inputText, setInputText] = useState("");

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

    setMessages((prev) => [...prev, newMessage]);
    setInputText("");
  };

  // TODO: remove this and implement logging in
  const switchUser = (user: User) => {
    setCurrentUser(user);
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
