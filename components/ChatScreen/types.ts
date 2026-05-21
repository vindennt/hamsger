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

export interface Message {
  id: string;
  sender: User;
  text: string;
  timestamp: Date;
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
    responderRatchetPub: string;
    responderRatchetPriv: string;
  };
}
