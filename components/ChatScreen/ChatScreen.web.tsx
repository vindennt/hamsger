import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { styles } from "./styles/index.web";
import { useChatStore } from "../../lib/store/useChatStore";
import { SessionManager } from "./SessionManager";
import { ContactSidebar } from "./components/ContactSidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";

export default function ChatScreen() {
  const isReady = useChatStore((s) => s.isReady);
  const currentPeer = useChatStore((s) => s.currentPeer);

  console.log("ChatScreen Render", Date.now(), { isReady, currentPeer });

  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Drawer state for mobile view
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerWidth = Math.min(width * 0.8, 320);
  const drawerAnim = useRef(new Animated.Value(-drawerWidth)).current;

  // Removed auto drawer open

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
          styles.root,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <SessionManager />
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SessionManager />
      
      <View style={styles.container}>
        {/* DESKTOP SIDEBAR */}
        {!isMobile && (
          <View style={styles.sidebar}>
            <ContactSidebar styles={styles} isMobile={false} />
          </View>
        )}

        {/* MAIN PANE */}
        <View style={[styles.mainPane, isMobile && { width: "100%" }]}>
          <ChatHeader styles={styles} isMobile={isMobile} setIsDrawerOpen={setIsDrawerOpen} />

          <MessageList isMobile={isMobile} setIsDrawerOpen={setIsDrawerOpen} />

          <ChatInput isMobile={isMobile} />
        </View>

        {/* MOBILE DRAWER BACKDROP */}
        {isMobile && isDrawerOpen && (
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
              <ContactSidebar styles={styles} isMobile={true} setIsDrawerOpen={setIsDrawerOpen} />
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
