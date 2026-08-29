import {
  createInitiatorSession,
  createResponderSession,
} from "../../lib/crypto/createSession";
import { getDeviceId } from "../../lib/crypto/deviceId";
import { keystore } from "../../lib/crypto/keystore";
import { popOneTimePrekey } from "../../lib/crypto/onboarding";
import { RatchetState } from "../../lib/crypto/ratchet";
import { KeyPair, verifySignedPrekey } from "../../lib/crypto/x3dh";
import { supabase } from "../../lib/supabase";
import { PrekeyHeader, UserIdentity } from "./types";

/**
 * Loads the contact list from the database and fetches their identity keys.
 * Session setup is lazy: it happens on first send (initiator) or first
 * receive-with-prekey-header (responder), see
 * initSessionsAllDevices / establishResponderSession below.
 */
export async function loadContacts(
  userId: string,
  myIdentity: UserIdentity,
): Promise<{
  resolvedContacts: UserIdentity[];
  newIdentities: Record<string, UserIdentity>;
}> {
  const { data: requestsData, error: requestsError } = await supabase
    .from("friend_requests")
    .select(
      `
      from_user_id,
      to_user_id,
      from_profile:from_user_id ( username ),
      to_profile:to_user_id ( username )
    `,
    )
    .eq("status", "accepted")
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

  if (requestsError) {
    console.error("Error fetching contacts:", requestsError);
  }

  const resolvedContacts: UserIdentity[] = [];
  const newIdentities: Record<string, UserIdentity> = {
    [myIdentity.name]: myIdentity,
  };

  const friends = (requestsData ?? []).map((item) => {
    const isFromMe = item.from_user_id === userId;
    const friendId = isFromMe ? item.to_user_id : item.from_user_id;
    const profile = isFromMe ? item.to_profile : item.from_profile;
    const friendName = (profile as any)?.username || "friend";
    return { friendId, friendName };
  });

  // Guard: PostgREST treats `.in("user_id", [])` as no filter and returns EVERY
  // prekey bundle in the DB, so a zero-contact user must skip the query entirely.
  const identityKeyByFriendId = new Map<string, string>();
  if (friends.length > 0) {
    const { data: bundles } = await supabase
      .from("prekey_bundles")
      .select("user_id, identity_key")
      .in(
        "user_id",
        friends.map((f) => f.friendId),
      );
    for (const b of bundles ?? []) {
      identityKeyByFriendId.set(b.user_id, b.identity_key);
    }
  }

  for (const { friendId, friendName } of friends) {
    const friendPubKey = identityKeyByFriendId.get(friendId);
    if (!friendPubKey) {
      throw new Error(`Missing encryption keys for ${friendName}.`);
    }

    const friendIdentity: UserIdentity = {
      name: friendName,
      uuid: friendId,
      publicKey: friendPubKey,
    };

    resolvedContacts.push(friendIdentity);
    newIdentities[friendName] = friendIdentity;
  }

  return { resolvedContacts, newIdentities };
}

export interface InitiatorSession {
  state: RatchetState;
  header: PrekeyHeader;
}

/**
 * Initiator "Alice" side of the lazy handshake, run on first send to a peer:
 * fetches ALL of the peer's device prekeys, verifies each SPK against the peer's SHARED signing key
 *  Every device pops the device OPK runs X3DH with a fresh EK. Returns one bootstrapped
 * ratchet + prekey header per peer device, keyed by the peer's device id.
 *
 * Header ik is the shared account identity key
 * sender_device_id is curr device
 */
export async function initSessionsAllDevices(
  userId: string,
  peer: UserIdentity,
  opts?: { skipDeviceIds?: Set<string> },
): Promise<Map<string, InitiatorSession>> {
  const skip = opts?.skipDeviceIds ?? new Set<string>();
  const myDeviceId = await getDeviceId(userId);
  const myIkPriv = await keystore.get(`ik_priv_${userId}`);
  if (!myIkPriv) {
    throw new Error("Missing local identity key.");
  }
  const myIk = new KeyPair("IK", myIkPriv);

  const { data: bundles, error } = await supabase
    .from("prekey_bundles")
    .select(
      "device_id, identity_key, signed_prekey, spk_signature, signing_key",
    )
    .eq("user_id", peer.uuid);

  if (error || !bundles || bundles.length === 0) {
    throw new Error(`Missing encryption keys for ${peer.name}.`);
  }

  const sessions = new Map<string, InitiatorSession>();
  // Tracks whether ANY published device has usable keys, so we can distinguish
  // "peer keys are broken" (throw) from "every device already has a session"
  // (return empty — a valid steady state when fanning out to known devices).
  let sawUsableDevice = false;
  for (const bundle of bundles) {
    if (!bundle.identity_key || !bundle.signing_key) continue;

    const valid = verifySignedPrekey(
      bundle.signing_key,
      bundle.signed_prekey,
      bundle.spk_signature,
    );
    if (!valid) {
      console.warn(
        `[sessionHelpers] Invalid signed prekey for ${peer.name} device ${bundle.device_id}; skipping.`,
      );
      continue;
    }
    sawUsableDevice = true;
    // Don't re-handshake a device we already hold a session for — that would
    // fork the ratchet. The caller loads those existing sessions itself.
    if (skip.has(bundle.device_id)) continue;

    const popped = await popOneTimePrekey(peer.uuid, bundle.device_id);
    const ek = new KeyPair("EK");

    const { state } = createInitiatorSession(myIkPriv, ek, {
      identityKey: bundle.identity_key,
      signedPrekey: bundle.signed_prekey,
      oneTimePrekey: popped?.publicKey ?? null,
    });

    sessions.set(bundle.device_id, {
      state,
      header: {
        ik: myIk.publicKey,
        ek: ek.publicKey,
        opk: popped?.publicKey ?? null,
        sender_device_id: myDeviceId,
      },
    });
  }

  if (!sawUsableDevice) {
    throw new Error(`Missing encryption keys for ${peer.name}.`);
  }
  return sessions;
}

/**
 * Responder (Bob) side of the lazy handshake, run on receiving a message that
 * carries a prekey header: recomputes the same X3DH secret from local prekey
 * privates and consumes (deletes) the referenced one-time prekey for forward
 * secrecy.
 */
export async function establishResponderSession(
  userId: string,
  header: PrekeyHeader,
): Promise<RatchetState> {
  const ikPriv = await keystore.get(`ik_priv_${userId}`);
  const spkPrivHex = await keystore.get(`spk_priv_${userId}`);
  if (!ikPriv || !spkPrivHex) {
    throw new Error("Missing local prekeys to establish session.");
  }
  const spk = new KeyPair("SPK", spkPrivHex);

  const opkPriv = header.opk
    ? await keystore.get(`opk_priv_${userId}_${header.opk}`)
    : null;

  const { state } = createResponderSession(
    { ikPriv, spk, opkPriv },
    { ik: header.ik, ek: header.ek },
  );

  if (header.opk) {
    await keystore.delete(`opk_priv_${userId}_${header.opk}`);
  }

  return state;
}
