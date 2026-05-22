import { supabase } from "../supabase";
import { keystore } from "./keystore";
import { KeyPair, SigningKeyPair } from "./x3dh";

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

/**
 * Checks if the user's E2EE public keys are registered on database.
 * If no, generates Identity, Signed Prekey, and 5 One-Time Prekeys,
 * with local keystores having private keys and database receiving public keys.
 * Returns the active user's identity public key.
 *
 * This function is self-healing: it guarantees the profiles row exists
 * before attempting any writes to FK-constrained tables
 */
export async function verifyUserKeysExist(
  userId: string,
  username: string,
): Promise<string> {
  // Check the profile row exists before any crypto writes.
  await ensureProfileExists(userId, username);

  const { data: bundleData } = await supabase
    .from("prekey_bundles")
    .select("identity_key")
    .eq("user_id", userId)
    .maybeSingle();

  let myIdentityKey = "";

  // CASE 1: No bundle exists. Init the user keys and device storage.
  if (!bundleData) {
    console.log(
      "[Crypto Onboarding] No prekey bundle found. Generating E2EE keys",
    );

    // Generate Identity & Signed Prekey
    const ik = new KeyPair("IK_" + username);
    const spk = new KeyPair("SPK_" + username);

    // Generate mock signature
    // TODO: Implement real signing with a proper signing key
    const sigKP = new SigningKeyPair();
    const signature = sigKP.sign(spk.publicKey);

    // Store private keys locally in keystore
    await keystore.set(`ik_priv_${userId}`, ik.privateKey);
    await keystore.set(`ik_pub_${userId}`, ik.publicKey);
    await keystore.set(`spk_priv_${userId}`, spk.privateKey);
    await keystore.set(`spk_pub_${userId}`, spk.publicKey);

    // Upload public bundle to Supabase.
    const { error: bundleError } = await supabase.from("prekey_bundles").upsert(
      {
        user_id: userId,
        identity_key: ik.publicKey,
        signed_prekey: spk.publicKey,
        spk_signature: signature,
      },
      { onConflict: "user_id" },
    );

    if (bundleError) {
      console.error("Failed to upload prekey bundle:", bundleError);
    }

    // If user doesnt exist, generate 5 One-Time Prekeys and upload to database
    const { count } = await supabase
      .from("one_time_prekeys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (!count || count === 0) {
      const opkRecords = [];
      for (let i = 0; i < 5; i++) {
        const opk = new KeyPair(`OPK_${username}_${i}`);
        await keystore.set(
          `opk_priv_${userId}_${opk.publicKey}`,
          opk.privateKey,
        );
        opkRecords.push({
          user_id: userId,
          public_key: opk.publicKey,
        });
      }

      const { error: opkError } = await supabase
        .from("one_time_prekeys")
        .insert(opkRecords);

      if (opkError) {
        console.error("Failed to upload one time prekeys:", opkError);
      }
    }

    myIdentityKey = ik.publicKey;
  } else {
    // CASE 2: Bundle exists on server. Verify we have local private keys.
    const ik_pub = await keystore.get(`ik_pub_${userId}`);
    if (!ik_pub) {
      console.log(
        "[Crypto Onboarding] Key bundle exists but no local keys. Re-registering.",
      );
      const ik = new KeyPair("IK_" + username);
      const spk = new KeyPair("SPK_" + username);
      const sigKP = new SigningKeyPair();
      const signature = sigKP.sign(spk.publicKey);

      await keystore.set(`ik_priv_${userId}`, ik.privateKey);
      await keystore.set(`ik_pub_${userId}`, ik.publicKey);
      await keystore.set(`spk_priv_${userId}`, spk.privateKey);
      await keystore.set(`spk_pub_${userId}`, spk.publicKey);

      await supabase.from("prekey_bundles").upsert(
        {
          user_id: userId,
          identity_key: ik.publicKey,
          signed_prekey: spk.publicKey,
          spk_signature: signature,
        },
        { onConflict: "user_id" },
      );

      myIdentityKey = ik.publicKey;
    } else {
      myIdentityKey = ik_pub;
    }
  }

  return myIdentityKey;
}
