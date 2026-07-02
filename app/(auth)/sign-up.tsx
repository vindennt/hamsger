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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { fieldStyles, styles } from "../../components/styles/auth.styles";

export default function SignUpScreen() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [bypassVerification, setBypassVerification] = useState(true); // TODO: remove debug bypass
  const router = useRouter();
  async function handleSignUp() {
    if (!username || !email || !password) {
      Alert.alert("Error", "Please fill in missing fields");
      return;
    }

    const cleanUsername = username.toLowerCase().trim();
    if (cleanUsername.length < 3) {
      Alert.alert("Error", "Username must be at least 3 characters");
      return;
    }

    setLoading(true);

    const { data: existingUser, error: checkError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (existingUser) {
      Alert.alert("Error", "Username is already taken");
      setLoading(false);
      return;
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: cleanUsername,
        },
      },
    });

    if (authError) {
      Alert.alert("Error", authError.message);
      setLoading(false);
      return;
    }

    if (user) {
      await supabase
        .from("profiles")
        .upsert(
          { id: user.id, username: cleanUsername },
          { onConflict: "id", ignoreDuplicates: true },
        );

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session && !bypassVerification) {
        router.replace({ pathname: "/(auth)/verify-email", params: { email } });
      } else {
        router.replace("/(tabs)");
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

          {/* TODO: Remove later */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontSize: 13, color: "#8e8e93" }}>
              Bypass email verification (Debug)
            </Text>
            <Switch
              value={bypassVerification}
              onValueChange={setBypassVerification}
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
