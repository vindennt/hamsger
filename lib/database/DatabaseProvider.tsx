import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import React from "react";
import { Platform } from "react-native";
import { migrateWebAtRestIfNeeded } from "../crypto/webAtRestMigration";
import { setKvDb } from "./kv";
import { setMessageDb } from "./messageRepository";
import { setOutboxDb } from "./outboxRepository";
import { migrateDbIfNeeded } from "./schema";

function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();

  setKvDb(db);
  setMessageDb(db);
  setOutboxDb(db);

  // On web, re-encrypt any legacy plaintext at rest BEFORE children mount and start
  // decrypting. Native has nothing to migrate, so it's ready immediately.
  const [ready, setReady] = React.useState(Platform.OS !== "web");

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    migrateWebAtRestIfNeeded(db)
      .catch((e) => console.error("[web-at-rest] migration failed", e))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  if (!ready) return null;
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
