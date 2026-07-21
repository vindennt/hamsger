// Dynamically loaded contacts
export type User = string;

export interface UserIdentity {
  name: string; // username
  uuid: string;
  publicKey: string; // identity PK
}

export type ConversationId = string;

export function makeConversationId(
  uuid1: string,
  uuid2: string,
): ConversationId {
  return [uuid1, uuid2].sort().join(":");
}

// Delivery state for messages WE send (durable outbox, see lib/outbox).
// Received messages leave this undefined.
export type SendStatus = "pending" | "sent" | "failed";

export interface Message {
  id: string;
  sender: User;
  text: string;
  timestamp: Date;
  send_status?: SendStatus;
  system?: boolean; // in-thread system note (e.g. session reset), not a real message
}

// Example DB schema
// Temporary structure from the mock messages

export interface EncryptedDbMessage {
  id: string;
  conversation_id: ConversationId;
  sender: User;
  timestamp: string; // ISO-8601

  // Encrypted payload
  ciphertext: string; // AES-256-GCM, hex
  iv: string; // 12-byte random IV, hex
  auth_tag: string; // 16-byte GCM auth tag, hex

  // Double Ratchet header (needed to derive the per-message key)
  dh_pub: string; // sender's ratchet public key, hex-DER
  pn: number; // messages sent in previous chain
  n: number; // index of this message in the current chain

  // UI convenience — same as ciphertext until decryption is implemented
  text: string;

  // Delivery state for sent messages (undefined for received messages).
  send_status?: SendStatus;

  // Present on a control message (no crypto fields used) telling the peer to
  // re-establish the session. See lib/crypto/ratchetRecovery.SESSION_RESET_TYPE.
  type?: "session_reset";

  // UI-only: an in-thread system note (e.g. "Secure session was reset"), not
  // an encrypted message. Rendered centered/greyed by MessageList.
  system?: boolean;
}

/**
 * Convert an EncryptedDbMessage from the cloud/mock log into the Message
 * shape the ChatScreen consumes. The `text` field carries the raw ciphertext
 * so the UI renders intentional gibberish until decryption is wired up.
 */
export function toMessage(db: EncryptedDbMessage): Message {
  return {
    id: db.id,
    sender: db.sender,
    text: db.text, // raw ciphertext — swap for plaintext once decrypted
    timestamp: new Date(db.timestamp),
    send_status: db.send_status,
    system: db.system,
  };
}

// Placeholder used only when the mock log fails to load.
export const FALLBACK_MESSAGES: Message[] = [];

export interface SessionContext {
  initiator: UserIdentity;
  responder: UserIdentity;
  SK: string;
  meta: {
    initiatorDHsCore: string;
    initiatorDHsPub: string;
    responderRatchetPub: string;
    responderRatchetPriv?: string;
  };
}
