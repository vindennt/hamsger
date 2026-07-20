import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  acceptFriendRequest,
  fetchPendingRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "../../lib/contacts";
import { verifyUserKeysExist } from "../../lib/crypto";
import {
  archiveMessage,
  backfillArchive,
  ensureArchiveKey,
} from "../../lib/crypto/messageArchive";
import { noteMessageForBackupRefresh } from "../../lib/crypto/backupAutoRefresh";
import { ratchetDecrypt, TooManySkippedError } from "../../lib/crypto/ratchet";
import { withRatchetLock } from "../../lib/crypto/ratchetLock";
import {
  SESSION_RESET_TYPE,
  clearDecryptFailures,
  markReset,
  noteDecryptFailure,
  resetConversationRatchet,
  shouldReset,
} from "../../lib/crypto/ratchetRecovery";
import { saveEncryptedState } from "../../lib/crypto/secureStore";
import { messageRepo } from "../../lib/database/messageRepository";
import { outboxRepo } from "../../lib/database/outboxRepository";
import { useChatStore } from "../../lib/store/useChatStore";
import { supabase } from "../../lib/supabase";
import {
  getOrCreateRatchetState,
  serializeRatchetState,
} from "./ratchetHelpers";
import {
  RESET_NOTE_LOCAL,
  RESET_NOTE_PEER,
  makeSystemNote,
  sendSessionReset,
} from "./sessionReset";
import { loadContactsAndSessions } from "./sessionHelpers";
import { EncryptedDbMessage, UserIdentity, makeConversationId } from "./types";
import { MESSAGE_PAGE_SIZE, rowToUiMessage } from "./usePagination";
import { useBackupAutoRefresh } from "./useBackupAutoRefresh";
import { useOutbox } from "./useOutbox";

