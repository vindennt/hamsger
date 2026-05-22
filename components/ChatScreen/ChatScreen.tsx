import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { styles } from "./styles";
import { useChatState } from "./useChatState";

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

  // Drawer for friends list
  const [isDrawerOpen, setIsDrawerOpen] = useState(!currentPeer);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.8, 320);
  const drawerAnim = useRef(
    new Animated.Value(!currentPeer ? 0 : -drawerWidth),
  ).current;

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

  const handleSelectPeer = (name: string) => {
    setCurrentPeer(name);
    setIsDrawerOpen(false);
  };

  const onPressAddContact = () => {
    Alert.prompt(
      "Add Contact",
      "Enter your friend's exact username:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: (text?: string) => {
            if (text) {
              handleAddContact(text).then((res) => {
                Alert.alert(res.success ? "Sent" : "Error", res.message);
              });
            }
          },
        },
      ],
      "plain-text",
    );
  };

  if (!isReady) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={90}
      >
        {/* MAIN CHAT VIEW */}
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
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
              <Text style={styles.headerTitle}>
                {currentPeer || "Messages"}
              </Text>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            style={styles.chatWrapper}
          >
            {!currentPeer ? (
              <View style={styles.emptyState}>
                <IconSymbol name="message.fill" size={40} color="#D1D1D6" />
                <Text style={styles.emptyStateText}>
                  Select a contact to start messaging
                </Text>
              </View>
            ) : messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  No messages yet. Say hello!
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

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                currentPeer ? `Message ${currentPeer}…` : "Select a contact"
              }
              placeholderTextColor="#C7C7CC"
              multiline
              editable={!!currentPeer}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || !currentPeer) && { opacity: 0.35 },
              ]}
              onPress={sendMessage}
              disabled={!inputText.trim() || !currentPeer}
              activeOpacity={0.7}
            >
              <IconSymbol name="paperplane.fill" size={16} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* DRAWER BACKDROP */}
        {isDrawerOpen && (
          <TouchableWithoutFeedback onPress={() => setIsDrawerOpen(false)}>
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

        {/* SLIDING DRAWER */}
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
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>{currentUser}</Text>
                <Text style={styles.headerSubtitle}>
                  {currentUserId.substring(0, 8)}…
                </Text>
              </View>
              <TouchableOpacity
                style={styles.signOutBtn}
                onPress={() => supabase.auth.signOut()}
                activeOpacity={0.6}
              >
                <Text style={styles.signOutBtnText}>Sign Out</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.contactsList}>
              <View style={styles.contactsHeader}>
                <Text style={styles.contactsTitle}>Contacts</Text>
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
                  <View
                    style={{
                      marginBottom: 16,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: "#E5E5EA",
                    }}
                  >
                    <View
                      style={[
                        styles.contactsHeader,
                        { backgroundColor: "transparent", paddingVertical: 6 },
                      ]}
                    >
                      <Text
                        style={[styles.contactsTitle, { color: "#007AFF" }]}
                      >
                        Requests ({pendingRequests.length})
                      </Text>
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
                          <Text
                            style={{
                              fontSize: 15,
                              fontWeight: "500",
                              color: "#000000",
                            }}
                            numberOfLines={1}
                          >
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
                            onPress={() =>
                              handleAcceptRequest(req.id, req.from_user_id)
                            }
                            activeOpacity={0.7}
                          >
                            <Text
                              style={{
                                color: "#ffffff",
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              Accept
                            </Text>
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
                            <Text
                              style={{
                                color: "#ffffff",
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              Decline
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {contacts.length === 0 ? (
                  <View style={styles.emptyState}>
                    <IconSymbol
                      name="person.2.fill"
                      size={36}
                      color="#D1D1D6"
                    />
                    <Text style={styles.emptyStateText}>No contacts yet</Text>
                  </View>
                ) : (
                  contacts.map((c) => (
                    <TouchableOpacity
                      key={c.uuid}
                      style={[
                        styles.contactItem,
                        currentPeer === c.name && {
                          backgroundColor: "#007AFF",
                        },
                      ]}
                      onPress={() => handleSelectPeer(c.name)}
                      activeOpacity={0.6}
                    >
                      <View
                        style={[
                          styles.contactAvatar,
                          currentPeer === c.name && {
                            backgroundColor: "rgba(255,255,255,0.2)",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.contactAvatarText,
                            currentPeer === c.name && {
                              color: "#ffffff",
                            },
                          ]}
                        >
                          {c.name[0].toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.contactInfo}>
                        <Text
                          style={[
                            styles.contactName,
                            currentPeer === c.name && {
                              color: "#ffffff",
                              fontWeight: "500",
                            },
                          ]}
                        >
                          {c.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
