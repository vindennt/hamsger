import { createSession } from "../../lib/crypto/createSession";
import { keystore } from "../../lib/crypto/keystore";
import { supabase } from "../../lib/supabase";
import { makeConversationId, SessionContext, UserIdentity } from "./types";

/**
 * Loads the contact list from database, fetches their public keys, and initializes
 * local E2EE session contexts for each contact.
 * Session init is handled elsewhere
 */
export async function loadContactsAndSessions(
  userId: string,
  myIdentity: UserIdentity,
): Promise<{
  resolvedContacts: UserIdentity[];
  newIdentities: Record<string, UserIdentity>;
  initialSessions: Record<string, SessionContext>;
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
  const initialSessions: Record<string, SessionContext> = {};

  if (requestsData) {
    for (const item of requestsData) {
      const isFromMe = item.from_user_id === userId;
      const friendId = isFromMe ? item.to_user_id : item.from_user_id;
      const profile = isFromMe ? item.to_profile : item.from_profile;
      const friendName = (profile as any)?.username || "friend";

      // Get contact's public prekey bundle
      const { data: friendBundle } = await supabase
        .from("prekey_bundles")
        .select("identity_key, signed_prekey")
        .eq("user_id", friendId)
        .maybeSingle();

      // TODO: Diagnose this bug more where sometimes identiy key is not found and suddenly all chat log is "failed to send. For now, recognize it"
      if (!friendBundle?.identity_key) {
        throw new Error(`Missing encryption keys for ${friendName}.`);
      }
      const friendPubKey = friendBundle.identity_key;

      const friendIdentity: UserIdentity = {
        name: friendName,
        uuid: friendId,
        publicKey: friendPubKey,
      };

      resolvedContacts.push(friendIdentity);
      newIdentities[friendName] = friendIdentity;

      // Sort identities to ensure both devices map initiator and responder the same
      // TODO: is there a way to avoid this arbitrary step
      const [initiator, responder] = [myIdentity, friendIdentity].sort((a, b) =>
        a.uuid.localeCompare(b.uuid),
      );

      const isInitiator = initiator.uuid === userId;

      const myPrivateKeyHex =
        (await keystore.get(`ik_priv_${userId}`)) || undefined;

      // Initialize X3DH dynamic session locally
      const sess = createSession(
        initiator,
        responder,
        isInitiator ? myPrivateKeyHex : undefined,
        !isInitiator ? myPrivateKeyHex : undefined,
      );
      const convId = makeConversationId(userId, friendId);

      initialSessions[convId] = {
        initiator: initiator,
        responder: responder,
        SK: sess.SK,
        meta: sess.meta,
      };
    }
  }

  return { resolvedContacts, newIdentities, initialSessions };
}
