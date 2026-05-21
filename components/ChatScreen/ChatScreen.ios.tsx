import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
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
  } = useChatState();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const onPressAddContact = () => {
    Alert.prompt(
      "Add Contact",
      "Enter your friend's username:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: (text?: string) => {
            if (text) {
              handleAddContact(text).then((res) => {
                Alert.alert(res.success ? "Success" : "Error", res.message);
              });
            }
          },
        },
      ],
      "plain-text"
    );
  };

  if (!isReady) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#007aff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.header}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <View>
              <Text style={styles.headerTitle}>Welcome, {currentUser}</Text>
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 4 }}>
                ID: {currentUserId}
              </Text>
            </View>
            <TouchableOpacity
              style={{
                backgroundColor: "#ff3b30",
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
              }}
              onPress={() => supabase.auth.signOut()}
            >
              <Text style={{ color: "white", fontSize: 12, fontWeight: "bold" }}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Scrollable Contacts List Panel */}
        <View
          style={{
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: "#e5e5ea",
            backgroundColor: "#ffffff",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingHorizontal: 16,
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#1c1c1e" }}>
              Contacts
            </Text>
            <TouchableOpacity
              style={{
                backgroundColor: "#007aff",
                width: 24,
                height: 24,
                borderRadius: 12,
                justifyContent: "center",
                alignItems: "center",
              }}
              onPress={onPressAddContact}
            >
              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 16,
                  fontWeight: "bold",
                  marginTop: -2,
                }}
              >
                +
              </Text>
            </TouchableOpacity>
          </View>

          {contacts.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: "#8e8e93", fontSize: 13, fontStyle: "italic" }}>
                No contacts. Tap '+' to add a friend.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              {contacts.map((c) => (
                <TouchableOpacity
                  key={c.uuid}
                  style={[
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 16,
                      borderRadius: 20,
                      backgroundColor: "#f2f2f7",
                      borderWidth: 1,
                      borderColor: "#e5e5ea",
                    },
                    currentPeer === c.name && {
                      backgroundColor: "#007aff",
                      borderColor: "#007aff",
                    },
                  ]}
                  onPress={() => setCurrentPeer(c.name)}
                >
                  <Text
                    style={[
                      { fontSize: 13, color: "#1c1c1e", fontWeight: "500" },
                      currentPeer === c.name && {
                        color: "#ffffff",
                        fontWeight: "600",
                      },
                    ]}
                  >
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          style={styles.chatWrapper}
        >
          {currentPeer ? (
            messages.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  paddingVertical: 40,
                }}
              >
                <Text style={{ color: "#8e8e93", fontSize: 14 }}>
                  No messages yet. Send a message to start E2EE chat!
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
                        <Text style={styles.avatarText}>{msg.sender[0]}</Text>
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
            )
          ) : (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                paddingVertical: 60,
              }}
            >
              <Text
                style={{
                  color: "#8e8e93",
                  fontSize: 14,
                  textAlign: "center",
                  paddingHorizontal: 24,
                }}
              >
                Select a contact from the list above or tap '+' to start a new chat.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              currentPeer ? `Message ${currentPeer}...` : "Select a contact first"
            }
            placeholderTextColor="#8e8e93"
            multiline
            editable={!!currentPeer}
          />
          <TouchableOpacity
            style={[styles.sendButton, !currentPeer && { opacity: 0.5 }]}
            onPress={sendMessage}
            disabled={!currentPeer}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
