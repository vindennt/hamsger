import { kv } from "../database/kv";
import { supabase } from "../supabase";
import { getDeviceId } from "./deviceId";
import { keystore } from "./keystore";
import { masterKeyMatchesLocalData } from "./masterKeyCanary";
import { KeyPair, SigningKeyPair } from "./x3dh";

async function publishKeyBundle(
  userId: string,
  deviceId: string,
  ik: KeyPair,
  spk: KeyPair,
  sigKP: SigningKeyPair,
): Promise<void> {
  const signature = sigKP.sign(spk.publicKey);
  const { error } = await supabase.from("prekey_bundles").upsert(
    {
      user_id: userId,
      device_id: deviceId,
      // NOTE(crypto): identity_key + signing_key are the SHARED account keys
      // (identical on every device row); signed_prekey + spk_signature are
      // PER-DEVICE. SPK is minted fresh on each device and must NEVER be shared
      // or backed up — shared IK + shared SPK + an exhausted OPK pool derive
      // identical sessions across a user's devices and re-fork the ratchet.
      // TODO(security): all of a user's device bundles share the account IK, so a
      // compromised device can impersonate siblings and peers can't
      // cryptographically distinguish devices. Deferred fix: per-device IK + a
      // signed device list.
      identity_key: ik.publicKey,
      signed_prekey: spk.publicKey,
      spk_signature: signature,
      signing_key: sigKP.publicKey,
    },
    { onConflict: "user_id,device_id" },
  );
  if (error)
    console.error("[Crypto Onboarding] Failed to upload prekey bundle:", error);
}

// Creates device specific prekeys if doesnt exist
async function mintOpkPool(
  userId: string,
  deviceId: string,
  count = 5,
): Promise<void> {
  const opkRecords: {
    user_id: string;
    device_id: string;
    public_key: string;
  }[] = [];
  for (let i = 0; i < count; i++) {
    const opk = new KeyPair("OPK");
    await keystore.set(`opk_priv_${userId}_${opk.publicKey}`, opk.privateKey);
    opkRecords.push({
      user_id: userId,
      device_id: deviceId,
      public_key: opk.publicKey,
    });
  }
  const { error } = await supabase.from("one_time_prekeys").insert(opkRecords);
  if (error)
    console.error(
      "[Crypto Onboarding] Failed to upload one-time prekeys:",
      error,
    );
}

// Registers THIS device against an account whose shared identity already lives
// locally (post-reset install, or a device just restored from backup): mints a
// fresh per-device SPK + OPK pool and publishes this device's bundle, reusing the
// shared IK + signing key. It never restores the previous device's SPK/OPK.
async function registerThisDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  const ikPriv = await keystore.get(`ik_priv_${userId}`);
  const sigPriv = await keystore.get(`sig_priv_${userId}`);
  if (!ikPriv || !sigPriv) {
    throw new Error(
      "Cannot register device: missing local account identity keys.",
    );
  }
  const ik = new KeyPair("IK", ikPriv);
  const sigKP = new SigningKeyPair(sigPriv);
  const spk = new KeyPair("SPK");
  await keystore.set(`spk_priv_${userId}`, spk.privateKey);
  await keystore.set(`spk_pub_${userId}`, spk.publicKey);
  await publishKeyBundle(userId, deviceId, ik, spk, sigKP);
  await mintOpkPool(userId, deviceId);
}

// One-shot local half of the multi-device reset (server migration 0012). Pre-reset
// installs still hold a single shared SPK/OPK and pre-reset ratchet state that are
// now invalid (the server was truncated; sessions are now per-device). Wipe them
// so the normal registration path re-mints a fresh per-device SPK + OPK. The
// shared identity keys (ik_/sig_) are deliberately preserved.
const RESET_GATE_KEY = "md_v1_reset_done";

async function runMultiDeviceResetGate(userId: string): Promise<void> {
  if (await kv.get(RESET_GATE_KEY)) return;

  const ratchetRows = await kv.getAllByPrefix(`ratchetState_v3_${userId}`);
  for (const { key } of ratchetRows) await kv.remove(key);

  const opkRows = await kv.getAllByPrefix(`opk_priv_${userId}`);
  for (const { key } of opkRows) await kv.remove(key);

  await kv.remove(`spk_priv_${userId}`);
  await kv.remove(`spk_pub_${userId}`);

  await kv.set(RESET_GATE_KEY, "1");
}

async function storeKeyPairs(
  userId: string,
  ik: KeyPair,
  spk: KeyPair,
  sigKP: SigningKeyPair,
): Promise<void> {
  await keystore.set(`ik_priv_${userId}`, ik.privateKey);
  await keystore.set(`ik_pub_${userId}`, ik.publicKey);
  await keystore.set(`spk_priv_${userId}`, spk.privateKey);
  await keystore.set(`spk_pub_${userId}`, spk.publicKey);
  await keystore.set(`sig_priv_${userId}`, sigKP.privateKey);
  await keystore.set(`sig_pub_${userId}`, sigKP.publicKey);
}

// Clears identity key material to require PIN re-entry on next launch.
// Ratchet states are intentionally preserved — they cannot be reconstructed
// from backup without breaking in-progress conversations.
export async function clearLocalKeyMaterial(userId: string): Promise<void> {
  const fixedKeys = [
    `ik_priv_${userId}`,
    `ik_pub_${userId}`,
    `spk_priv_${userId}`,
    `spk_pub_${userId}`,
    `sig_priv_${userId}`,
    `sig_pub_${userId}`,
  ];
  for (const key of fixedKeys) await kv.remove(key);

  const opkRows = await kv.getAllByPrefix(`opk_priv_${userId}`);
  for (const { key } of opkRows) await kv.remove(key);
}

