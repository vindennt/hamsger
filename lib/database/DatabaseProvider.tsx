import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import React, { useEffect } from "react";
import { setKvDb } from "./kv";
import { setMessageDb } from "./messageRepository";
import { migrateDbIfNeeded } from "./schema";
function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();

  useEffect(() => {
    setKvDb(db);
    setMessageDb(db);
  }, [db]);

  return <>{children}</>;
}

/**
 * Native: native SQLITE c
 * Web: Wasm SQLITE
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  return (
    <SQLiteProvider databaseName="hamsger.db" onInit={migrateDbIfNeeded}>
      <DatabaseInitializer>{children}</DatabaseInitializer>
    </SQLiteProvider>
  );
}
