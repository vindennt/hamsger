import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type SQLiteDatabase } from "expo-sqlite";

let dbInstance: SQLiteDatabase | null = null;

export function setKvDb(db: SQLiteDatabase) {
  dbInstance = db;
}

export const kv = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web" || !dbInstance) {
      return await AsyncStorage.getItem(key);
    }
    const result = dbInstance.getFirstSync<{ value: string }>(
      "SELECT value FROM key_value_store WHERE key = ?",
      [key]
    );
    return result ? result.value : null;
  },

  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web" || !dbInstance) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    dbInstance.runSync(
      "INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?, ?)",
      [key, value]
    );
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === "web" || !dbInstance) {
      await AsyncStorage.removeItem(key);
      return;
    }
    dbInstance.runSync("DELETE FROM key_value_store WHERE key = ?", [key]);
  }
};
