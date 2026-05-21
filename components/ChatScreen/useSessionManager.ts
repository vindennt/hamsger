import { useEffect, useState } from "react";
import { createSession } from "../../lib/crypto/createSession";
import { KeyPair } from "../../lib/crypto/x3dh";
import {
  ConversationId,
  EncryptedDbMessage,
  makeConversationId,
  User,
  UserIdentity,
} from "./types";

// TODO: Replace with real Supabase message loading.
// allow app to load without this hardcoded test blob
type MockLog = {
  _meta: {
    keys: {
      SK: string;
      aliceDHsCore: string;
      bobRatchetPub: string;
      bobRatchetPriv: string;
    };
  };
  messages: EncryptedDbMessage[];
};

cot
  _meta: {
    keys: {
      SK: "fallback_SK",
      aliceDHsCore: "fallback_core",
      bobRatchetPub: "pub_fallback",
      bobRatchetPriv: "priv_fallback",
    },
  },
  messages: [],
};

let mockLog: MockLog;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockLog = require("../../scripts/combined/mock_messages.json") as MockLog;
} catch {
  mockLog = MOCK_LOG_FALLBACK;
}

export interface SessionContext {
  initiator: UserIdentity;
  responder: UserIdentity;
  SK: string;
  meta: {
    initiatorDHsCore: string;
    responderRatchetPub: string;
    responderRatchetPriv: string;
  };
}

export function useSessionManager() {
  const [currentUser, setCurrentUser] = useState<User>("Alice");
  const [currentPeer, setCurrentPeer] = useState<User>("Bob");

  // State for identities
  const [identities, setIdentities] = useState<Record<User, UserIdentity>>(
    {} as any,
  );
  const [isReady, setIsReady] = useState(false);

  // State for sessions and messages
  const [sessions, setSessions] = useState<
    Record<ConversationId, SessionContext>
  >({});
  const [messagesDB, setMessagesDB] = useState<
    Record<ConversationId, EncryptedDbMessage[]>
  >({});

  useEffect(() => {
    // 1. Init Identities
    const aliceId: UserIdentity = {
      name: "Alice",
      uuid: "alice-static-uuid",
      publicKey: "pub_alice_id_123",
    };
    const bobId: UserIdentity = {
      name: "Bob",
      uuid: "bob-static-uuid",
      publicKey: "pub_bob_id_456",
    };

    // Stanley dynamic entity
    // TODO: mimic this logic for new user signups
    const stanleyCore = Math.random().toString(36).substring(2, 10);
    const stanleyKP = new KeyPair("Stanley_ID", stanleyCore);
    const stanleyId: UserIdentity = {
      name: "Stanley",
      uuid: `uuid-${stanleyCore}-${Date.now().toString(36)}`,
      publicKey: stanleyKP.publicKey,
    };

    setIdentities({ Alice: aliceId, Bob: bobId, Stanley: stanleyId });

    console.log(`\n [System] Dynamic User Stanley initialized!`);
    console.log(`   UUID: ${stanleyId.uuid}`);
    console.log(`   PubKey: ${stanleyId.publicKey}\n`);

    // 2. Init Conversations
    const initialSessions: Record<ConversationId, SessionContext> = {};
    const initialDB: Record<ConversationId, EncryptedDbMessage[]> = {};

    // Alice <-> Bob (Uses mock data)
    const convAB = makeConversationId(aliceId.uuid, bobId.uuid);
    initialSessions[convAB] = {
      initiator: aliceId,
      responder: bobId,
      SK: mockLog._meta.keys.SK,
      meta: {
        initiatorDHsCore: mockLog._meta.keys.aliceDHsCore,
        responderRatchetPub: mockLog._meta.keys.bobRatchetPub,
        responderRatchetPriv: mockLog._meta.keys.bobRatchetPriv,
      },
    };

    // Do mock convos have correct conversation IDs?
    initialDB[convAB] = mockLog.messages.map((m) => ({
      ...m,
      conversation_id: convAB,
    }));

    // Alice <-> Stanley
    const sessAS = createSession(aliceId, stanleyId);
    const convAS = makeConversationId(aliceId.uuid, stanleyId.uuid);
    initialSessions[convAS] = {
      initiator: aliceId,
      responder: stanleyId,
      SK: sessAS.SK,
      meta: sessAS.meta,
    };
    initialDB[convAS] = [];

    // Bob <-> Stanley
    const sessBS = createSession(bobId, stanleyId);
    const convBS = makeConversationId(bobId.uuid, stanleyId.uuid);
    initialSessions[convBS] = {
      initiator: bobId,
      responder: stanleyId,
      SK: sessBS.SK,
      meta: sessBS.meta,
    };
    initialDB[convBS] = [];

    setSessions(initialSessions);
    setMessagesDB(initialDB);
    setIsReady(true);
  }, []);

  const activeConversationId = isReady
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

  // Helper to switch users and auto-select a valid peer
  const switchUser = (user: User) => {
    setCurrentUser(user);
    if (currentPeer === user) {
      // Pick a peer that isn't the new current user
      const peers: User[] = ["Alice", "Bob", "Stanley"];
      setCurrentPeer(peers.find((p) => p !== user) || "Bob");
    }
  };

  return {
    isReady,
    identities,
    currentUser,
    switchUser,
    currentPeer,
    setCurrentPeer,
    activeConversationId,
    activeSession,
    activeMessages,
    addMessage,
  };
}
