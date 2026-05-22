import { useMemo } from "react";
import { EncryptedDbMessage, toMessage } from "./types";

/**
 * Maps decrypted messages to UI
 */
export function useDecryption(
  // currentUserIdentity: UserIdentity | undefined,
  // sessionContext: SessionContext | undefined,
  dbMessages: EncryptedDbMessage[],
) {
  const decryptedMessages = useMemo(() => {
    return dbMessages.map(toMessage);
  }, [dbMessages]);

  return {
    decryptedMessages,
  };
}
