import React, { useEffect, useRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "./styles";
import { useChatState } from "./useChatState";

export default function ChatScreen() {
  const {
    currentUser,
    messages,
    inputText,
    setInputText,
    sendMessage,
    switchUser,
  } = useChatState();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Encrypted Chat (iOS)</Text>
          <View style={styles.switcher}>
            <TouchableOpacity
              style={[
                styles.switchBtn,
                currentUser === "Alice" && styles.activeBtn,
              ]}
              onPress={() => switchUser("Alice")}
            >
              <Text
                style={[
                  styles.switchText,
                  currentUser === "Alice" && styles.activeText,
                ]}
              >
                Alice
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.switchBtn,
                currentUser === "Bob" && styles.activeBtn,
              ]}
              onPress={() => switchUser("Bob")}
            >
              <Text
                style={[
                  styles.switchText,
                  currentUser === "Bob" && styles.activeText,
                ]}
              >
                Bob
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          style={styles.chatWrapper}
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

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type message here"
            placeholderTextColor="#8e8e93"
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
