import { Platform } from "react-native";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { migrateDbIfNeeded } from "./schema";
import { setKvDb } from "./kv";
import { useEffect } from "react";

function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  
  useEffect(() => {
    setKvDb(db);
  }, [db]);

  return <>{children}</>;
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "web") {
    // Web falls back to AsyncStorage via our kv abstraction
    return <>{children}</>;
  }

  return (
    <SQLiteProvider databaseName="hamsger.db" onInit={migrateDbIfNeeded}>
      <DatabaseInitializer>{children}</DatabaseInitializer>
    </SQLiteProvider>
  );
}
