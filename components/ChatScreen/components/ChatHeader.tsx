import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useChatStore } from "../../../lib/store/useChatStore";
import { resetConversation } from "../chatActions";

interface ChatHeaderProps {
  styles: any;
  isMobile?: boolean;
  setIsDrawerOpen?: (open: boolean) => void;
}

export function ChatHeader({ styles, isMobile, setIsDrawerOpen }: ChatHeaderProps) {
  const currentPeer = useChatStore((s) => s.currentPeer);

  const onResetSession = () => {
    // window.confirm is reliable on web (our test target); native taps through.
    const ok =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(
            `Reset the secure session with ${currentPeer}? This re-establishes encryption; a few in-flight messages may be dropped.`,
          )
        : true;
    if (ok) void resetConversation();
  };

  return (
    <View style={styles.chatHeader || styles.header}>
      {isMobile && setIsDrawerOpen && (
        <TouchableOpacity
          style={{ marginRight: 12, padding: 4 }}
          onPress={() => setIsDrawerOpen(true)}
          activeOpacity={0.6}
        >
          <IconSymbol name="line.3.horizontal" size={22} color="#007AFF" />
        </TouchableOpacity>
      )}
      <Text style={styles.chatHeaderTitle || styles.headerTitle}>
        {currentPeer || "Messages"}
      </Text>
      {currentPeer && (
        <TouchableOpacity
          style={{ marginLeft: "auto", padding: 4 }}
          onPress={onResetSession}
          activeOpacity={0.6}
          accessibilityLabel="Reset secure session"
        >
          <Text style={{ color: "#007AFF", fontSize: 13 }}>Reset session</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
