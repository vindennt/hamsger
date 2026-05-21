import { useAuth } from "@/context/auth";
import { useEffect, useState } from "react";
import { verifyUserKeysExist } from "../../lib/crypto";
import { addContact } from "../../lib/contacts";
import { loadContactsAndSessions } from "./sessionHelpers";
import {
  ConversationId,
  EncryptedDbMessage,
  makeConversationId,
  SessionContext,
  User,
  UserIdentity,
} from "./types";

export function useSessionManager() {
  const { user } = useAuth();

  // TODO: prevent guests
  const currentUsername =
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "unauthorized";
  const currentUserId = user?.id || "unauthorized-id";

  const [currentUser, setCurrentUser] = useState<User>(currentUsername);
  const [currentPeer, setCurrentPeer] = useState<User>("");
  const [contacts, setContacts] = useState<UserIdentity[]>([]);
  const [identities, setIdentities] = useState<Record<User, UserIdentity>>({});

  const [isReady, setIsReady] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // TODO: add session persistence
  // TODO: figure out mobile session persistence
  const [sessions, setSessions] = useState<
    Record<ConversationId, SessionContext>
  >({});
  const [messagesDB, setMessagesDB] = useState<
    Record<ConversationId, EncryptedDbMessage[]>
  >({});

  useEffect(() => {
    setCurrentUser(currentUsername);
  }, [currentUsername]);

  useEffect(() => {
    if (!user) return;

    // Init user keys and contacts
    async function setupUserCryptoAndContacts() {
      try {
        const username =
          user!.user_metadata?.username ||
          user!.email?.split("@")[0] ||
          "unauthorized";
        const userId = user!.id;

        // Crypto Onboarding; Check and ensure E2EE keys are generated & uploaded
        const myIdentityKey = await verifyUserKeysExist(userId, username);

        // Init local identity
        const myIdentity: UserIdentity = {
          name: username,
          uuid: userId,
          publicKey: myIdentityKey,
        };

        // Fetch Contacts and set local context
        const { resolvedContacts, newIdentities, initialSessions } =
          await loadContactsAndSessions(userId, myIdentity);

        setContacts(resolvedContacts);
        setIdentities(newIdentities);
        setSessions(initialSessions);

        if (resolvedContacts.length > 0) {
          setCurrentPeer(resolvedContacts[0].name);
        } else {
          setCurrentPeer("");
        }

        setIsReady(true);
      } catch (err) {
        console.error("Failed to init session manager:", err);
        setIsReady(true);
      }
    }

    setupUserCryptoAndContacts();
  }, [user, refreshTrigger]);

  const activeConversationId =
    isReady && currentPeer && identities[currentPeer]
      ? makeConversationId(
          identities[currentUser].uuid,
          identities[currentPeer].uuid,
        )
      : "";

  const activeSession = sessions[activeConversationId];
  const activeMessages = messagesDB[activeConversationId] || [];

  const addMessage = (convId: ConversationId, msg: EncryptedDbMessage) => {
    setMessagesDB((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] || []), msg],
    }));
  };

  // Helper to add a contact by username
  const handleAddContact = async (
    friendUsername: string,
  ): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: "User not logged in" };

    const res = await addContact(currentUserId, currentUser, friendUsername);
    if (res.success) {
      // Trigger state refresh
      setIsReady(false);
      setRefreshTrigger((prev) => prev + 1);
    }
    return res;
  };

  return {
    isReady,
    identities,
    currentUser,
    currentUserId,
    contacts,
    currentPeer,
    setCurrentPeer,
    activeConversationId,
    activeSession,
    activeMessages,
    addMessage,
    handleAddContact,
  };
}
