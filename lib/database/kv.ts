import { type SQLiteDatabase } from "expo-sqlite";
let dbInstance: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (!dbInstance) {
    throw new Error(
      "[kv] Database not initialised. Ensure <DatabaseProvider> wraps the component tree.",
    );
  }
  return dbInstance;
}
export function setKvDb(db: SQLiteDatabase): void {
  dbInstance = db;
}

export const kv = {
  async get(key: string): Promise<string | null> {
    const row = await getDb().getFirstAsync<{ value: string }>(
      "SELECT value FROM key_value_store WHERE key = ?",
      [key],
    );
    return row ? row.value : null;
  },

  async set(key: string, value: string): Promise<void> {
    await getDb().runAsync(
      "INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?, ?)",
      [key, value],
    );
  },

  async remove(key: string): Promise<void> {
    await getDb().runAsync("DELETE FROM key_value_store WHERE key = ?", [key]);
  },
};
