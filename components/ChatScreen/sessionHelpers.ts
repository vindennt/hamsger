import { createSession } from "../../lib/crypto/createSession";
import { supabase } from "../../lib/supabase";
import { makeConversationId, SessionContext, UserIdentity } from "./types";

/**
 * Loads the contact list from Supabase, fetches their public keys, and initializes
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
  const { data: contactsData, error: contactsError } = await supabase
    .from("contacts")
    .select(
      `
      contact_user_id,
      profiles:contact_user_id (
        username
      )
    `,
    )
    .eq("user_id", userId);

  if (contactsError) {
    console.error("Error fetching contacts:", contactsError);
  }

  const resolvedContacts: UserIdentity[] = [];
  const newIdentities: Record<string, UserIdentity> = {
    [myIdentity.name]: myIdentity,
  };
  const initialSessions: Record<string, SessionContext> = {};

  if (contactsData) {
    for (const item of contactsData) {
      const friendId = item.contact_user_id;
      const profile = item.profiles as any;
      const friendName = profile?.username || "friend";

      // Get contact's public prekey bundle
      const { data: friendBundle } = await supabase
        .from("prekey_bundles")
        .select("identity_key, signed_prekey")
        .eq("user_id", friendId)
        .maybeSingle();

      const friendPubKey =
        friendBundle?.identity_key || "fallback_pub_" + friendId;

      const friendIdentity: UserIdentity = {
        name: friendName,
        uuid: friendId,
        publicKey: friendPubKey,
      };

      resolvedContacts.push(friendIdentity);
      newIdentities[friendName] = friendIdentity;

      // Initialize X3DH dynamic session locally
      const sess = createSession(myIdentity, friendIdentity);
      const convId = makeConversationId(userId, friendId);

      initialSessions[convId] = {
        initiator: myIdentity,
        responder: friendIdentity,
        SK: sess.SK,
        meta: sess.meta,
      };
    }
  }

  return { resolvedContacts, newIdentities, initialSessions };
}
