import { type SQLiteDatabase } from "expo-sqlite";

/**
 * Current schema version. Bump this and add a new migration step
 * function (e.g. `migrateV1ToV2`) whenever the schema changes.
 */
const LATEST_VERSION = 4;

// ---------------------------------------------------------------------------
// Migration steps — one function per version bump
// ---------------------------------------------------------------------------

/**
 * v0 → v1: Initial schema.
 *
 * Creates the foundational tables for the E2EE messaging app:
 * - `contacts`        – known peers with their X25519 public keys
 * - `messages`        – ciphertext-only message store (no plaintext at rest)
 * - `key_value_store` – lightweight key/value pairs for app settings & ratchet state
 * - `errors`          – structured error log for debugging failed decryption / delivery
 *
 */
async function migrateV0ToV1(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`BEGIN TRANSACTION;`);

  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS contacts (
        id         TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        name       TEXT NOT NULL,
        status     TEXT
      );
    `);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL,
        sender_id         TEXT NOT NULL,
        recipient_id      TEXT NOT NULL,
        ciphertext        TEXT NOT NULL,
        iv                TEXT NOT NULL,
        auth_tag          TEXT NOT NULL,
        dh_pub            TEXT NOT NULL,
        pn                INTEGER NOT NULL,
        n                 INTEGER NOT NULL,
        created_at_server TEXT NOT NULL,
        timestamp         TEXT NOT NULL
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created
        ON messages(conversation_id, created_at_server);
    `);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS key_value_store (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS errors (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        type            TEXT NOT NULL,
        conversation_id TEXT,
        message_id      TEXT,
        error           TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await db.execAsync(`COMMIT;`);
  } catch (e) {
    await db.execAsync(`ROLLBACK;`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Future migration steps go here, e.g.:
//
// async function migrateV2ToV3(db: SQLiteDatabase): Promise<void> { … }
// ---------------------------------------------------------------------------

/**
 * v1 → v2: Add local_plaintext to messages.
 *
 * To support displaying historical messages without breaking forward secrecy,
 * we store the decrypted plaintext locally. It is encrypted at rest using a
 * hardware backed AES master key.
 */
async function migrateV1ToV2(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`BEGIN TRANSACTION;`);
  try {
    await db.execAsync(`
      ALTER TABLE messages ADD COLUMN local_plaintext TEXT;
    `);
    await db.execAsync(`COMMIT;`);
  } catch (e) {
    await db.execAsync(`ROLLBACK;`);
    throw e;
  }
}

/**
 * v2 → v3: Drop cryptographic columns to save space.
 */
async function migrateV2ToV3(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`BEGIN TRANSACTION;`);
  try {
    await db.execAsync(`ALTER TABLE messages DROP COLUMN ciphertext;`);
    await db.execAsync(`ALTER TABLE messages DROP COLUMN iv;`);
    await db.execAsync(`ALTER TABLE messages DROP COLUMN auth_tag;`);
    await db.execAsync(`ALTER TABLE messages DROP COLUMN dh_pub;`);
    await db.execAsync(`ALTER TABLE messages DROP COLUMN pn;`);
    await db.execAsync(`ALTER TABLE messages DROP COLUMN n;`);
    await db.execAsync(`COMMIT;`);
  } catch (e) {
    await db.execAsync(`ROLLBACK;`);
    throw e;
  }
}

/**
 * v3 → v4: Durable send outbox.
 *
 * Sends were previously fire-and-forget: a failed `message_queue` insert was
 * logged and dropped. The outbox persists the ENCRYPTED payload (ciphertext +
 * ratchet header) verbatim until delivery so a retry never re-runs the ratchet
 * (which would advance `n` and reorder). It's a dedicated table, not a status
 * column on `messages`, because v3 dropped the ciphertext columns.
 * See docs/impl/p2-reliability-outbox.md.
 */
async function migrateV3ToV4(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`BEGIN TRANSACTION;`);
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        msg_id          TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id       TEXT NOT NULL,
        recipient_id    TEXT NOT NULL,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        created_at      TEXT NOT NULL
      );
    `);
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
    `);
    await db.execAsync(`COMMIT;`);
  } catch (e) {
    await db.execAsync(`ROLLBACK;`);
    throw e;
  }
}

/**
 * Ordered list of migration functions.
 * Index 0 = v0→v1, index 1 = v1→v2, etc.
 */
const MIGRATIONS: readonly ((db: SQLiteDatabase) => Promise<void>)[] = [
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs any outstanding schema migrations.
 *
 * Designed to be passed directly to `<SQLiteProvider onInit={…}>`.
 *
 * Behaviour:
 * 1. Enables WAL journal mode for better read concurrency.
 * 2. Reads `PRAGMA user_version` to determine the current schema version.
 * 3. Sequentially applies every migration step between the current version
 *    and `LATEST_VERSION`. Each step runs inside its own transaction.
 * 4. Bumps `PRAGMA user_version` to `LATEST_VERSION` after all migrations
 *    succeed.
 *
 * Uses async SQLite methods throughout — this function is called inside an
 * async context (`onInit`).
 *
 * @param db - The `SQLiteDatabase` instance provided by expo-sqlite.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // WAL mode MUST be set outside a transaction, so we do it first.
  // On web (WASM/OPFS), WAL mode is silently ignored — OPFS uses its own
  // journaling mechanism. The pragma is harmless to run on all platforms.
  await db.execAsync(`PRAGMA journal_mode = 'wal';`);

  const result = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let currentVersion = result?.user_version ?? 0;

  if (currentVersion >= LATEST_VERSION) {
    return;
  }

  // Apply each migration step in order.
  while (currentVersion < LATEST_VERSION) {
    const migrate = MIGRATIONS[currentVersion];
    if (!migrate) {
      throw new Error(
        `[schema] Missing migration function for v${currentVersion} → v${currentVersion + 1}`,
      );
    }
    await migrate(db);
    currentVersion += 1;
  }

  // Persist the new version. This is intentionally outside the per-step
  // transactions so that partially-applied sequences are not re-attempted.
  await db.execAsync(`PRAGMA user_version = ${LATEST_VERSION};`);
}
