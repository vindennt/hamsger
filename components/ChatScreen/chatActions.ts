import { supabase } from "../../lib/supabase";
import { EncryptedDbMessage, ConversationId } from "./types";
import { messageRepo } from "../../lib/database/messageRepository";
import { useChatStore } from "../../lib/store/useChatStore";
import { 
  getOrCreateRatchetState, 
  serializeRatchetState 
} from "./ratchetHelpers"; 
import { saveEncryptedState } from "../../lib/crypto/secureStore";
import { ratchetEncrypt } from "../../lib/crypto/ratchet";

export async function sendMessage(inputText: string) {
  if (!inputText.trim()) return;

  const state = useChatStore.getState();
  const { 
    currentUser, 
    currentUserId, 
    currentPeer, 
    identities, 
    sessions,
    addMessage 
  } = state;

  if (!currentPeer) return;

  const recipientIdentity = identities[currentPeer];
  if (!recipientIdentity) return;

  const activeConversationId = [identities[currentUser]?.uuid, recipientIdentity.uuid].sort().join(":");
  const session = sessions[activeConversationId];

  if (!session || !activeConversationId) {
    console.error("Encryption failed or late");
    return;
  }

  let ratchetMsg;
  try {
    const ratchetState = await getOrCreateRatchetState(
      activeConversationId, 
      session, 
      currentUserId, 
      currentUser
    );
    ratchetMsg = await ratchetEncrypt(ratchetState, inputText.trim(), () => {});
    
    // Save updated ratchet state
    await saveEncryptedState(
      `ratchetState_v3_${currentUserId}_${activeConversationId}`,
      JSON.stringify(serializeRatchetState(ratchetState)),
    );
  } catch (e: any) {
    console.error("Encryption Ratchet Error:", e);
    return;
  }

  if (!ratchetMsg) return;

  // Encrypted DB message payload for the server
  const serverDbMsg: EncryptedDbMessage = {
    id: `msg_new_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    conversation_id: activeConversationId,
    sender: currentUser,
    ciphertext: ratchetMsg.ciphertext,
    iv: ratchetMsg.iv,
    auth_tag: ratchetMsg.authTag,
    dh_pub: ratchetMsg.header.DHpub,
    pn: ratchetMsg.header.PN,
    n: ratchetMsg.header.N,
    timestamp: new Date().toISOString(),
    text: ratchetMsg.ciphertext, // Server never sees plaintext
  };

  try {
    const { error } = await supabase.from("message_queue").insert({
      sender_id: currentUserId,
      recipient_id: recipientIdentity.uuid,
      payload: serverDbMsg,
    });
    if (error) throw error;
  } catch (err: any) {
    console.error("Failed to send message to server:", err);
  }

  // Local DB message representation preserving plaintext and marked decrypted
  const localDbMsg: EncryptedDbMessage = {
    ...serverDbMsg,
    text: inputText.trim(), // plaintext is kept local only
    isDecrypted: true, 
  } as any;

  try {
    await messageRepo.insertMessage({
      id: localDbMsg.id,
      conversation_id: localDbMsg.conversation_id,
      sender_id: localDbMsg.sender,
      recipient_id: recipientIdentity.uuid,
      created_at_server: localDbMsg.timestamp,
      timestamp: new Date().toISOString(),
      local_plaintext: inputText.trim()
    });
  } catch (dbErr) {
    console.error("Failed to insert sent message to local DB:", dbErr);
  }

  addMessage(activeConversationId, localDbMsg);
}
