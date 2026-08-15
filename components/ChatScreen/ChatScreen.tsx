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
import { useChatStore } from "../../lib/store/useChatStore";
import { SessionManager } from "./SessionManager";
import { ChatHeader } from "./components/ChatHeader";
import { ChatInput } from "./components/ChatInput";
import { ContactSidebar } from "./components/ContactSidebar";
import { MessageList } from "./components/MessageList";
import { styles } from "./styles";

export default function ChatScreen() {
  const isReady = useChatStore((s) => s.isReady);
  const currentPeer = useChatStore((s) => s.currentPeer);

  // Drawer for friends list
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.8, 320);
  const drawerAnim = useRef(new Animated.Value(-drawerWidth)).current;

  useEffect(() => {
    Animated.timing(drawerAnim, {
      toValue: isDrawerOpen ? 0 : -drawerWidth,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isDrawerOpen, drawerWidth, drawerAnim]);

  return (
    <>
      {/* Ensure this component mounts once so subscription doesnt duplicate */}
      <SessionManager />

      {!isReady ? (
        <View
          style={[
            styles.container,
            { justifyContent: "center", alignItems: "center" },
          ]}
        >
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      ) : (
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            style={styles.container}
            behavior="padding"
            keyboardVerticalOffset={90}
          >
            {/* MAIN CHAT VIEW */}
            <View style={{ flex: 1 }}>
              <ChatHeader
                styles={styles}
                isMobile={true}
                setIsDrawerOpen={setIsDrawerOpen}
              />

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
                <ContactSidebar
                  styles={styles}
                  isMobile={true}
                  setIsDrawerOpen={setIsDrawerOpen}
                />
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      )}
    </>
  );
}
