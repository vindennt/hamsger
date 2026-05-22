import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { styles } from "./styles/index.web";
import { useChatState } from "./useChatState";
import { IconSymbol } from "@/components/ui/icon-symbol";

export default function ChatScreen() {
  const {
    isReady,
    currentUser,
    currentUserId,
    contacts,
    currentPeer,
    setCurrentPeer,
    messages,
    inputText,
    setInputText,
    sendMessage,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  } = useChatState();
  const scrollViewRef = useRef<ScrollView>(null);

  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Drawer state for mobile view
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerWidth = Math.min(width * 0.8, 320);
  const drawerAnim = useRef(new Animated.Value(-drawerWidth)).current;

  useEffect(() => {
    if (isMobile && !currentPeer) {
      setIsDrawerOpen(true);
    }
  }, [isMobile, currentPeer]);

  useEffect(() => {
    Animated.timing(drawerAnim, {
      toValue: isDrawerOpen ? 0 : -drawerWidth,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isDrawerOpen, drawerWidth]);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const onPressAddContact = () => {
    const friendName = prompt("Enter your friend's exact username:");
    if (friendName) {
      handleAddContact(friendName).then((res) => {
        alert(res.message);
      });
    }
  };

  const handleSelectPeer = (name: string) => {
    setCurrentPeer(name);
    if (isMobile) {
      setIsDrawerOpen(false);
    }
  };

  if (!isReady) {
    return (
      <View
        style={[
          styles.root,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  }

  // ── Shared contact list content ──────────────────────────────────────
  const ContactList = () => (
    <>
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>{currentUser}</Text>
        <Text
          style={{
            fontSize: 12,
            color: "#8E8E93",
            marginTop: 2,
            letterSpacing: 0,
          }}
        >
          {currentUserId.substring(0, 8)}…
        </Text>
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => supabase.auth.signOut()}
          activeOpacity={0.6}
        >
          <Text style={styles.signOutBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contactsHeader}>
        <Text style={styles.contactsTitle}>CONTACTS</Text>
        <TouchableOpacity
          style={styles.addContactBtn}
          onPress={onPressAddContact}
          activeOpacity={0.7}
        >
          <Text style={styles.addContactBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {pendingRequests && pendingRequests.length > 0 && (
          <View style={{ marginBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
            <View style={[styles.contactsHeader, { paddingVertical: 6 }]}>
              <Text style={[styles.contactsTitle, { color: "#007AFF" }]}>REQUESTS ({pendingRequests.length})</Text>
            </View>
            {pendingRequests.map((req) => (
              <View
                key={req.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: "#000000" }} numberOfLines={1}>
                    {req.profiles?.username || "Unknown"}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#8E8E93" }}>
                    {new Date(req.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <TouchableOpacity
                    style={{
                      backgroundColor: "#34C759",
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                    }}
                    onPress={() => handleAcceptRequest(req.id, req.from_user_id)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "600" }}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{
                      backgroundColor: "#FF3B30",
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                    }}
                    onPress={() => handleRejectRequest(req.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "600" }}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {contacts.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 15,
                letterSpacing: -0.24,
              }}
            >
              No contacts yet. Tap '+' to add a friend.
            </Text>
          </View>
        ) : (
          contacts.map((c) => (
            <TouchableOpacity
              key={c.uuid}
              style={[
                styles.contactItem,
                currentPeer === c.name && styles.contactItemActive,
              ]}
              onPress={() => handleSelectPeer(c.name)}
              activeOpacity={0.6}
            >
              <Text
                style={[
                  styles.contactName,
                  currentPeer === c.name && styles.contactNameActive,
                ]}
              >
                {c.name}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </>
  );

  return (
    <View style={styles.root}>
      <View style={styles.container}>
        {/* DESKTOP SIDEBAR */}
        {!isMobile && (
          <View style={styles.sidebar}>
            <ContactList />
          </View>
        )}

        {/* MAIN PANE */}
        <View style={[styles.mainPane, isMobile && { width: "100%" }]}>
          <View style={styles.chatHeader}>
            {isMobile && (
              <TouchableOpacity
                style={{ marginRight: 12, padding: 4 }}
                onPress={() => setIsDrawerOpen(true)}
                activeOpacity={0.6}
              >
                <IconSymbol
                  name="line.3.horizontal"
                  size={22}
                  color="#007AFF"
                />
              </TouchableOpacity>
            )}
            <Text style={styles.chatHeaderTitle}>
              {currentPeer || "Messages"}
            </Text>
          </View>

          <View style={styles.chatWrapper}>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
            >
              {!currentPeer ? (
                <View style={styles.emptyState}>
                  <IconSymbol
                    name="message.fill"
                    size={40}
                    color="#D1D1D6"
                  />
                  <Text
                    style={[styles.emptyStateText, { marginTop: 12 }]}
                  >
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
                        isMe
                          ? styles.messageRowMe
                          : styles.messageRowOther,
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
                          isMe
                            ? styles.bubbleMe
                            : styles.bubbleOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.messageText,
                            isMe
                              ? styles.messageTextMe
                              : styles.messageTextOther,
                          ]}
                        >
                          {msg.text}
                        </Text>
                        <Text
                          style={[
                            styles.timeText,
                            isMe
                              ? styles.timeTextMe
                              : styles.timeTextOther,
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

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                currentPeer
                  ? `Message ${currentPeer}…`
                  : "Select a contact first"
              }
              placeholderTextColor="#C7C7CC"
              onKeyPress={handleKeyPress}
              multiline
              editable={!!currentPeer}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || !currentPeer) && {
                  opacity: 0.35,
                },
              ]}
              onPress={sendMessage}
              disabled={!inputText.trim() || !currentPeer}
              activeOpacity={0.7}
            >
              <IconSymbol
                name="paperplane.fill"
                size={16}
                color="#ffffff"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* MOBILE DRAWER BACKDROP */}
        {isMobile && isDrawerOpen && (
          <TouchableWithoutFeedback
            onPress={() => setIsDrawerOpen(false)}
          >
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
                backgroundColor: "rgba(0,0,0,0.3)",
                zIndex: 10,
              }}
            />
          </TouchableWithoutFeedback>
        )}

        {/* MOBILE DRAWER */}
        {isMobile && (
          <Animated.View
            style={[
              {
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                backgroundColor: "#F9F9F9",
                zIndex: 20,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderRightColor: "#D1D1D6",
              },
              {
                transform: [{ translateX: drawerAnim }],
                width: drawerWidth,
              },
            ]}
          >
            <View style={{ flex: 1, paddingTop: 16 }}>
              <ContactList />
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
