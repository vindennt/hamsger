import React, { useState } from "react";
import { TextInput, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useChatStore } from "../../../lib/store/useChatStore";
import { sendMessage } from "../chatActions";
import { styles } from "../styles/index.web";

interface ChatInputProps {
  isMobile?: boolean;
}

export function ChatInput({ isMobile }: ChatInputProps) {
  const [inputText, setInputText] = useState("");
  const currentPeer = useChatStore((s) => s.currentPeer);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    await sendMessage(inputText);
    setInputText("");
  };

  const handleKeyPress = (e: any) => {
    // Only intercept Enter key on Web
    if (e.nativeEvent.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <View style={styles.inputContainer}>
      <TextInput
        style={styles.input}
        value={inputText}
        onChangeText={setInputText}
        placeholder={
          currentPeer ? `Message ${currentPeer}…` : "Select a contact first"
        }
        placeholderTextColor="#C7C7CC"
        onKeyPress={handleKeyPress}
        multiline
        editable={!!currentPeer}
      />
      <TouchableOpacity
        style={[
          styles.sendButton,
          (!inputText.trim() || !currentPeer) && { opacity: 0.35 },
        ]}
        onPress={handleSend}
        disabled={!inputText.trim() || !currentPeer}
        activeOpacity={0.7}
      >
        <IconSymbol name="paperplane.fill" size={16} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}
