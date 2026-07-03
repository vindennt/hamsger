// App entry layout
import { layoutStyles } from "@/components/styles/_layout.styles";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import "react-native-reanimated";

import { AuthProvider, useAuth } from "@/context/auth";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DatabaseProvider } from "@/lib/database/DatabaseProvider";
import {
  forceExpireSession,
  isSessionExpired,
  recordActivity,
} from "@/lib/session/sessionExpiry";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/lib/store/useChatStore";

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
    const isPostAuthScreen =
      segments[1] === "setup-pin" || segments[1] === "restore-keys";

    if (!session && !inAuthGroup) {
      useChatStore.getState().reset();
      router.replace("/(auth)/sign-in");
    } else if (session && inAuthGroup && !isPostAuthScreen) {
      setIsSyncingProfile(true);
      supabase
        .from("profiles")
        .select("id")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(async ({ data }) => {
          if (!data) {
            const username =
              session.user.user_metadata?.username ||
              `user_${session.user.id.substring(0, 8)}`;
            await supabase
              .from("profiles")
              .upsert({ id: session.user.id, username });
          }
          setIsSyncingProfile(false);
          router.replace("/(tabs)");
        });
    }
  }, [session, isLoading, segments, router]);

  // Record activity on session start to expire stale sessions
  // Separate from the navigation guard
  useEffect(() => {
    if (!session) return;

    async function checkAndRecord() {
      const expired = await isSessionExpired();
      if (expired) {
        await forceExpireSession();
        router.replace("/(auth)/sign-in");
      } else {
        await recordActivity();
      }
    }

    checkAndRecord();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkAndRecord();
    });

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", checkAndRecord);
    }

    return () => {
      sub.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", checkAndRecord);
      }
    };
  }, [session, router]);

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

export default function RootLayout() {
  return (
    <AuthProvider>
      <DatabaseProvider>
        <RootLayoutNav />
      </DatabaseProvider>
    </AuthProvider>
  );
}
