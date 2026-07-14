// Tests the archive module with REAL AES-GCM (X3DH) but mocked storage/network.
// messageArchive.ts imports ../supabase, the kv/message/outbox repos, and the
// archive flusher; the logic under test is the encrypt-envelope + enqueue + dedup
// + restore-decrypt flow, so those side-effecting modules are stubbed.
// jest hoists jest.mock() above imports, so captured vars must be `mock`-prefixed.
// See docs/impl/p3-cloud-archive-hybrid.md.
import { X3DH } from "../x3dh";

const mockKvStore = new Map<string, string>();
const mockOutboxRows: any[] = [];
const mockInsertedMessages: any[] = [];
let mockAllLocalMessages: any[] = [];
const mockFlushArchiveOutbox = jest.fn();

// Chainable Supabase query mock for restoreArchive. `range(from, to)` resolves.
let mockArchiveTable: any[] = [];
jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            range: jest.fn(async (from: number, to: number) => ({
              data: mockArchiveTable.slice(from, to + 1),
              error: null,
            })),
          })),
        })),
      })),
    })),
  },
}));

jest.mock("../../database/kv", () => ({
  kv: {
    get: jest.fn(async (k: string) => mockKvStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      mockKvStore.set(k, v);
    }),
  },
}));

// archive_key is now encrypted at rest via secureStore. Storage is mocked here (this
// suite tests the envelope/enqueue/restore flow, not at-rest encryption), so the
// at-rest helpers are identity passthroughs into the in-memory kv.
jest.mock("../secureStore", () => ({
  readMaybeEncrypted: jest.fn(async (k: string) => mockKvStore.get(k) ?? null),
  saveEncryptedState: jest.fn(async (k: string, v: string) => {
    mockKvStore.set(k, v);
  }),
}));

jest.mock("../../database/archiveOutboxRepository", () => ({
  archiveOutboxRepo: {
    enqueue: jest.fn(async (row: any) => {
      // INSERT OR IGNORE semantics: dedupe by msg_id.
      if (!mockOutboxRows.some((r) => r.msg_id === row.msg_id))
        mockOutboxRows.push(row);
    }),
  },
}));

jest.mock("../../database/messageRepository", () => ({
  messageRepo: {
    getAllMessagesDecrypted: jest.fn(async () => mockAllLocalMessages),
    insertMessage: jest.fn(async (m: any) => {
      mockInsertedMessages.push(m);
    }),
  },
}));

jest.mock("../../outbox/archiveOutbox", () => ({
  flushArchiveOutbox: (...args: any[]) => mockFlushArchiveOutbox(...args),
}));

// Imported after the mocks above so jest's hoisted factories can close over the
// mock* fixtures before the module under test pulls in its dependencies.
// eslint-disable-next-line import/first
import {
  archiveKeyId,
  archiveMessage,
  backfillArchive,
  ensureArchiveKey,
  restoreArchive,
} from "../messageArchive";

const USER = "user-uuid-1234";

beforeEach(() => {
  jest.clearAllMocks();
  mockKvStore.clear();
  mockOutboxRows.length = 0;
  mockInsertedMessages.length = 0;
  mockAllLocalMessages = [];
  mockArchiveTable = [];
});

describe("ensureArchiveKey", () => {
  it("generates a 32-byte key once and reuses it", async () => {
    const k1 = await ensureArchiveKey(USER);
    expect(k1).toHaveLength(64); // 32 bytes hex
    expect(mockKvStore.get(archiveKeyId(USER))).toBe(k1);
    const k2 = await ensureArchiveKey(USER);
    expect(k2).toBe(k1); // not regenerated
  });
});

