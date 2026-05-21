import React, { useEffect, useRef } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { styles } from "./styles";
import { User } from "./types";
import { useChatState } from "./useChatState";

export default function ChatScreen() {
  const {
    isReady,
    identities,
    currentUser,
    switchUser,
    currentPeer,
    setCurrentPeer,
    messages,
    inputText,
    setInputText,
    sendMessage,
  } = useChatState();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isReady) return null;

  const users: User[] = ["Alice", "Bob", "Stanley"];
  const peers = users.filter((u) => u !== currentUser);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={styles.headerTitle}>Encrypted Chat (Web)</Text>
            <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              ID: {identities[currentUser].uuid.substring(0, 8)}
            </Text>
          </View>
          <TouchableOpacity 
            style={{ backgroundColor: '#ff3b30', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}
            onPress={() => supabase.auth.signOut()}
          >
            <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.switcher, { marginTop: 12 }]}>
          {users.map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.switchBtn, currentUser === u && styles.activeBtn]}
              onPress={() => switchUser(u)}
            >
              <Text
                style={[
                  styles.switchText,
                  currentUser === u && styles.activeText,
                ]}
              >
                {u}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View
          style={{
            flexDirection: "row",
            marginTop: 10,
            justifyContent: "center",
          }}
        >
          <Text style={{ marginRight: 10, alignSelf: "center", color: "#666" }}>
            Chat with:
          </Text>
          {peers.map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.switchBtn,
                { paddingVertical: 4, paddingHorizontal: 12, marginRight: 6 },
                currentPeer === p && styles.activeBtn,
              ]}
              onPress={() => setCurrentPeer(p)}
            >
              <Text
                style={[
                  styles.switchText,
                  { fontSize: 12 },
                  currentPeer === p && styles.activeText,
                ]}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.chatWrapper}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg) => {
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
          })}
        </ScrollView>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type message here"
          placeholderTextColor="#9ca3af"
          onKeyPress={handleKeyPress}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
