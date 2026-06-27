import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useChatStore } from "../../../lib/store/useChatStore";

interface ChatHeaderProps {
  styles: any;
  isMobile?: boolean;
  setIsDrawerOpen?: (open: boolean) => void;
}

export function ChatHeader({ styles, isMobile, setIsDrawerOpen }: ChatHeaderProps) {
  const currentPeer = useChatStore((s) => s.currentPeer);

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
    </View>
  );
}
