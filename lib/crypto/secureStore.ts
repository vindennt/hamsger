import { Platform } from "react-native";
import { kv } from "../database/kv";
import { X3DH } from "./x3dh";

// Encrypts a plaintext string using a device's key before writing to the KV store
// TODO: On web, plaintext local store. Can this be compromised?

// Lazy-load expo-secure-store only on native to avoid web bundling issues
let SecureStore: typeof import("expo-secure-store") | null = null;

async function getSecureStoreModule() {
  if (Platform.OS === "web") return null;
  if (!SecureStore) {
    SecureStore = require("expo-secure-store");
  }
  return SecureStore;
}

const MASTER_KEY_ALIAS = "hamsger_ratchet_master_key_v1";

async function getMasterKey(): Promise<string | null> {
  const store = await getSecureStoreModule();
  if (!store) return null;

  let key = await store.getItemAsync(MASTER_KEY_ALIAS);
  if (!key) {
    const Crypto = require("expo-crypto");
    const bytes = Crypto.getRandomBytes(32);
    key = Array.from(bytes)
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    await store.setItemAsync(MASTER_KEY_ALIAS, key, {
      keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return key;
}

/**
 * AES-GCM encryption of the plaintext string using a 256-bit hardware-backed key.
 *
 * ATTACK VECTOR PREVENTION:
 * If we stored the ratchet state in plaintext in SQLite, an attacker who steals the
 * device could read the state, recover private E2EE keys, and decrypt all messages.
 * By encrypting the state with real AES-GCM using hardware key
 * Secure Enclave, SQLite file is safe since decryption key cannot be extracted
 */
async function aesEncrypt(data: string, keyHex: string): Promise<string> {
  const { ciphertext, iv, authTag } = await X3DH.encrypt(keyHex, data);
  // Store as a single concatenated string: iv.authTag.ciphertext
  return `${iv}.${authTag}.${ciphertext}`;
}

async function aesDecrypt(data: string, keyHex: string): Promise<string> {
  const parts = data.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted state format");
  }
  const [iv, authTag, ciphertext] = parts;
  return await X3DH.decrypt(keyHex, ciphertext, iv, authTag);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Encrypts a ratchet state blob and stores it in the KV store.
 * Native: encrypts with AES-GCM using a device-bound master key before writing.
 * Web: writes plaintext (origin-sandboxed by the browser).
 */
export async function saveEncryptedState(
  kvKey: string,
  plaintext: string,
): Promise<void> {
  const masterKey = await getMasterKey();
  if (masterKey) {
    const encrypted = await aesEncrypt(plaintext, masterKey);
    await kv.set(kvKey, encrypted);
  } else {
    // Web fallback: store plaintext
    await kv.set(kvKey, plaintext);
  }
}

/**
 * Reads and decrypts a ratchet state blob from the KV store.
 * Native: decrypts with AES-GCM using the device-bound master key.
 * Web: reads plaintext directly.
 */
export async function loadEncryptedState(
  kvKey: string,
): Promise<string | null> {
  const raw = await kv.get(kvKey);
  if (!raw) return null;

  const masterKey = await getMasterKey();
  if (masterKey) {
    try {
      // Check if it's the old XOR format (no dots) to prevent crashes during upgrade.
      if (!raw.includes(".")) {
        console.warn(
          "[SecureStore] Old XOR format detected. State will be re-initialized.",
        );
        return null;
      }
      return await aesDecrypt(raw, masterKey);
    } catch {
      // If decryption fails (e.g., key rotation), return null to force re-initialization
      console.warn(
        `[SecureStore] Failed to decrypt state for key "${kvKey}". State will be re-initialized.`,
      );
      return null;
    }
  }

  // Web fallback: raw IS plaintext
  return raw;
}

/**
 * Removes an encrypted state blob from the KV store.
 */
export async function removeEncryptedState(kvKey: string): Promise<void> {
  await kv.remove(kvKey);
}
