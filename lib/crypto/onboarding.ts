import { kv } from "../database/kv";
import { supabase } from "../supabase";
import { keystore } from "./keystore";
import { KeyPair, SigningKeyPair } from "./x3dh";

async function publishKeyBundle(
  userId: string,
  ik: KeyPair,
  spk: KeyPair,
  sigKP: SigningKeyPair,
): Promise<void> {
  const signature = sigKP.sign(spk.publicKey);
  const { error } = await supabase.from("prekey_bundles").upsert(
    {
      user_id: userId,
      identity_key: ik.publicKey,
      signed_prekey: spk.publicKey,
      spk_signature: signature,
    },
    { onConflict: "user_id" },
  );
  if (error)
    console.error("[Crypto Onboarding] Failed to upload prekey bundle:", error);
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

/**
 * Generates fresh E2EE key material, stores it locally, and publishes public
 * keys to Supabase. Deletes any existing key backup before re-keying.
 * Called from the restore screen's "Reset Keys" escape hatch.
 */
// Clears identity key material on session expiry to require PIN re-entry.
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
  const ik = new KeyPair("IK");
  const spk = new KeyPair("SPK");
  const sigKP = new SigningKeyPair();

  // New identity = all prior ratchet states are cryptographically invalid.
  const ratchetRows = await kv.getAllByPrefix(`ratchetState_v3_${userId}`);
  for (const { key } of ratchetRows) await kv.remove(key);

  await supabase.from("encrypted_backups").delete().eq("user_id", userId);
  await storeKeyPairs(userId, ik, spk, sigKP);
  await publishKeyBundle(userId, ik, spk, sigKP);

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
    // Profle might already exist due
    console.warn("[Crypto Onboarding] Profile upsert warning:", error.message);
  }
}

export interface KeyVerificationResult {
  identityKey: string;
  needsPinSetup?: boolean;
  needsRestore?: boolean;
}

/**
 * Checks if the user's E2EE public keys are registered on database.
 * If no, generates Identity, Signed Prekey, and 5 One-Time Prekeys,
 * with local keystores having private keys and database receiving public keys.
 * Returns the active user's identity public key plus onboarding flags.
 *
 * needsPinSetup: new keys were just generated; guide user to set a PIN backup
 * needsRestore:  server has a bundle but local keys are missing; guide user to restore
 */
export async function verifyUserKeysExist(
  userId: string,
  username: string,
): Promise<KeyVerificationResult> {
  // Check the profile row exists before any crypto writes.
  await ensureProfileExists(userId, username);

  const { data: bundleData, error: bundleError } = await supabase
    .from("prekey_bundles")
    .select("identity_key")
    .eq("user_id", userId)
    .maybeSingle();

  if (bundleError) {
    // Server unreachable dont overwrite keys until fixed.
    // Fall back to local keys if present; otherwise surface the connectivity failure.
    const localPub = await keystore.get(`ik_pub_${userId}`);
    if (localPub && !localPub.startsWith("pub_") && localPub.length === 64) {
      console.warn("[Crypto Onboarding] Server unreachable, using local keys.");
      return { identityKey: localPub };
    }
    throw new Error(
      "Could not reach server and no local keys found. Check your connection and try again.",
    );
  }

  if (!bundleData) {
    // No bundle exsits anymore, so just generate fresh keys
    console.log(
      "[Crypto Onboarding] No prekey bundle found. Generating E2EE keys.",
    );
    const ik = new KeyPair("IK");
    const spk = new KeyPair("SPK");
    const sigKP = new SigningKeyPair();

    await storeKeyPairs(userId, ik, spk, sigKP);
    await publishKeyBundle(userId, ik, spk, sigKP);

    const { count } = await supabase
      .from("one_time_prekeys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (!count || count === 0) {
      const opkRecords = [];
      for (let i = 0; i < 5; i++) {
        const opk = new KeyPair("OPK");
        await keystore.set(
          `opk_priv_${userId}_${opk.publicKey}`,
          opk.privateKey,
        );
        opkRecords.push({ user_id: userId, public_key: opk.publicKey });
      }
      const { error } = await supabase
        .from("one_time_prekeys")
        .insert(opkRecords);
      if (error)
        console.error(
          "[Crypto Onboarding] Failed to upload one-time prekeys:",
          error,
        );
    }

    return { identityKey: ik.publicKey, needsPinSetup: true };
  }

  // Server bundle exists — verify local private keys are present.
  const localPub = await keystore.get(`ik_pub_${userId}`);
  const isLegacyKey =
    localPub && (localPub.startsWith("pub_") || localPub.length !== 64);

  if (!localPub || isLegacyKey) {
    console.log("[Crypto Onboarding] Local keys missing. Prompting restore.");
    return { identityKey: bundleData.identity_key, needsRestore: true };
  }

  return { identityKey: localPub };
}
