import { sha256 } from "@noble/hashes/sha2.js";
import { kv } from "../database/kv";
import { supabase } from "../supabase";
import { BIP39_WORDLIST } from "./bip39Words";
import { deriveWrappingKeyHex, type KdfId } from "./kdf";
import { loadEncryptedState, saveEncryptedState } from "./secureStore";
import { toHex, X3DH } from "./x3dh";

function getRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

// BIP-39 mnemonic (128-bit entropy → 12 words)

export function generateMnemonic(): { mnemonic: string; seedHex: string } {
  const entropy = getRandomBytes(16);

  const hash = sha256(entropy);
  const checksumBits = (hash[0] >> 4).toString(2).padStart(4, "0");

  let bits = "";
  for (const byte of entropy) bits += byte.toString(2).padStart(8, "0");
  bits += checksumBits;

  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = parseInt(bits.slice(i * 11, i * 11 + 11), 2);
    words.push(BIP39_WORDLIST[idx]);
  }

  return { mnemonic: words.join(" "), seedHex: toHex(entropy) };
}

export function mnemonicToSeed(mnemonic: string): string {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12) throw new Error("Mnemonic must be exactly 12 words");

  let bits = "";
  for (const word of words) {
    const idx = BIP39_WORDLIST.indexOf(word);
    if (idx === -1) throw new Error(`Invalid mnemonic word: "${word}"`);
    bits += idx.toString(2).padStart(11, "0");
  }

  const entropyBits = bits.slice(0, 128);
  const checksumBits = bits.slice(128);

  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }

  const hash = sha256(entropy);
  const expectedChecksum = (hash[0] >> 4).toString(2).padStart(4, "0");
  if (checksumBits !== expectedChecksum)
    throw new Error("Invalid mnemonic checksum");

  return toHex(entropy);
}

// Key derivation lives in ./kdf (Argon2id for new backups, PBKDF2 decrypt-only).

// Payload shape

export interface BackupPayload {
  ciphertext_bundle: string;
  iv_bundle: string;
  auth_tag_bundle: string;
  wrapped_key_pin: string;
  iv_pin: string;
  auth_tag_pin: string;
  wrapped_key_mnemonic: string;
  iv_mnemonic: string;
  auth_tag_mnemonic: string;
  // KDF version tag. Absent/undefined = legacy PBKDF2 (pre-Argon2id backups).
  kdf?: KdfId;
}

// Key bundle export / import

export async function exportKeyBundle(userId: string): Promise<string> {
  const knownKeys = [
    `ik_priv_${userId}`,
    `ik_pub_${userId}`,
    `spk_priv_${userId}`,
    `spk_pub_${userId}`,
    `sig_priv_${userId}`,
    `sig_pub_${userId}`,
    // Long-lived key that decrypts the incremental cloud archive. It MUST ride
    // inside this Argon2id-wrapped blob so restore recovers the whole archive
    // (docs/impl/p3-cloud-archive-hybrid.md).
    `archive_key_${userId}`,
  ];

  const keyEntries: Record<string, string> = {};
  for (const key of knownKeys) {
    const val = await kv.get(key);
    if (val) keyEntries[key] = val;
  }

  const opkRows = await kv.getAllByPrefix(`opk_priv_${userId}`);
  for (const { key, value } of opkRows) keyEntries[key] = value;

  // Ratchet states are stored device-encrypted; export plaintext so they're
  // portable to new devices which will re-encrypt with their own master key.
  const ratchetRows = await kv.getAllByPrefix(`ratchetState_v3_${userId}`);
  const ratchetStates: Record<string, string> = {};
  for (const { key } of ratchetRows) {
    const plaintext = await loadEncryptedState(key);
    if (plaintext) ratchetStates[key] = plaintext;
  }

  // Message history now lives in the incremental cloud archive (message_archive),
  // NOT in this blob — so the blob stays small and bounded as history grows and
  // #8 auto-refresh only re-uploads KB.
  return JSON.stringify({ keyEntries, ratchetStates });
}

export async function importKeyBundle(bundle: string): Promise<void> {
  const { keyEntries, ratchetStates } = JSON.parse(bundle) as {
    keyEntries: Record<string, string>;
    ratchetStates: Record<string, string>;
  };

  for (const [key, value] of Object.entries(keyEntries)) {
    await kv.set(key, value);
  }

  // Restore ratchet states only where none exist locally.
  // Existing states are more recent than the backup and must not be overwritten,
  // otherwise messages exchanged since the last backup become unreadable.
  for (const [key, plaintext] of Object.entries(ratchetStates)) {
    const existing = await loadEncryptedState(key);
    if (!existing) await saveEncryptedState(key, plaintext);
  }

  // Message history is NOT in the blob: it's restored separately from the
  // incremental cloud archive via restoreArchive (docs/impl/p3-cloud-archive-hybrid.md).
}

// Double-wrap encryption / decryption

