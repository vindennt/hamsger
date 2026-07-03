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
    console.warn("[onboarding] profile upsert:", error.message);
  }
}

export interface KeyVerificationResult {
  identityKey: string;
  needsPinSetup?: boolean;
  needsRestore?: boolean;
}

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
    const localPub = await keystore.get(`ik_pub_${userId}`);
    if (localPub && !localPub.startsWith("pub_") && localPub.length === 64) {
      return { identityKey: localPub };
    }
    throw new Error(
      "Could not reach server and no local keys found. Check your connection and try again.",
    );
  }

  if (!bundleData) {
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

  const localPub = await keystore.get(`ik_pub_${userId}`);
  const isLegacyKey =
    localPub && (localPub.startsWith("pub_") || localPub.length !== 64);

  if (!localPub || isLegacyKey) {
    return { identityKey: bundleData.identity_key, needsRestore: true };
  }

  return { identityKey: localPub };
}
