import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "./styles";
import { useChatStore } from "../../lib/store/useChatStore";
import { SessionManager } from "./SessionManager";
import { ContactSidebar } from "./components/ContactSidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";

export default function ChatScreen() {
  const isReady = useChatStore((s) => s.isReady);
  const currentPeer = useChatStore((s) => s.currentPeer);

  // Drawer for friends list
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.8, 320);
  const drawerAnim = useRef(
    new Animated.Value(-drawerWidth),
  ).current;

  useEffect(() => {
    Animated.timing(drawerAnim, {
      toValue: isDrawerOpen ? 0 : -drawerWidth,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isDrawerOpen, drawerWidth, drawerAnim]);

  if (!isReady) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <SessionManager />
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SessionManager />
      
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={90}
      >
        {/* MAIN CHAT VIEW */}
        <View style={{ flex: 1 }}>
          <ChatHeader styles={styles} isMobile={true} setIsDrawerOpen={setIsDrawerOpen} />

          <MessageList isMobile={true} setIsDrawerOpen={setIsDrawerOpen} />

          <ChatInput isMobile={true} />
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
            <ContactSidebar styles={styles} isMobile={true} setIsDrawerOpen={setIsDrawerOpen} />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
