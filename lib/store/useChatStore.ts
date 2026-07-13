import { create } from 'zustand';
import { UserIdentity, SessionContext, ConversationId, EncryptedDbMessage, SendStatus } from '../../components/ChatScreen/types';

interface ChatState {
  isReady: boolean;
  currentUser: string;
  currentUserId: string;
  currentPeer: string;
  contacts: UserIdentity[];
  identities: Record<string, UserIdentity>;
  sessions: Record<ConversationId, SessionContext>;
  messagesDB: Record<ConversationId, EncryptedDbMessage[]>;
  pendingRequests: any[];

  setIsReady: (ready: boolean) => void;
  setCurrentUser: (user: string, id: string) => void;
  setCurrentPeer: (peer: string) => void;
  setContacts: (contacts: UserIdentity[]) => void;
  setIdentities: (identities: Record<string, UserIdentity>) => void;
  setSessions: (sessions: Record<ConversationId, SessionContext>) => void;
  addSession: (convId: ConversationId, session: SessionContext) => void;
  
  // High-performance message appending
  addMessage: (convId: ConversationId, msg: EncryptedDbMessage) => void;
  setMessages: (convId: ConversationId, messages: EncryptedDbMessage[]) => void;
  updateMessageStatus: (convId: ConversationId, msgId: string, status: SendStatus) => void;

  initData: (contacts: UserIdentity[], identities: Record<string, UserIdentity>, sessions: Record<string, SessionContext>, peer: string) => void;

  setPendingRequests: (requests: any[]) => void;
  
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isReady: false,
  currentUser: "unauthorized",
  currentUserId: "unauthorized-id",
  currentPeer: "",
  contacts: [],
  identities: {},
  sessions: {},
  messagesDB: {},
  pendingRequests: [],

  setIsReady: (isReady) => set({ isReady }),
  setCurrentUser: (currentUser, currentUserId) => set({ currentUser, currentUserId }),
  setCurrentPeer: (currentPeer) => set({ currentPeer }),
  setContacts: (contacts) => set({ contacts }),
  setIdentities: (identities) => set({ identities }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (convId, session) => set((state) => ({
    sessions: { ...state.sessions, [convId]: session }
  })),

  // NOTE: does NOT clear messagesDB. This runs on every (re)init of contacts/
  // sessions — including spurious re-runs when Supabase rotates the auth token
  // and hands us a new `user` object — so wiping messages here dropped the whole
  // in-memory chat log until the screen remounted. Messages are keyed by
  // conversationId and deduped by id, so keeping them across re-init is safe; a
  // real account switch clears everything via reset().
  initData: (contacts, identities, sessions, peer) => set({
    contacts,
    identities,
    sessions,
    currentPeer: peer,
    isReady: true,
  }),

  addMessage: (convId, msg) => set((state) => {
    const existing = state.messagesDB[convId] || [];
    if (existing.some((m) => m.id === msg.id)) return state; // Deduplicate
    return {
      messagesDB: {
        ...state.messagesDB,
        [convId]: [...existing, msg].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        ),
      },
    };
  }),

  setMessages: (convId, messages) => set((state) => ({
    messagesDB: {
      ...state.messagesDB,
      [convId]: [...messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
    }
  })),

  updateMessageStatus: (convId, msgId, status) => set((state) => {
    const existing = state.messagesDB[convId];
    if (!existing) return state;
    let changed = false;
    const next = existing.map((m) => {
      if (m.id === msgId && m.send_status !== status) {
        changed = true;
        return { ...m, send_status: status };
      }
      return m;
    });
    if (!changed) return state;
    return { messagesDB: { ...state.messagesDB, [convId]: next } };
  }),

  setPendingRequests: (pendingRequests) => set({ pendingRequests }),

  reset: () => set({
    isReady: false,
    currentUser: "unauthorized",
    currentUserId: "unauthorized-id",
    currentPeer: "",
    contacts: [],
    identities: {},
    sessions: {},
    messagesDB: {},
    pendingRequests: []
  }),
}));
