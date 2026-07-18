import { useCallback, useEffect, useRef } from "react";
import { messageRepo, MessageRow } from "../../lib/database/messageRepository";
import { outboxRepo } from "../../lib/database/outboxRepository";
import { useChatStore } from "../../lib/store/useChatStore";
import { EncryptedDbMessage, SendStatus } from "./types";

// One page of local history. The initial page is loaded by SessionManager (offset 0);
// scroll-to-top loads successive older pages from here.
export const MESSAGE_PAGE_SIZE = 40;

// Shared row → UI message mapping so the initial load and older-page loads stay in sync.
export function rowToUiMessage(
  row: MessageRow,
  outboxStatuses: Record<string, SendStatus>,
): EncryptedDbMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender: row.sender_id,
    timestamp: row.created_at_server,
    text: row.local_plaintext || "[Historical Message - Missing Plaintext]",
    isDecrypted: true,
    send_status: outboxStatuses[row.id],
  } as any;
}

/**
 * Cursor pagination for the active conversation. `loadOlder()` fetches the next older
 * page and prepends it; it's a safe no-op while a load is in flight or history is
 * exhausted, so callers can fire it freely on scroll.
 */
export function usePagination(activeConversationId: string) {
  const prependMessages = useChatStore((s) => s.prependMessages);
  const offsetRef = useRef(MESSAGE_PAGE_SIZE);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);

  // Reset the cursor when switching conversations. Older-loads start after the
  // initial page that SessionManager already loaded at offset 0.
  useEffect(() => {
    offsetRef.current = MESSAGE_PAGE_SIZE;
    exhaustedRef.current = false;
    loadingRef.current = false;
  }, [activeConversationId]);

  // Returns the number of rows fetched (0 when in-flight, exhausted, or at the start
  // of history) so callers can tell whether a prepend/relayout is coming.
  const loadOlder = useCallback(async (): Promise<number> => {
    if (!activeConversationId || loadingRef.current || exhaustedRef.current)
      return 0;
    loadingRef.current = true;
    try {
      const rows = await messageRepo.getRecentMessages(
        activeConversationId,
        MESSAGE_PAGE_SIZE,
        offsetRef.current,
      );
      if (rows.length === 0) {
        exhaustedRef.current = true;
        return 0;
      }
      const outboxStatuses =
        await outboxRepo.getStatusesByConversation(activeConversationId);
      prependMessages(
        activeConversationId,
        rows.map((r) => rowToUiMessage(r, outboxStatuses)),
      );
      // March the window forward by rows returned; prependMessages dedupes any overlap
      // from messages that arrived since the initial load.
      offsetRef.current += rows.length;
      if (rows.length < MESSAGE_PAGE_SIZE) exhaustedRef.current = true;
      return rows.length;
    } finally {
      loadingRef.current = false;
    }
  }, [activeConversationId, prependMessages]);

  return { loadOlder };
}
