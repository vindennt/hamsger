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
import {
  styles as authStyles,
  fieldStyles,
} from "../../components/styles/auth.styles";
import { useAuth } from "../../context/auth";
import { writeMasterKeyCanary } from "../../lib/crypto/masterKeyCanary";
import { ensureArchiveKey } from "../../lib/crypto/messageArchive";
import {
  encryptKeyBundle,
  exportKeyBundle,
  generateMnemonic,
  saveBackupToCloud,
} from "../../lib/crypto/pinBackup";

export default function SetupPinScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [seedHex, setSeedHex] = useState("");
  const [step, setStep] = useState<"pin" | "mnemonic">("pin");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { mnemonic: m, seedHex: s } = generateMnemonic();
    setMnemonic(m);
    setSeedHex(s);
  }, []);

  function handlePinNext() {
    if (!/^\d{6}$/.test(pin)) {
      Alert.alert("Error", "PIN must be exactly 6 digits");
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert("Error", "PINs do not match");
      return;
    }
    setStep("mnemonic");
  }

  async function handleFinish() {
    if (!confirmed) {
      Alert.alert(
        "Error",
        "Please confirm you have saved your recovery phrase",
      );
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      // Generate the archive key BEFORE export so it's captured in this first
      // backup blob — otherwise archive rows written before the next refresh
      // would be unrecoverable on a fresh restore.
      await ensureArchiveKey(user.id);
      const bundle = await exportKeyBundle(user.id);
      const payload = await encryptKeyBundle(bundle, pin, seedHex, user.id);
      await saveBackupToCloud(user.id, payload);
      // Witness that the current master key matches this device's data, so a
      // later IndexedDB/OPFS desync is detected instead of silently failing.
      await writeMasterKeyCanary(user.id);
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save backup");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={authStyles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={authStyles.scroll}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        <View style={authStyles.card}>
          {step === "pin" ? (
            <>
              <Text style={authStyles.title}>Set a PIN</Text>
              <Text style={authStyles.subtitle}>
                Your PIN encrypts your private keys for cloud backup
              </Text>

              <View style={authStyles.fields}>
                <PinField
                  label="6-digit PIN"
                  value={pin}
                  onChangeText={setPin}
                />
                <PinField
                  label="Confirm PIN"
                  value={confirmPin}
                  onChangeText={setConfirmPin}
                />
              </View>
              <Pressable
                style={({ pressed }) => [
                  authStyles.btn,
                  pressed && authStyles.btnPressed,
                ]}
                onPress={handlePinNext}
              >
                <Text style={authStyles.btnText}>Next</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={authStyles.title}>Recovery Phrase</Text>
              <Text style={authStyles.subtitle}>
                Write down these 12 words in order. They can recover your keys
                if you forget your PIN.
              </Text>

              <View style={local.wordGrid}>
                {mnemonic.split(" ").map((word, i) => (
                  <View key={i} style={local.wordChip}>
                    <Text style={local.wordIndex}>{i + 1}</Text>
                    <Text style={local.wordText}>{word}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                onPress={() => setConfirmed((v) => !v)}
                style={local.checkRow}
              >
                <View
                  style={[local.checkbox, confirmed && local.checkboxChecked]}
                >
                  {confirmed && <Text style={local.checkmark}>✓</Text>}
                </View>
                <Text style={local.checkLabel}>
                  I have saved my recovery phrase in a secure location
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  authStyles.btn,
                  pressed && authStyles.btnPressed,
                  (!confirmed || loading) && authStyles.btnDisabled,
                ]}
                onPress={handleFinish}
                disabled={!confirmed || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={authStyles.btnText}>Complete Setup</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PinField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[fieldStyles.wrap, focused && fieldStyles.wrapFocused]}>
      <TextInput
        style={fieldStyles.input}
        placeholder={label}
        placeholderTextColor="#8e8e93"
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
      />
    </View>
  );
}

const local = StyleSheet.create({
  wordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wordChip: {
    backgroundColor: "#F2F2F7",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  wordIndex: {
    fontSize: 11,
    color: "#8e8e93",
  },
  wordText: {
    fontSize: 14,
    fontWeight: "500",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: "#007AFF",
    backgroundColor: "#007AFF",
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
  },
  checkLabel: {
    fontSize: 14,
    color: "#3C3C43",
    flex: 1,
  },
});
