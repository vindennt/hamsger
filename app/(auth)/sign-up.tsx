import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export default function SignUpScreen() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSignUp() {
    if (!username || !email || !password) {
      Alert.alert("Error", "Please fill in missing fields");
      return;
    }
    if (username.length < 3) {
      Alert.alert("Error", "Username must be at least 3 characters");
      return;
    }

    setLoading(true);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.signUp({ email, password });

    if (authError) {
      Alert.alert("Error", authError.message);
      setLoading(false);
      return;
    }

    if (user) {
      const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
      const { error: profileError } = await supabase
        .from("profiles")
        .insert({ id: user.id, username, discriminator });

      if (profileError) {
        Alert.alert("Error", profileError.message);
      } else {
        // TODO: Implement email verificaiton. For now, disable it for testing purposes.
        // Alert.alert("Check your email", "We sent you a confirmation link.");
        router.replace("/sign-in");
      }
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join the encrypted network</Text>

          <View style={styles.fields}>
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              pressed && styles.btnPressed,
              loading && styles.btnDisabled,
            ]}
            onPress={handleSignUp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Sign Up</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace("/sign-in")}>
            <Text style={styles.link}>
              Already have an account?{" "}
              <Text style={styles.linkBlue}>Log In</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: "default" | "email-address" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secureTextEntry?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[fieldStyles.wrap, focused && fieldStyles.wrapFocused]}>
      <TextInput
        style={fieldStyles.input}
        placeholder={props.label}
        placeholderTextColor="#8e8e93"
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType={props.keyboardType ?? "default"}
        autoCapitalize={props.autoCapitalize ?? "none"}
        secureTextEntry={props.secureTextEntry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
    gap: 16,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
  },
  subtitle: {
    fontSize: 14,
    color: "#8e8e93",
    marginTop: -8,
  },
  fields: {
    gap: 10,
  },
  btn: {
    backgroundColor: "#007aff",
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  link: {
    textAlign: "center",
    fontSize: 14,
    color: "#8e8e93",
  },
  linkBlue: {
    color: "#007aff",
    fontWeight: "600",
  },
});

const fieldStyles = StyleSheet.create({
  wrap: {
    backgroundColor: "#f2f2f7",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  wrapFocused: {
    borderColor: "#007aff",
    backgroundColor: "#fff",
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#000",
  },
});