export async function resetUserKeys(userId: string): Promise<string> {
  const deviceId = await getDeviceId(userId);
  const ik = new KeyPair("IK");
  const spk = new KeyPair("SPK");
  const sigKP = new SigningKeyPair();

  // New identity = all prior ratchet states are cryptographically invalid.
  const ratchetRows = await kv.getAllByPrefix(`ratchetState_v3_${userId}`);
  for (const { key } of ratchetRows) await kv.remove(key);

  await supabase.from("encrypted_backups").delete().eq("user_id", userId);
  await storeKeyPairs(userId, ik, spk, sigKP);
  // TODO: this  reset remints the SHARED account IK on one
  // device only, diverging it from any sibling device bundles. revisit for true multi-device.
  await publishKeyBundle(userId, deviceId, ik, spk, sigKP);

  return ik.publicKey;
}

/**
 * Ensures the user's profile row exists in the database.
 * This must be called before any writes to prekey_bundles or one_time_prekeys
 * because both tables have a FK constraint on profiles(id).
 *
 * Using upsert makes this idempotent and safe
 * to call multiple times or concurrently
 */
async function ensureProfileExists(
  userId: string,
  username: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, username },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) {
    console.warn("[onboarding] profile upsert:", error.message);
  }
}

async function backupExists(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("encrypted_backups")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  return !error && !!count && count > 0;
}

export interface KeyVerificationResult {
  identityKey: string;
  needsPinSetup?: boolean;
  needsRestore?: boolean;
}

export interface PoppedOneTimePrekey {
  id: string;
  publicKey: string;
}

// Atomically claims (deletes) one of the peer device opks via the
// friends only pop_one_time_prekey RPC
export async function popOneTimePrekey(
  peerId: string,
  peerDeviceId: string,
): Promise<PoppedOneTimePrekey | null> {
  const { data, error } = await supabase.rpc("pop_one_time_prekey", {
    target: peerId,
    target_device: peerDeviceId,
  });
  if (error) {
    // RPC fails
    console.warn(
      "[onboarding] pop_one_time_prekey failed:",
      error.code,
      error.message,
    );
    return null;
  }
  if (!data || data.length === 0) return null; // pool exhausted (expected)

  const row = data[0];
  return { id: row.id, publicKey: row.public_key };
}

export async function verifyUserKeysExist(
  userId: string,
  username: string,
): Promise<KeyVerificationResult> {
  // Check the profile row exists before any crypto writes.
  await ensureProfileExists(userId, username);
  // One-shot local cleanup for the multi-device reset before anything reads keys.
  await runMultiDeviceResetGate(userId);

  const deviceId = await getDeviceId(userId);

  const { data: bundles, error: bundleError } = await supabase
    .from("prekey_bundles")
    .select("device_id, identity_key")
    .eq("user_id", userId);

  if (bundleError) {
    const localPub = await keystore.get(`ik_pub_${userId}`);
    if (localPub && !localPub.startsWith("pub_") && localPub.length === 64) {
      return { identityKey: localPub };
    }
    throw new Error(
      "Could not reach server and no local keys found. Check your connection and try again.",
    );
  }

  const rows = bundles ?? [];
  const myBundle = rows.find((r) => r.device_id === deviceId);
  const accountIdentityKey = rows[0]?.identity_key ?? null;

  const localPub = await keystore.get(`ik_pub_${userId}`);
  const isLegacyKey =
    !!localPub && (localPub.startsWith("pub_") || localPub.length !== 64);
  const haveLocalIdentity = !!localPub && !isLegacyKey;

  // No usable local identity: brand-new account, or a new device of an existing
  // one that must first restore the shared identity from backup.
  if (!haveLocalIdentity) {
    if (accountIdentityKey) {
      return { identityKey: accountIdentityKey, needsRestore: true };
    }
    const ik = new KeyPair("IK");
    const spk = new KeyPair("SPK");
    const sigKP = new SigningKeyPair();
    await storeKeyPairs(userId, ik, spk, sigKP);
    await publishKeyBundle(userId, deviceId, ik, spk, sigKP);
    await mintOpkPool(userId, deviceId);
    return { identityKey: ik.publicKey, needsPinSetup: true };
  }

  // Have a valid local shared identity (ik_pub is stored plaintext). But the
  // at-rest master key must still decrypt the private material; if it can't (e.g.
  // web IndexedDB cleared but OPFS SQLite survived), the ik_priv/sig_priv we'd
  // need to register this device are unreadable — route to restore instead of a
  // silent "[Decryption Failed]" wall.
  if (!(await masterKeyMatchesLocalData(userId))) {
    return {
      identityKey: accountIdentityKey ?? localPub,
      needsRestore: true,
    };
  }

  // Master key is good: make sure THIS device is registered (first run on an
  // install that already holds the shared identity, or a post-reset re-register).
  if (!myBundle) {
    await registerThisDevice(userId, deviceId);
    if (!(await backupExists(userId))) {
      return { identityKey: localPub, needsPinSetup: true };
    }
  }

  return { identityKey: localPub };
}
