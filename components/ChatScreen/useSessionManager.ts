import { useAuth } from "@/context/auth";
import React, { useCallback, useEffect, useState } from "react";
import {
  acceptFriendRequest,
  fetchPendingRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "../../lib/contacts";
import { verifyUserKeysExist } from "../../lib/crypto";
import {
  deserializeRatchetState,
  initAlice,
  initBob,
  ratchetDecrypt,
  ratchetEncrypt,
  RatchetState,
  serializeRatchetState,
} from "../../lib/crypto/ratchet";
import {
  loadEncryptedState,
  saveEncryptedState,
} from "../../lib/crypto/secureStore";
import { KeyPair } from "../../lib/crypto/x3dh";
import { messageRepo } from "../../lib/database/messageRepository";
import { supabase } from "../../lib/supabase";
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
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

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

  useEffect(() => {
    if (!user) return;

    // Initial fetch
    fetchPendingRequests(user.id).then((data) => {
      setPendingRequests(data || []);
    });

    // Subscribe to friend_requests changes
    const channelName = `friend_requests_${user.id}_${Date.now()}`;
    const subscription = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
        },
        (payload) => {
          const row = (payload.new || payload.old) as any;
          if (
            row &&
            (row.to_user_id === user.id || row.from_user_id === user.id)
          ) {
            console.log("[Supabase Realtime] Friend request update detected");
            // Refetch to get the latest joined profile data
            fetchPendingRequests(user.id).then((data) => {
              setPendingRequests(data || []);
            });

            // Trigger refresh if a request was accepted so contacts update
            // TODO: More graceful way to do this?
            if (payload.eventType === "UPDATE" && row.status === "accepted") {
              setIsReady(false);
              setRefreshTrigger((prev) => prev + 1);
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [user, refreshTrigger]);

  const activeConversationId =
    isReady && currentPeer && identities[currentUser] && identities[currentPeer]
      ? makeConversationId(
          identities[currentUser].uuid,
          identities[currentPeer].uuid,
        )
      : "";

  const activeSession = sessions[activeConversationId];
  const activeMessages = React.useMemo(() => messagesDB[activeConversationId] || [], [messagesDB, activeConversationId]);

  // TODO: implement message pagination
  const addMessage = useCallback(
    (convId: ConversationId, msg: EncryptedDbMessage) => {
      setMessagesDB((prev) => {
        const existing = prev[convId] || [];
        if (existing.some((m) => m.id === msg.id)) return prev; // prevent duplicates

        console.log(
          `[useSessionManager] Adding message ${msg.id} to UI for ${convId}`,
        );
        return {
          ...prev,
          [convId]: [...existing, msg].sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          ),
        };
      });
    },
    [],
  );

  const getOrCreateRatchetState = useCallback(
    async (
      convId: ConversationId,
      session: SessionContext,
    ): Promise<RatchetState> => {
      const stateKey = `ratchetState_v3_${currentUserId}_${convId}`;
      const stored = await loadEncryptedState(stateKey);
      if (stored) {
        try {
          return deserializeRatchetState(JSON.parse(stored));
        } catch (e) {
          console.error(
            "Failed to parse stored ratchet state for " + convId,
            e,
          );
        }
      }

      // If not found, initialize a new state from session context
      let state: RatchetState;
      if (currentUserId === session.initiator.uuid) {
        const initiatorDHs = new KeyPair(
          "Init_DHs_0",
          session.meta.initiatorDHsCore,
        );
        state = initAlice(
          session.SK,
          session.meta.responderRatchetPub,
          initiatorDHs,
        );
        state.name = currentUser;
      } else if (currentUserId === session.responder.uuid) {
        const responderRatchetKP = new KeyPair(
          "Resp_SPK",
          session.meta.responderRatchetPriv!.replace("priv_", ""),
        );
        state = initBob(
          session.SK,
          responderRatchetKP,
          session.meta.initiatorDHsPub,
        );
        state.name = currentUser;
      } else {
        throw new Error("Current user is not part of this session");
      }

      // Save the newly initialized state
      await saveEncryptedState(
        stateKey,
        JSON.stringify(serializeRatchetState(state)),
      );
      return state;
    },
    [currentUserId, currentUser],
  );

  // TODO: separate descryption and messaging adding
  const decryptAndAddMessage = useCallback(
    async (convId: ConversationId, msg: EncryptedDbMessage) => {
      if ((msg as any).isDecrypted) {
        addMessage(convId, msg);
        return;
      }

      const session = sessions[convId];
      if (!session) {
        console.warn(
          `[SessionManager] No session found for conversation ${convId}`,
        );
        addMessage(convId, msg);
        return;
      }

      try {
        const state = await getOrCreateRatchetState(convId, session);
        const ratchetMsg = {
          header: { DHpub: msg.dh_pub, PN: msg.pn, N: msg.n },
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          authTag: msg.auth_tag,
        };

        const noop = () => {};
        const plaintext = await ratchetDecrypt(state, ratchetMsg, noop);

        // Save updated ratchet state
        await saveEncryptedState(
          `ratchetState_v3_${currentUserId}_${convId}`,
          JSON.stringify(serializeRatchetState(state)),
        );

        // Insert ciphertext into SQLite
        try {
          await messageRepo.insertMessage({
            id: msg.id,
            conversation_id: convId,
            sender_id: msg.sender,
            recipient_id: currentUserId,
            created_at_server: msg.timestamp,
            timestamp: new Date().toISOString(),
            local_plaintext: plaintext,
          });
        } catch (dbErr) {
          console.error(
            "[SessionManager] Failed to insert decrypted message to DB:",
            dbErr,
          );
        }

        const decryptedMsg = {
          ...msg,
          text: plaintext,
          isDecrypted: true,
        };

        addMessage(convId, decryptedMsg);
      } catch (e: any) {
        console.error(
          `[SessionManager] Decryption failed for message ${msg.id}:`,
          e,
        );

        try {
          await messageRepo.logError(
            "decryption",
            convId,
            msg.id,
            e instanceof Error ? e.message : String(e),
          );
        } catch (dbErr) {
          console.error(
            "[SessionManager] Failed to log decryption error to DB:",
            dbErr,
          );
        }

        const failedMsg = {
          ...msg,
          text: "[Message failed to load]",
          isDecrypted: true,
        };
        addMessage(convId, failedMsg);
      }
    },
    [sessions, addMessage, currentUserId, getOrCreateRatchetState],
  );

  // TODO: Encrypt and ratchet separately?
  const encryptOutgoingMessage = useCallback(
    async (convId: ConversationId, plaintext: string) => {
      const session = sessions[convId];
      if (!session) {
        console.error("No active session for conversation " + convId);
        return null;
      }

      try {
        const state = await getOrCreateRatchetState(convId, session);
        const ratchetMsg = await ratchetEncrypt(state, plaintext, () => {});

        // Save updated ratchet state
        await saveEncryptedState(
          `ratchetState_v3_${currentUserId}_${convId}`,
          JSON.stringify(serializeRatchetState(state)),
        );
        return ratchetMsg;
      } catch (e) {
        console.error("Encryption failed:", e);
        return null;
      }
    },
    [sessions, currentUserId, getOrCreateRatchetState],
  );

  const sendMessageToServer = async (
    recipientId: string,
    encryptedPayload: EncryptedDbMessage,
  ) => {
    if (!user) return { success: false, message: "Not logged in" };
    try {
      const { error } = await supabase.from("message_queue").insert({
        sender_id: user.id,
        recipient_id: recipientId,
        payload: encryptedPayload,
      });
      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      console.error("Failed to send message to server:", err);
      return { success: false, message: err.message };
    }
  };

  // Load local messages for the active conversation
  useEffect(() => {
    if (!user || !isReady || !activeConversationId) return;

    const loadLocalMessages = async () => {
      try {
        const rows = await messageRepo.getRecentMessages(
          activeConversationId,
          30,
          0,
        );
        // Map rows to UI messages
        for (const row of rows.reverse()) {
          const uiMsg: EncryptedDbMessage = {
            id: row.id,
            conversation_id: row.conversation_id,
            sender: row.sender_id,
            timestamp: row.created_at_server,
            text:
              row.local_plaintext || "[Historical Message - Missing Plaintext]",
            isDecrypted: true,
          } as any;
          addMessage(row.conversation_id, uiMsg);
        }
      } catch (err) {
        console.error("[SessionManager] Failed to load local messages:", err);
      }
    };

    loadLocalMessages();
  }, [user, isReady, activeConversationId, addMessage]);

  // Subscribe to new incoming real time queue messages globally
  useEffect(() => {
    if (!user || !isReady) return;

    // 1. Fetch initial messages from Server (Queue)
    const fetchInitialMessages = async () => {
      try {
        const { data, error } = await supabase
          .from("message_queue")
          .select("*")
          .eq("recipient_id", user.id)
          .order("created_at", { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          // Decrypt sequentially in order to maintain ratchet state-machine sync
          for (const row of data) {
            const payload = row.payload as EncryptedDbMessage;
            await decryptAndAddMessage(payload.conversation_id, payload);
          }

          // prevent reprocessing: delete messages from server's queue
          const idsToDelete = data.map((row) => row.id);
          await supabase.from("message_queue").delete().in("id", idsToDelete);
        }
      } catch (err) {
        console.error("Error fetching initial messages:", err);
      }
    };

    fetchInitialMessages();

    // 2. Subscribe to new messages using a unique channel name per user session
    const channelName = `message_queue_${user.id}_${Date.now()}`;
    const subscription = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_queue",
        },
        async (payload) => {
          const newRow = payload.new as any;
          if (newRow && newRow.payload) {
            // Client-side verification that we are the recipient
            if (newRow.recipient_id !== user.id) return;

            console.log("[Supabase Realtime] Received new message:", newRow.id);
            const newMsg = newRow.payload as EncryptedDbMessage;
            await decryptAndAddMessage(newMsg.conversation_id, newMsg);

            // Delete from queue after processing
            await supabase.from("message_queue").delete().eq("id", newRow.id);
          }
        },
      )
      .subscribe((status) => {
        console.log(`[Supabase Realtime] Subscription status:`, status);
      });

    return () => {
      console.log(`[Supabase Realtime] Removing channel`, channelName);
      supabase.removeChannel(subscription);
    };
  }, [user, isReady, decryptAndAddMessage]);

  // Helper to add a contact by username
  const handleAddContact = async (
    friendUsername: string,
  ): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: "User not logged in" };

    const res = await sendFriendRequest(
      currentUserId,
      currentUser,
      friendUsername,
    );
    if (res.success) {
      // Trigger state refresh
      setIsReady(false);
      setRefreshTrigger((prev) => prev + 1);
    }
    return res;
  };

  const handleAcceptRequest = async (requestId: string, fromUserId: string) => {
    if (!user) return { success: false, message: "User not logged in" };
    const res = await acceptFriendRequest(requestId, user.id, fromUserId);
    if (res.success) {
      setIsReady(false);
      setRefreshTrigger((prev) => prev + 1);
    }
    return res;
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!user) return { success: false, message: "User not logged in" };
    const res = await rejectFriendRequest(requestId);
    if (res.success) {
      setIsReady(false);
      setRefreshTrigger((prev) => prev + 1);
    }
    return res;
  };

  const loadOlderMessages = useCallback(async () => {
    if (!activeConversationId) return;

    // Determine offset based on all currently loaded messages for this conversation
    const currentMsgCount = activeMessages.length;

    try {
      const rows = await messageRepo.getRecentMessages(
        activeConversationId,
        30,
        currentMsgCount,
      );
      if (rows.length === 0) return; // No more messages

      const olderMsgs: EncryptedDbMessage[] = rows.map(
        (row) =>
          ({
            id: row.id,
            conversation_id: row.conversation_id,
            sender: row.sender_id,
            timestamp: row.created_at_server,
            text:
              row.local_plaintext || "[Historical Message - Missing Plaintext]", // TODO: Should no longer have "historical messages'"
            isDecrypted: true,
          }) as any,
      );

      setMessagesDB((prev) => {
        const existing = prev[activeConversationId] || [];
        // Prevent duplicates
        const newMsgs = olderMsgs.filter(
          (oldM) => !existing.some((m) => m.id === oldM.id),
        );
        return {
          ...prev,
          [activeConversationId]: [...newMsgs, ...existing].sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          ),
        };
      });
    } catch (err) {
      console.error("[SessionManager] Failed to load older messages:", err);
    }
  }, [activeConversationId, activeMessages]);

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
    loadOlderMessages,
    encryptOutgoingMessage,
    sendMessageToServer,
    handleAddContact,
    pendingRequests,
    handleAcceptRequest,
    handleRejectRequest,
  };
}
