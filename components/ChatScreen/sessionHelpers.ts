import {
  createInitiatorSession,
  createResponderSession,
} from "../../lib/crypto/createSession";
import { keystore } from "../../lib/crypto/keystore";
import { popOneTimePrekey } from "../../lib/crypto/onboarding";
import { RatchetState } from "../../lib/crypto/ratchet";
import { KeyPair, verifySignedPrekey } from "../../lib/crypto/x3dh";
import { supabase } from "../../lib/supabase";
import { PrekeyHeader, UserIdentity } from "./types";

/**
 * Loads the contact list from the database and fetches their identity keys.
 * Session setup is lazy: it happens on first send (initiator) or first
 * receive-with-prekey-header (responder), see establishInitiatorSession /
 * establishResponderSession below.
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

/**
 * Initiator "Alice" side of the lazy handshake, run on first send to a peer:
 * fetches + verifies the peer's published prekey bundle, pops a one-time
 * prekey, and runs X3DH with a fresh ephemeral. Returns the bootstrapped
 * ratchet state plus the prekey header to attach to the first message.
 */
export async function establishInitiatorSession(
  userId: string,
  peer: UserIdentity,
): Promise<{ state: RatchetState; header: PrekeyHeader }> {
  const { data: bundle, error } = await supabase
    .from("prekey_bundles")
    .select("identity_key, signed_prekey, spk_signature, signing_key")
    .eq("user_id", peer.uuid)
    .maybeSingle();

  if (error || !bundle?.identity_key || !bundle.signing_key) {
    throw new Error(`Missing encryption keys for ${peer.name}.`);
  }

  const valid = verifySignedPrekey(
    bundle.signing_key,
    bundle.signed_prekey,
    bundle.spk_signature,
  );
  if (!valid) {
    throw new Error(`Invalid signed prekey for ${peer.name}.`);
  }

  const popped = await popOneTimePrekey(peer.uuid);
  const ek = new KeyPair("EK");

  const myIkPriv = await keystore.get(`ik_priv_${userId}`);
  if (!myIkPriv) {
    throw new Error("Missing local identity key.");
  }
  const myIk = new KeyPair("IK", myIkPriv);

  const { state } = createInitiatorSession(myIkPriv, ek, {
    identityKey: bundle.identity_key,
    signedPrekey: bundle.signed_prekey,
    oneTimePrekey: popped?.publicKey ?? null,
  });

  return {
    state,
    header: {
      ik: myIk.publicKey,
      ek: ek.publicKey,
      opk: popped?.publicKey ?? null,
    },
  };
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
