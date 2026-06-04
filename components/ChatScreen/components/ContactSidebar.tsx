import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useChatStore } from "../../../lib/store/useChatStore";
import { handleAcceptRequest, handleAddContact, handleRejectRequest } from "../SessionManager";
import { supabase } from "../../../lib/supabase";

// Accept styles as prop since Native and Web have different style files right now
export function ContactSidebar({ styles, isMobile, setIsDrawerOpen }: any) {
  const currentUser = useChatStore((s) => s.currentUser);
  const currentUserId = useChatStore((s) => s.currentUserId);
  const currentPeer = useChatStore((s) => s.currentPeer);
  const contacts = useChatStore((s) => s.contacts);
  const pendingRequests = useChatStore((s) => s.pendingRequests);
  const setCurrentPeer = useChatStore((s) => s.setCurrentPeer);

  const onPressAddContact = () => {
    // Basic prompt logic. Native ChatScreen had Alert.prompt, web had window.prompt
    // We'll use a unified approach or let the parent handle it if needed.
    // For simplicity, we just use window.prompt on web. On native we might need Alert.
    // We will assume it's passed down or we check platform.
    if (typeof window !== 'undefined' && window.prompt) {
      const friendName = window.prompt("Enter your friend's exact username:");
      if (friendName) {
        handleAddContact(currentUserId, currentUser, friendName).then((res) => {
          alert(res.message);
        });
      }
    }
  };

  const handleSelectPeer = (name: string) => {
    setCurrentPeer(name);
    if (isMobile && setIsDrawerOpen) {
      setIsDrawerOpen(false);
    }
  };

  return (
    <>
      <View style={styles.sidebarHeader || styles.header}>
        {styles.sidebarTitle ? (
          <>
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
          </>
        ) : (
          <View>
            <Text style={styles.headerTitle}>{currentUser}</Text>
            <Text style={styles.headerSubtitle}>
              {currentUserId.substring(0, 8)}…
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => supabase.auth.signOut()}
          activeOpacity={0.6}
        >
          <Text style={styles.signOutBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contactsHeader || styles.contactsList}>
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
          <View
            style={{
              marginBottom: 16,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: "#E5E5EA",
            }}
          >
            <View style={[styles.contactsHeader, { paddingVertical: 6, backgroundColor: 'transparent' }]}>
              <Text style={[styles.contactsTitle, { color: "#007AFF" }]}>
                REQUESTS ({pendingRequests.length})
              </Text>
            </View>
            {pendingRequests.map((req: any) => (
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
                      fontSize: 14,
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
                      handleAcceptRequest(req.id, currentUserId, req.from_user_id)
                    }
                    activeOpacity={0.7}
                  >
                    <Text
                      style={{
                        color: "#ffffff",
                        fontSize: 11,
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
                        fontSize: 11,
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
          <View style={styles.emptyState || { padding: 16 }}>
            {styles.emptyStateText ? (
              <Text style={styles.emptyStateText}>No contacts yet</Text>
            ) : (
              <Text style={{ color: "#8E8E93", fontSize: 15 }}>
                No contacts yet. Tap '+' to add a friend.
              </Text>
            )}
          </View>
        ) : (
          contacts.map((c) => (
            <TouchableOpacity
              key={c.uuid}
              style={[
                styles.contactItem,
                currentPeer === c.name && (styles.contactItemActive || { backgroundColor: "#007AFF" }),
              ]}
              onPress={() => handleSelectPeer(c.name)}
              activeOpacity={0.6}
            >
              {styles.contactAvatar && (
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
              )}
              <Text
                style={[
                  styles.contactName,
                  currentPeer === c.name && (styles.contactNameActive || { color: "#ffffff", fontWeight: "500" }),
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
}
