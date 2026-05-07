import { useState } from "react";
import { INITIAL_MESSAGES, Message, User } from "./types";

// For now this will use local state.
export const useChatState = () => {
  // Debug state for testing diff users
  const [currentUser, setCurrentUser] = useState<User>("Alice");
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
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