describe("archiveMessage", () => {
  it("encrypts the message under the archive key and enqueues a decryptable row", async () => {
    const input = {
      msg_id: "m1",
      conversation_id: "a:b",
      sender_id: "alice",
      recipient_id: USER,
      text: "hello world",
      created_at_server: "2024-01-01T00:00:00.000Z",
    };

    await archiveMessage(USER, input);

    expect(mockOutboxRows).toHaveLength(1);
    const row = mockOutboxRows[0];
    expect(row).toMatchObject({
      msg_id: "m1",
      user_id: USER,
      conversation_id: "a:b",
      created_at_server: "2024-01-01T00:00:00.000Z",
    });

    // The ciphertext round-trips to the sender/recipient/text envelope.
    const key = mockKvStore.get(archiveKeyId(USER))!;
    const plaintext = await X3DH.decrypt(key, row.ciphertext, row.iv, row.auth_tag);
    expect(JSON.parse(plaintext)).toEqual({
      sender_id: "alice",
      recipient_id: USER,
      text: "hello world",
    });
    expect(mockFlushArchiveOutbox).toHaveBeenCalledTimes(1);
  });

  it("dedupes a repeated msg_id (single archive row)", async () => {
    const input = {
      msg_id: "dup",
      conversation_id: "a:b",
      sender_id: "alice",
      recipient_id: USER,
      text: "hi",
      created_at_server: "2024-01-01T00:00:00.000Z",
    };
    await archiveMessage(USER, input);
    await archiveMessage(USER, input);
    expect(mockOutboxRows).toHaveLength(1);
  });

  it("skips the flush when flush=false (bulk callers flush once)", async () => {
    await archiveMessage(
      USER,
      {
        msg_id: "m2",
        conversation_id: "a:b",
        sender_id: "alice",
        recipient_id: USER,
        text: "hi",
        created_at_server: "2024-01-01T00:00:00.000Z",
      },
      false,
    );
    expect(mockFlushArchiveOutbox).not.toHaveBeenCalled();
  });
});

describe("backfillArchive", () => {
  it("stages every local message once and sets the backfilled flag", async () => {
    mockAllLocalMessages = [
      {
        id: "m1",
        conversation_id: "a:b",
        sender_id: "alice",
        recipient_id: USER,
        created_at_server: "t1",
        local_plaintext: "one",
      },
      {
        id: "m2",
        conversation_id: "a:b",
        sender_id: "bob",
        recipient_id: USER,
        created_at_server: "t2",
        local_plaintext: "two",
      },
      // No plaintext → skipped (e.g. failed decrypt).
      {
        id: "m3",
        conversation_id: "a:b",
        sender_id: "bob",
        recipient_id: USER,
        created_at_server: "t3",
      },
    ];

    await backfillArchive(USER);

    expect(mockOutboxRows.map((r) => r.msg_id)).toEqual(["m1", "m2"]);
    expect(mockKvStore.get(`archive_backfilled_${USER}`)).toBe("1");

    // Second run is a no-op (gated by the flag).
    mockOutboxRows.length = 0;
    await backfillArchive(USER);
    expect(mockOutboxRows).toHaveLength(0);
  });
});

describe("restoreArchive", () => {
  async function buildArchiveRow(key: string, over: any) {
    const envelope = {
      sender_id: over.sender_id,
      recipient_id: USER,
      text: over.text,
    };
    const enc = await X3DH.encrypt(key, JSON.stringify(envelope));
    return {
      conversation_id: over.conversation_id,
      msg_id: over.msg_id,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.authTag,
      created_at_server: over.created_at_server,
    };
  }

  it("paginates the cloud archive and re-inserts every decrypted message", async () => {
    const key = await ensureArchiveKey(USER);

    // 250 rows forces a second page (RESTORE_PAGE_SIZE = 200).
    for (let i = 0; i < 250; i++) {
      mockArchiveTable.push(
        await buildArchiveRow(key, {
          msg_id: `m${i}`,
          conversation_id: "a:b",
          sender_id: "alice",
          text: `msg-${i}`,
          created_at_server: `t${i}`,
        }),
      );
    }

    const restored = await restoreArchive(USER);

    expect(restored).toBe(250);
    expect(mockInsertedMessages).toHaveLength(250);
    expect(mockInsertedMessages[0]).toMatchObject({
      id: "m0",
      conversation_id: "a:b",
      sender_id: "alice",
      recipient_id: USER,
      local_plaintext: "msg-0",
    });
  });

  it("returns 0 without the archive key (pre-archive backup)", async () => {
    // No archive_key in kv → nothing to decrypt.
    const restored = await restoreArchive(USER);
    expect(restored).toBe(0);
    expect(mockInsertedMessages).toHaveLength(0);
  });
});