export async function encryptKeyBundle(
  bundle: string,
  pin: string,
  mnemonicSeedHex: string,
  userId: string,
): Promise<BackupPayload> {
  const kBackupHex = toHex(getRandomBytes(32));

  const bundleEnc = await X3DH.encrypt(kBackupHex, bundle);

  // New backups derive both wraps with Argon2id and domain-separated salts.
  const kPinHex = await deriveWrappingKeyHex(pin, userId, "argon2id", "pin");
  const pinEnc = await X3DH.encrypt(kPinHex, kBackupHex);

  const kMnemonicHex = await deriveWrappingKeyHex(
    mnemonicSeedHex,
    userId,
    "argon2id",
    "mnemonic",
  );
  const mnemonicEnc = await X3DH.encrypt(kMnemonicHex, kBackupHex);

  return {
    ciphertext_bundle: bundleEnc.ciphertext,
    iv_bundle: bundleEnc.iv,
    auth_tag_bundle: bundleEnc.authTag,
    wrapped_key_pin: pinEnc.ciphertext,
    iv_pin: pinEnc.iv,
    auth_tag_pin: pinEnc.authTag,
    wrapped_key_mnemonic: mnemonicEnc.ciphertext,
    iv_mnemonic: mnemonicEnc.iv,
    auth_tag_mnemonic: mnemonicEnc.authTag,
    kdf: "argon2id",
  };
}

// Re-encrypts a new bundle with the existing K_backup (recovered via PIN),
// so wrapped_key_pin and wrapped_key_mnemonic remain valid without the user
// needing to re-enter their mnemonic.
//
// KDF note: refresh only has the PIN, not the mnemonic seed, so it CANNOT re-wrap
// both keys — it therefore preserves `existing.kdf` (spread below) rather than
// stamping "argon2id". A legacy PBKDF2 backup stays PBKDF2 through refresh; a full
// upgrade to Argon2id requires BOTH secrets and so happens only on a fresh PIN setup
// (encryptKeyBundle), which re-derives both wraps. (This deviates from the p1b draft's
// "stamp argon2id on refresh" note, which would corrupt the still-PBKDF2 mnemonic wrap.)
export async function refreshBackupBundle(
  existing: BackupPayload,
  newBundle: string,
  pin: string,
  userId: string,
): Promise<BackupPayload> {
  const kdf: KdfId = existing.kdf ?? "pbkdf2";
  const kPinHex = await deriveWrappingKeyHex(pin, userId, kdf, "pin");
  const kBackupHex = await X3DH.decrypt(
    kPinHex,
    existing.wrapped_key_pin,
    existing.iv_pin,
    existing.auth_tag_pin,
  );
  const bundleEnc = await X3DH.encrypt(kBackupHex, newBundle);
  return {
    ...existing,
    ciphertext_bundle: bundleEnc.ciphertext,
    iv_bundle: bundleEnc.iv,
    auth_tag_bundle: bundleEnc.authTag,
  };
}

export async function decryptKeyBundleWithPIN(
  payload: BackupPayload,
  pin: string,
  userId: string,
): Promise<string> {
  const kdf: KdfId = payload.kdf ?? "pbkdf2";
  const kPinHex = await deriveWrappingKeyHex(pin, userId, kdf, "pin");
  const kBackupHex = await X3DH.decrypt(
    kPinHex,
    payload.wrapped_key_pin,
    payload.iv_pin,
    payload.auth_tag_pin,
  );
  return X3DH.decrypt(
    kBackupHex,
    payload.ciphertext_bundle,
    payload.iv_bundle,
    payload.auth_tag_bundle,
  );
}

export async function decryptKeyBundleWithMnemonic(
  payload: BackupPayload,
  seedHex: string,
  userId: string,
): Promise<string> {
  const kdf: KdfId = payload.kdf ?? "pbkdf2";
  const kMnemonicHex = await deriveWrappingKeyHex(
    seedHex,
    userId,
    kdf,
    "mnemonic",
  );
  const kBackupHex = await X3DH.decrypt(
    kMnemonicHex,
    payload.wrapped_key_mnemonic,
    payload.iv_mnemonic,
    payload.auth_tag_mnemonic,
  );
  return X3DH.decrypt(
    kBackupHex,
    payload.ciphertext_bundle,
    payload.iv_bundle,
    payload.auth_tag_bundle,
  );
}

// Cloud persistence

export async function saveBackupToCloud(
  userId: string,
  payload: BackupPayload,
): Promise<void> {
  const { error } = await supabase
    .from("encrypted_backups")
    .upsert(
      { user_id: userId, encrypted_blob: payload },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`Failed to save backup: ${error.message}`);
}

export async function loadBackupFromCloud(
  userId: string,
): Promise<BackupPayload | null> {
  const { data, error } = await supabase
    .from("encrypted_backups")
    .select("encrypted_blob")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load backup: ${error.message}`);
  return data ? (data.encrypted_blob as BackupPayload) : null;
}
