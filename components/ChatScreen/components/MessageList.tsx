import React, { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useChatStore } from "../../../lib/store/useChatStore";
import { useDecryption } from "../useDecryption";
import { styles } from "../styles/index.web";

interface MessageListProps {
  isMobile?: boolean;
  setIsDrawerOpen?: (open: boolean) => void;
}

export function MessageList({ isMobile, setIsDrawerOpen }: MessageListProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const currentPeer = useChatStore((s) => s.currentPeer);
  const currentUser = useChatStore((s) => s.currentUser);
  const identities = useChatStore((s) => s.identities);
  const messagesDB = useChatStore((s) => s.messagesDB);

  const activeConversationId =
    currentPeer && identities[currentUser] && identities[currentPeer]
      ? [identities[currentUser].uuid, identities[currentPeer].uuid].sort().join(":")
      : "";

  const activeMessages = messagesDB[activeConversationId] || [];
  const { decryptedMessages: messages } = useDecryption(activeMessages);

  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  return (
    <View style={styles.chatWrapper}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
      >
        {!currentPeer ? (
          <View style={styles.emptyState}>
            <IconSymbol name="message.fill" size={40} color="#D1D1D6" />
            <Text style={[styles.emptyStateText, { marginTop: 12 }]}>
              {isMobile
                ? "Tap the menu icon to select a contact"
                : "Select a contact to start messaging"}
            </Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No messages yet. Say hello to {currentPeer}!
            </Text>
          </View>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === currentUser;
            return (
              <View
                key={msg.id}
                style={[
                  styles.messageRow,
                  isMe ? styles.messageRowMe : styles.messageRowOther,
                ]}
              >
                {!isMe && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {msg.sender[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.bubble,
                    isMe ? styles.bubbleMe : styles.bubbleOther,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      isMe ? styles.messageTextMe : styles.messageTextOther,
                    ]}
                  >
                    {msg.text}
                  </Text>
                  <Text
                    style={[
                      styles.timeText,
                      isMe ? styles.timeTextMe : styles.timeTextOther,
                    ]}
                  >
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
