import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fieldStyles, styles as authStyles } from "../../components/styles/auth.styles";
import { useAuth } from "../../context/auth";
import { resetUserKeys } from "../../lib/crypto/onboarding";
import {
  BackupPayload,
  decryptKeyBundleWithMnemonic,
  decryptKeyBundleWithPIN,
  importKeyBundle,
  loadBackupFromCloud,
  mnemonicToSeed,
} from "../../lib/crypto/pinBackup";

const MAX_PIN_ATTEMPTS = 10;

export default function RestoreKeysScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [backup, setBackup] = useState<BackupPayload | null>(null);
  const [loadingBackup, setLoadingBackup] = useState(true);
  const [mode, setMode] = useState<"pin" | "mnemonic">("pin");
  const [pin, setPin] = useState("");
  const [mnemonicInput, setMnemonicInput] = useState("");
  const [pinAttempts, setPinAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadBackupFromCloud(user.id)
      .then(setBackup)
      .catch((e) => console.error("[RestoreKeys] Failed to load backup:", e))
      .finally(() => setLoadingBackup(false));
  }, [user]);

  async function handleRestoreWithPIN() {
    if (!backup || !user) return;
    if (pinAttempts >= MAX_PIN_ATTEMPTS) {
      Alert.alert("Too many attempts", "Use your recovery phrase instead.");
      return;
    }
    setLoading(true);
    try {
      const bundle = await decryptKeyBundleWithPIN(backup, pin, user.id);
      await importKeyBundle(bundle);
      router.replace("/(tabs)");
    } catch {
      const next = pinAttempts + 1;
      setPinAttempts(next);
      if (next >= MAX_PIN_ATTEMPTS) {
        Alert.alert("PIN locked", "10 failed attempts. Use your recovery phrase.");
        setMode("mnemonic");
      } else {
        Alert.alert("Incorrect PIN", `${MAX_PIN_ATTEMPTS - next} attempts remaining`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreWithMnemonic() {
    if (!backup || !user) return;
    setLoading(true);
    try {
      const seedHex = mnemonicToSeed(mnemonicInput.trim());
      const bundle = await decryptKeyBundleWithMnemonic(backup, seedHex, user.id);
      await importKeyBundle(bundle);
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to restore with recovery phrase");
    } finally {
      setLoading(false);
    }
  }

  async function handleKeyReset() {
    if (!user) return;
    Alert.alert(
      "Reset Keys",
      "This will destroy your message history and generate new keys. Old messages will be unreadable. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await resetUserKeys(user.id);
              router.replace("/(auth)/setup-pin");
            } catch (e: any) {
              Alert.alert("Error", e.message || "Failed to reset keys");
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  if (loadingBackup) {
    return (
      <View style={local.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={local.loadingText}>Loading backup…</Text>
      </View>
    );
  }

  if (!backup) {
    return (
      <KeyboardAvoidingView style={authStyles.root} behavior="padding">
        <ScrollView contentContainerStyle={authStyles.scroll} alwaysBounceVertical={false}>
          <View style={authStyles.card}>
            <Text style={authStyles.title}>No Backup Found</Text>
            <Text style={authStyles.subtitle}>No key backup exists for this account.</Text>
            <Pressable
              style={({ pressed }) => [authStyles.btn, pressed && authStyles.btnPressed]}
              onPress={() => router.replace("/(auth)/setup-pin")}
            >
              <Text style={authStyles.btnText}>Set Up New Keys</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const pinLocked = pinAttempts >= MAX_PIN_ATTEMPTS;

  return (
    <KeyboardAvoidingView style={authStyles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={authStyles.scroll}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        <View style={authStyles.card}>
          <Text style={authStyles.title}>Restore Keys</Text>
          <Text style={authStyles.subtitle}>
            Your keys are backed up. Restore them to access your messages.
          </Text>

          <View style={local.segmentRow}>
            <SegmentButton label="PIN" active={mode === "pin"} onPress={() => setMode("pin")} />
            <SegmentButton label="Recovery Phrase" active={mode === "mnemonic"} onPress={() => setMode("mnemonic")} />
          </View>

          {mode === "pin" ? (
            <>
              <View style={fieldStyles.wrap}>
                <TextInput
                  style={fieldStyles.input}
                  placeholder="6-digit PIN"
                  placeholderTextColor="#8e8e93"
                  value={pin}
                  onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!pinLocked}
                />
              </View>
              {pinAttempts > 0 && (
                <Text style={local.attemptsText}>
                  {MAX_PIN_ATTEMPTS - pinAttempts} attempts remaining
                </Text>
              )}
            </>
          ) : (
            <View style={fieldStyles.wrap}>
              <TextInput
                style={local.mnemonicInput}
                placeholder="Enter your 12 recovery words separated by spaces"
                placeholderTextColor="#8e8e93"
                value={mnemonicInput}
                onChangeText={setMnemonicInput}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              authStyles.btn,
              pressed && authStyles.btnPressed,
              (loading || (mode === "pin" && pinLocked)) && authStyles.btnDisabled,
            ]}
            onPress={mode === "pin" ? handleRestoreWithPIN : handleRestoreWithMnemonic}
            disabled={loading || (mode === "pin" && pinLocked)}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={authStyles.btnText}>Restore</Text>}
          </Pressable>

          <Pressable onPress={() => setShowReset((v) => !v)}>
            <Text style={local.resetLink}>Reset Keys (Destroys Message History)</Text>
          </Pressable>

          {showReset && (
            <Pressable
              style={({ pressed }) => [local.resetBtn, pressed && { opacity: 0.8 }, loading && authStyles.btnDisabled]}
              onPress={handleKeyReset}
              disabled={loading}
            >
              <Text style={authStyles.btnText}>Confirm Reset</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[local.segment, active && local.segmentActive]}
    >
      <Text style={[local.segmentText, active && local.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
  },
  loadingText: {
    marginTop: 12,
    color: "#8e8e93",
    fontSize: 15,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#F2F2F7",
  },
  segmentActive: {
    backgroundColor: "#007AFF",
  },
  segmentText: {
    fontWeight: "600",
    color: "#000",
  },
  segmentTextActive: {
    color: "#fff",
  },
  attemptsText: {
    fontSize: 13,
    color: "#FF3B30",
  },
  mnemonicInput: {
    height: 100,
    paddingHorizontal: 16,
    paddingTop: 12,
    fontSize: 17,
    color: "#000",
    textAlignVertical: "top",
  },
  resetLink: {
    textAlign: "center",
    fontSize: 15,
    color: "#FF3B30",
    letterSpacing: -0.24,
  },
  resetBtn: {
    backgroundColor: "#FF3B30",
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
});
