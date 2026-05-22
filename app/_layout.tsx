// App entry layout
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import "react-native-reanimated";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

import { AuthProvider, useAuth } from "@/context/auth";
import { supabase } from "@/lib/supabase";
import { useColorScheme } from "@/hooks/use-color-scheme";

export const unstable_settings = {
  anchor: "(tabs)",
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [isSyncingProfile, setIsSyncingProfile] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (session && inAuthGroup) {
      setIsSyncingProfile(true);
      supabase
        .from("profiles")
        .select("id")
        .eq("id", session.user.id)
        .single()
        .then(async ({ data }) => {
          if (!data) {
            const username =
              session.user.user_metadata?.username ||
              `user_${session.user.id.substring(0, 8)}`;
            await supabase.from("profiles").upsert({ id: session.user.id, username });
          }
          setIsSyncingProfile(false);
          router.replace("/(tabs)");
        });
    }
  }, [session, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: "modal", title: "Modal" }}
        />
      </Stack>

      {isSyncingProfile && (
        <View style={[StyleSheet.absoluteFillObject, layoutStyles.overlay]}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={layoutStyles.overlayText}>Setting up encryption…</Text>
        </View>
      )}

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const layoutStyles = StyleSheet.create({
  overlay: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    zIndex: 9999,
  },
  overlayText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: "500",
    color: "#8E8E93",
    letterSpacing: -0.24,
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
