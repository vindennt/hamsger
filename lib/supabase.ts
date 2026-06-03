import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// Secure Storage Adapter for Supabase Auth
//
// Native: stores auth tokens in the device Keychain w/
// expo-secure-store
// Web: Local storage
//
// Split keys into 2KB chunks because of size limits

const CHUNK_SIZE = 1900; // Close to max sze

async function getSecureStore() {
  if (Platform.OS === "web") return null;
  return (await import("expo-secure-store")) as typeof import("expo-secure-store");
}

// Actual adapter
const secureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const store = await getSecureStore();
    if (!store) return null;

    const chunkCountStr = await store.getItemAsync(`${key}__chunks`);
    if (chunkCountStr !== null) {
      const chunkCount = parseInt(chunkCountStr, 10);
      const chunks: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunk = await store.getItemAsync(`${key}__chunk_${i}`);
        if (chunk === null) return null;
        chunks.push(chunk);
      }
      return chunks.join("");
    }

    return store.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = await getSecureStore();
    if (!store) return;

    if (value.length <= CHUNK_SIZE) {
      await store.setItemAsync(key, value);
      await store.deleteItemAsync(`${key}__chunks`).catch(() => {});
      return;
    }

    // Chunk splitting
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    // Delete oversized key
    await store.deleteItemAsync(key).catch(() => {});
    // Write chunks and the chunk count sentinel.
    await Promise.all(
      chunks.map((chunk, i) => store.setItemAsync(`${key}__chunk_${i}`, chunk)),
    );
    await store.setItemAsync(`${key}__chunks`, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const store = await getSecureStore();
    if (!store) return;

    const chunkCountStr = await store.getItemAsync(`${key}__chunks`);
    if (chunkCountStr !== null) {
      const chunkCount = parseInt(chunkCountStr, 10);
      await Promise.all([
        store.deleteItemAsync(`${key}__chunks`),
        ...Array.from({ length: chunkCount }, (_, i) =>
          store.deleteItemAsync(`${key}__chunk_${i}`),
        ),
      ]);
      return;
    }

    await store.deleteItemAsync(key).catch(() => {});
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Native: Keychain-backed secure storage for auth tokens.
    // Web:    existing localStorage adapter.
    storage: Platform.OS !== "web" ? secureStorageAdapter : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
    flowType: "pkce",
  },
});

// On mobile, dont refresh app state inactively to save battery.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