export function SessionManager() {
  const { user } = useAuth();
  const router = useRouter();

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Zustand Actions
  const setIsReady = useChatStore((s) => s.setIsReady);
  const setCurrentUser = useChatStore((s) => s.setCurrentUser);
  const setPendingRequests = useChatStore((s) => s.setPendingRequests);
  const addMessage = useChatStore((s) => s.addMessage);

  // We subscribe to isReady and the derived activeConversationId so we know when to load messages
  const isReady = useChatStore((s) => s.isReady);
  const currentUser = useChatStore((s) => s.currentUser);
  const currentUserId = useChatStore((s) => s.currentUserId);
  const currentPeer = useChatStore((s) => s.currentPeer);
  const identities = useChatStore((s) => s.identities);

  const activeConversationId =
    isReady && currentPeer && identities[currentUser] && identities[currentPeer]
      ? [identities[currentUser].uuid, identities[currentPeer].uuid]
          .sort()
          .join(":")
      : "";

  // Ratchet serialization now lives in a shared module (lib/crypto/ratchetLock)
  // so the send path and this receive path serialize against each other.

  // Retry pending sends on foreground / reconnect / timer.
  useOutbox(isReady);

  // #8: checkpoint the (slim) backup blob when the app is backgrounded / hidden.
  useBackupAutoRefresh(user?.id);

  useEffect(() => {
    if (!user) return;
    const currentUsername =
      user.user_metadata?.username ||
      user.email?.split("@")[0] ||
      "unauthorized";
    setCurrentUser(currentUsername, user.id);
  }, [user, setCurrentUser]);

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

        const result = await verifyUserKeysExist(userId, username);

        if (result.needsPinSetup) {
          router.replace("/(auth)/setup-pin");
          return;
        }
        if (result.needsRestore) {
          router.replace("/(auth)/restore-keys");
          return;
        }

        const myIdentity: UserIdentity = {
          name: username,
          uuid: userId,
          publicKey: result.identityKey,
        };

        const { resolvedContacts, newIdentities, initialSessions } =
          await loadContactsAndSessions(userId, myIdentity);

        const peer =
          resolvedContacts.length > 0 ? resolvedContacts[0].name : "";
        useChatStore
          .getState()
          .initData(resolvedContacts, newIdentities, initialSessions, peer);

        // Ensure the archive key exists (new keys are captured by the next
        // backup) and one-time backfill any pre-archive local history. Both are
        // fire-and-forget so they never block the chat UI.
        ensureArchiveKey(userId)
          .then(() => backfillArchive(userId))
          .catch((archiveErr) =>
            console.error(
              "[SessionManager] Archive init/backfill failed:",
              archiveErr,
            ),
          );
      } catch (err: any) {
        console.error("[SessionManager] init failed:", err);
        if (err?.message?.includes("Check your connection")) {
          Alert.alert(
            "Connection Error",
            "Could not reach the server. Please check your internet connection and try again.",
            [{ text: "OK" }],
          );
          // TODO: Log this error more in future
        } else if (err?.message?.includes("Missing encryption keys")) {
          Alert.alert("Setup Error", err.message, [{ text: "OK" }]);
        }
        setIsReady(true);
      }
    }

    setupUserCryptoAndContacts();
    // Key on user?.id, NOT the user object: Supabase hands us a fresh `user`
    // object on every token auto-refresh, and re-running full crypto/contacts
    // init (and initData) on each of those was needless churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshTrigger]);

  useEffect(() => {
    if (!user) return;

    fetchPendingRequests(user.id).then((data) => {
      setPendingRequests(data || []);
    });

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
            fetchPendingRequests(user.id).then((data) => {
              setPendingRequests(data || []);
            });

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
  }, [user, refreshTrigger, setPendingRequests, setIsReady]);

  const decryptAndAddMessage = useCallback(
    async (convId: string, msg: EncryptedDbMessage, authSenderId: string) => {
      if ((msg as any).isDecrypted) {
        addMessage(convId, msg);
        return;
      }

      // Trust the authenticated sender_id (RLS), never the
      // attacker payload.sender string. Resolve the display name
      // from the identity map by UUID and confirm the sender is the other
      // participant of this conversation. Drop anything else
      const identities = useChatStore.getState().identities;
      const trustedIdentity = Object.values(identities).find(
        (idn) => idn.uuid === authSenderId,
      );
      if (
        !trustedIdentity ||
        convId !== makeConversationId(currentUserId, authSenderId)
      ) {
        console.warn(
          `[SessionManager] Dropping message ${msg.id}: sender ${authSenderId} is not a known participant of ${convId}`,
        );
        return;
      }
      const trustedSender = trustedIdentity.name;

      const sessions = useChatStore.getState().sessions;
      const session = sessions[convId];
      if (!session) {
        console.warn(
          `[SessionManager] No session for ${convId}: message dropped, will be fetched from queue on next load`,
        );
        return;
      }

      try {
        const state = await getOrCreateRatchetState(
          convId,
          session,
          currentUserId,
          currentUser,
        );
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
            sender_id: trustedSender,
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

        // Fire-and-forget: stage this received message into the cloud archive.
        archiveMessage(currentUserId, {
          msg_id: msg.id,
          conversation_id: convId,
          sender_id: trustedSender,
          recipient_id: currentUserId,
          text: plaintext,
          created_at_server: msg.timestamp,
        }).catch((archiveErr) =>
          console.error(
            "[SessionManager] Failed to archive received message:",
            archiveErr,
          ),
        );

        // Throttled #8: keep the durable ratchet-state backup from going stale.
        noteMessageForBackupRefresh(currentUserId);

        const decryptedMsg = {
          ...msg,
          sender: trustedSender,
          text: plaintext,
          isDecrypted: true,
        };

        addMessage(convId, decryptedMsg);
        clearDecryptFailures(convId); // in sync again
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
          sender: trustedSender,
          text: "[Message failed to load]",
          isDecrypted: true,
        };
        addMessage(convId, failedMsg);

        // Desync recovery: a skip-overflow, or repeated auth-tag failures, means the
        // ratchet chains diverged. Reset locally (we already hold the ratchet lock)
        // and tell the peer so both re-establish from the deterministic session.
        const immediate = e instanceof TooManySkippedError;
        if (!immediate) noteDecryptFailure(convId);
        if (shouldReset(convId, { immediate })) {
          markReset(convId);
          await resetConversationRatchet(currentUserId, convId);
          addMessage(convId, makeSystemNote(convId, RESET_NOTE_LOCAL));
          void sendSessionReset(currentUserId, authSenderId);
        }
      }
    },
    [addMessage, currentUserId, currentUser],
  );

  // Load local messages for the active conversation
  useEffect(() => {
    if (!user || !isReady || !activeConversationId) return;

    const loadLocalMessages = async () => {
      try {
        const rows = await messageRepo.getRecentMessages(
          activeConversationId,
          MESSAGE_PAGE_SIZE,
          0,
        );
        // Undelivered sends keep their pending/failed indicator across restarts.
        const outboxStatuses =
          await outboxRepo.getStatusesByConversation(activeConversationId);
        // Map rows to UI messages
        for (const row of rows.reverse()) {
          addMessage(row.conversation_id, rowToUiMessage(row, outboxStatuses));
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

    const fetchInitialMessages = async () => {
      try {
        const { data, error } = await supabase
          .from("message_queue")
          .select("*")
          .eq("recipient_id", user.id)
          .order("created_at", { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          for (const row of data) {
            const payload = row.payload as EncryptedDbMessage;
            const convId = makeConversationId(user.id, row.sender_id);
            if (payload.type === SESSION_RESET_TYPE) {
              await withRatchetLock(convId, () =>
                resetConversationRatchet(user.id, convId),
              );
              useChatStore
                .getState()
                .addMessage(convId, makeSystemNote(convId, RESET_NOTE_PEER));
            } else {
              const alreadyStored = await messageRepo.messageExists(payload.id);
              if (!alreadyStored) {
                await withRatchetLock(convId, () =>
                  decryptAndAddMessage(convId, payload, row.sender_id),
                );
              }
            }
            try {
              await supabase.from("message_queue").delete().eq("id", row.id);
            } catch (deleteErr) {
              console.warn(
                "[SessionManager] Failed to delete queue row:",
                row.id,
                deleteErr,
              );
            }
          }
        }
      } catch (err) {
        console.error("Error fetching initial messages:", err);
      }
    };

    fetchInitialMessages();

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
            if (newRow.recipient_id !== user.id) return;

            const newMsg = newRow.payload as EncryptedDbMessage;
            const convId = makeConversationId(user.id, newRow.sender_id);
            if (newMsg.type === SESSION_RESET_TYPE) {
              await withRatchetLock(convId, () =>
                resetConversationRatchet(user.id, convId),
              );
              useChatStore
                .getState()
                .addMessage(convId, makeSystemNote(convId, RESET_NOTE_PEER));
            } else {
              const alreadyStored = await messageRepo.messageExists(newMsg.id);
              if (!alreadyStored) {
                await withRatchetLock(convId, () =>
                  decryptAndAddMessage(convId, newMsg, newRow.sender_id),
                );
              }
            }
            try {
              await supabase.from("message_queue").delete().eq("id", newRow.id);
            } catch (deleteErr) {
              console.warn(
                "[SessionManager] Failed to delete queue row:",
                newRow.id,
                deleteErr,
              );
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [user, isReady, decryptAndAddMessage]);

  return null; // Headless component
}

export async function handleAddContact(
  currentUserId: string,
  currentUser: string,
  friendUsername: string,
) {
  const res = await sendFriendRequest(
    currentUserId,
    currentUser,
    friendUsername,
  );
  return res;
}

export async function handleAcceptRequest(
  requestId: string,
  currentUserId: string,
  fromUserId: string,
) {
  const res = await acceptFriendRequest(requestId, currentUserId, fromUserId);
  return res;
}

export async function handleRejectRequest(requestId: string) {
  const res = await rejectFriendRequest(requestId);
  return res;
}
