import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { styles } from "../../components/styles/auth.styles";
import { useAuth } from "../../context/auth";
import { supabase } from "../../lib/supabase";

// TODO: Verify thoroughly
export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { resendVerification } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") router.replace("/(tabs)");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  async function handleResend() {
    if (!email) return;
    setResending(true);
    const { error } = await resendVerification(email);
    setResending(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert("Sent", "Verification email resent. Check your inbox.");
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Check your inbox</Text>
          <Text style={styles.subtitle}>
            We sent a verification link to{"\n"}
            <Text style={{ fontWeight: "600", color: "#000" }}>{email}</Text>
          </Text>

          <Text style={{ fontSize: 14, color: "#8e8e93", lineHeight: 20 }}>
            Click the link in the email to confirm your account. The link
            expires in 24 hours.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              pressed && styles.btnPressed,
              resending && styles.btnDisabled,
            ]}
            onPress={handleResend}
            disabled={resending}
          >
            {resending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Resend email</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace("/(auth)/sign-in")}>
            <Text style={styles.link}>
              Back to <Text style={styles.linkBlue}>Sign In</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
