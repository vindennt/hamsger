// Tests the incremental archive drain with REAL AES-GCM (X3DH) but mocked
// storage/network. archiveSync.ts imports ../supabase, the kv/message repos, and
// secureStore; the logic under test is the keyset-paginated drain + echo-guard +
// decrypt-insert flow, so those side-effecting modules are stubbed.
// jest hoists jest.mock() above imports, so captured vars must be `mock`-prefixed.
// Mirrors messageArchive.test.ts. See docs/impl/multi-device-phase5-plan.md.
import { X3DH } from "../x3dh";

const mockKvStore = new Map<string, string>();
const mockInsertedMessages: any[] = [];
const mockExistingIds = new Set<string>();

// Chainable Supabase query mock for drainArchive. The chain is
// from→select→eq→gt→order→range; `range(from, to)` resolves. `gt("id", cursor)`
// filters the in-memory table by id, mirroring keyset pagination.
let mockArchiveTable: any[] = [];
jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(() => {
      let gtValue = "0";
      const builder: any = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        gt: jest.fn((_col: string, val: string) => {
          gtValue = val;
          return builder;
        }),
        order: jest.fn(() => builder),
        range: jest.fn(async (from: number, to: number) => {
          const rows = mockArchiveTable
            .filter((r) => r.id > Number(gtValue))
            .sort((a, b) => a.id - b.id);
          return { data: rows.slice(from, to + 1), error: null };
        }),
      };
      return builder;
    }),
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

// archive_key is encrypted at rest via secureStore; this suite tests the drain
// flow, not at-rest encryption, so the helper is an identity passthrough into kv.
jest.mock("../secureStore", () => ({
  readMaybeEncrypted: jest.fn(async (k: string) => mockKvStore.get(k) ?? null),
}));

jest.mock("../../database/messageRepository", () => ({
  messageRepo: {
    messageExists: jest.fn(async (id: string) => mockExistingIds.has(id)),
    insertMessage: jest.fn(async (m: any) => {
      mockInsertedMessages.push(m);
    }),
  },
}));

// Imported after the mocks above so jest's hoisted factories can close over the
// mock* fixtures before the module under test pulls in its dependencies.
// eslint-disable-next-line import/first
import { archiveCursorId, drainArchive } from "../archiveSync";
// eslint-disable-next-line import/first
import { archiveKeyId } from "../messageArchive";
// eslint-disable-next-line import/first
import { supabase } from "../../supabase";

const USER = "user-uuid-1234";

async function buildRow(key: string, over: any) {
  const envelope = {
    sender_id: over.sender_id,
    recipient_id: USER,
    text: over.text,
  };
  const enc = over.corrupt
    ? { ciphertext: "deadbeef", iv: "00", authTag: "00" }
    : await X3DH.encrypt(key, JSON.stringify(envelope));
  return {
    id: over.id,
    conversation_id: over.conversation_id,
    msg_id: over.msg_id,
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    auth_tag: enc.authTag,
    created_at_server: over.created_at_server,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKvStore.clear();
  mockInsertedMessages.length = 0;
  mockExistingIds.clear();
  mockArchiveTable = [];
});

describe("drainArchive", () => {
  it("inserts new rows, advances the cursor to the max page id, and returns the count", async () => {
    const key = "a".repeat(64);
    mockKvStore.set(archiveKeyId(USER), key);

    mockArchiveTable = [
      await buildRow(key, {
        id: 1,
        conversation_id: "a:b",
        msg_id: "m1",
        sender_id: "alice",
        text: "one",
        created_at_server: "t1",
      }),
      await buildRow(key, {
        id: 2,
        conversation_id: "a:b",
        msg_id: "m2",
        sender_id: "alice",
        text: "two",
        created_at_server: "t2",
      }),
    ];

    const count = await drainArchive(USER);

    expect(count).toBe(2);
    expect(mockInsertedMessages).toHaveLength(2);
    expect(mockInsertedMessages[0]).toMatchObject({
      id: "m1",
      conversation_id: "a:b",
      sender_id: "alice",
      recipient_id: USER,
      created_at_server: "t1",
      local_plaintext: "one",
    });
    expect(mockKvStore.get(archiveCursorId(USER))).toBe("2");
  });

  it("skips a row whose msg_id already exists (echo-guard) but still advances the cursor", async () => {
    const key = "b".repeat(64);
    mockKvStore.set(archiveKeyId(USER), key);
    mockExistingIds.add("m1"); // this device's own echo, already stored

    mockArchiveTable = [
      await buildRow(key, {
        id: 5,
        conversation_id: "a:b",
        msg_id: "m1",
        sender_id: "alice",
        text: "echo",
        created_at_server: "t1",
      }),
    ];

    const count = await drainArchive(USER);

    expect(count).toBe(0);
    expect(mockInsertedMessages).toHaveLength(0);
    expect(mockKvStore.get(archiveCursorId(USER))).toBe("5");
  });

  it("skips an undecryptable row with a warn; siblings still insert", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const key = "c".repeat(64);
    mockKvStore.set(archiveKeyId(USER), key);

    mockArchiveTable = [
      await buildRow(key, {
        id: 1,
        conversation_id: "a:b",
        msg_id: "bad",
        sender_id: "alice",
        text: "nope",
        created_at_server: "t1",
        corrupt: true,
      }),
      await buildRow(key, {
        id: 2,
        conversation_id: "a:b",
        msg_id: "good",
        sender_id: "alice",
        text: "yes",
        created_at_server: "t2",
      }),
    ];

    const count = await drainArchive(USER);

    expect(count).toBe(1);
    expect(mockInsertedMessages.map((m) => m.id)).toEqual(["good"]);
    expect(warn).toHaveBeenCalled();
    expect(mockKvStore.get(archiveCursorId(USER))).toBe("2");
    warn.mockRestore();
  });

  it("returns 0 without the archive key (pre-archive account) and never queries", async () => {
    const count = await drainArchive(USER);
    expect(count).toBe(0);
    expect(mockInsertedMessages).toHaveLength(0);
    expect(supabase.from as jest.Mock).not.toHaveBeenCalled();
  });

  it("invokes onInsert once per newly-inserted row with the decrypted text", async () => {
    const key = "d".repeat(64);
    mockKvStore.set(archiveKeyId(USER), key);

    mockArchiveTable = [
      await buildRow(key, {
        id: 1,
        conversation_id: "a:b",
        msg_id: "m1",
        sender_id: "alice",
        text: "hello",
        created_at_server: "t1",
      }),
    ];

    const onInsert = jest.fn();
    await drainArchive(USER, onInsert);

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith({
      convId: "a:b",
      msgId: "m1",
      sender: "alice",
      text: "hello",
      created_at_server: "t1",
    });
  });
});
