import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../../context/auth";
import {
  exportKeyBundle,
  loadBackupFromCloud,
  refreshBackupBundle,
  saveBackupToCloud,
} from "../../lib/crypto/pinBackup";
import { forceExpireSession } from "../../lib/session/sessionExpiry";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [refreshPIN, setRefreshPIN] = useState("");
  const [showRefreshPIN, setShowRefreshPIN] = useState(false);

  async function handleRefreshBackup() {
    if (!user) return;
    setLoading(true);
    try {
      const existing = await loadBackupFromCloud(user.id);
      if (!existing) {
        Alert.alert("No Backup", "Complete PIN setup first before refreshing.");
        return;
      }
      const bundle = await exportKeyBundle(user.id);
      const payload = await refreshBackupBundle(
        existing,
        bundle,
        refreshPIN,
        user.id,
      );
      await saveBackupToCloud(user.id, payload);
      setShowRefreshPIN(false);
      setRefreshPIN("");
      Alert.alert("Done", "Backup updated with latest messages.");
    } catch (e: any) {
      Alert.alert(
        "Error",
        e.message?.includes("decrypt")
          ? "Wrong PIN"
          : e.message || "Failed to refresh backup",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    await signOut();
    setLoading(false);
  }

  async function handleExpireNow() {
    setLoading(true);
    try {
      await forceExpireSession();
      router.replace("/(auth)/sign-in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.pageTitle}>Settings</Text>

        {user && (
          <View style={styles.card}>
            <Text style={styles.label}>Signed in as</Text>
            <Text style={styles.value}>
              {user.user_metadata?.username || user.email}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Backup</Text>
          <SettingRow
            title="Refresh Backup"
            description="Update cloud backup with latest messages."
            onPress={() => setShowRefreshPIN((v) => !v)}
          />
          {showRefreshPIN && (
            <View style={styles.pinRow}>
              <TextInput
                style={styles.pinInput}
                placeholder="Enter PIN"
                placeholderTextColor="#8e8e93"
                value={refreshPIN}
                onChangeText={(t) =>
                  setRefreshPIN(t.replace(/\D/g, "").slice(0, 6))
                }
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.pinConfirm,
                  pressed && styles.pinConfirmPressed,
                  (refreshPIN.length !== 6 || loading) &&
                    styles.pinConfirmDisabled,
                ]}
                onPress={handleRefreshBackup}
                disabled={refreshPIN.length !== 6 || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.pinConfirmText}>Update</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Security</Text>
          <SettingRow
            title="Sign Out & Lock"
            description="Clears local keys. PIN required on next sign-in."
            onPress={handleExpireNow}
            color="#FF3B30"
          />
        </View>

        <View style={styles.card}>
          <SettingRow
            title="Sign Out"
            onPress={handleSignOut}
            color="#FF3B30"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  title,
  description,
  onPress,
  color = "#007AFF",
}: {
  title: string;
  description?: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={[styles.rowTitle, { color }]}>{title}</Text>
      {description && <Text style={styles.rowDescription}>{description}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  scroll: {
    padding: 20,
    gap: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
  },
  label: {
    fontSize: 12,
    color: "#8e8e93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 15,
    color: "#000",
  },
  sectionTitle: {
    fontSize: 13,
    color: "#8e8e93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  row: {
    paddingVertical: 12,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  rowDescription: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 2,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#C7C7CC",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: "#000",
  },
  pinConfirm: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pinConfirmPressed: {
    opacity: 0.7,
  },
  pinConfirmDisabled: {
    opacity: 0.4,
  },
  pinConfirmText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
