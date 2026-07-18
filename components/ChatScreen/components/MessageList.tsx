import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useEffect, useRef } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { retrySend } from "../../../lib/outbox/outbox";
import { useChatStore } from "../../../lib/store/useChatStore";
import { styles } from "../styles/index.web";
import { useDecryption } from "../useDecryption";
import { usePagination } from "../usePagination";

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
      ? [identities[currentUser].uuid, identities[currentPeer].uuid]
          .sort()
          .join(":")
      : "";

  const activeMessages = messagesDB[activeConversationId] || [];
  const { decryptedMessages: messages } = useDecryption(activeMessages);

  const { loadOlder } = usePagination(activeConversationId);

  // Auto scroll for new messages
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id;
    if (lastId && lastId !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastId;
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Scroll-anchor preservation across an older-page prepend: capture height + offset
  // at trigger, restore offset by the height delta once the new rows have laid out.
  const loadingOlderRef = useRef(false);
  const prevContentHeightRef = useRef(0);
  const prevScrollYRef = useRef(0);

  useEffect(() => {
    loadingOlderRef.current = false;
    lastMessageIdRef.current = undefined;
  }, [activeConversationId]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (y <= 80 && !loadingOlderRef.current) {
      loadingOlderRef.current = true;
      prevContentHeightRef.current = e.nativeEvent.contentSize.height;
      prevScrollYRef.current = y;
      void loadOlder().then((fetched) => {
        if (fetched === 0) loadingOlderRef.current = false;
      });
    }
  };

  const handleContentSizeChange = (_w: number, h: number) => {
    if (loadingOlderRef.current) {
      const delta = h - prevContentHeightRef.current;
      if (delta > 0) {
        scrollViewRef.current?.scrollTo({
          y: prevScrollYRef.current + delta,
          animated: false,
        });
        loadingOlderRef.current = false;
      }
    }
  };

  return (
    <View style={styles.chatWrapper}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
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
                    {isMe && msg.send_status === "pending" && " · Sending…"}
                    {isMe && msg.send_status === "sent" && " · Sent"}
                  </Text>
                  {isMe && msg.send_status === "failed" && (
                    <TouchableOpacity
                      onPress={() => retrySend(activeConversationId, msg.id)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={{ color: "#FF3B30", fontSize: 11, marginTop: 2 }}
                      >
                        Not delivered · Tap to retry
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
