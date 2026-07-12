// Tests exportKeyBundle / importKeyBundle around the P3 hybrid-archive change:
// the blob no longer carries messageHistory (it lives in message_archive) but
// DOES carry the archive_key, and import stays tolerant of a legacy blob that
// still embeds messageHistory. Storage/network are mocked; see
// docs/impl/p3-cloud-archive-hybrid.md.
// jest hoists jest.mock() above imports, so captured vars must be `mock`-prefixed.
const mockKvStore = new Map<string, string>();
const mockEncryptedState = new Map<string, string>();
const mockInsertedMessages: any[] = [];

jest.mock("../../supabase", () => ({ supabase: {} }));

jest.mock("../../database/kv", () => ({
  kv: {
    get: jest.fn(async (k: string) => mockKvStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      mockKvStore.set(k, v);
    }),
    getAllByPrefix: jest.fn(async (prefix: string) =>
      [...mockKvStore.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    ),
  },
}));

jest.mock("../../database/messageRepository", () => ({
  messageRepo: {
    getAllMessagesDecrypted: jest.fn(async () => []),
    insertMessage: jest.fn(async (m: any) => {
      mockInsertedMessages.push(m);
    }),
  },
}));

jest.mock("../secureStore", () => ({
  loadEncryptedState: jest.fn(async (k: string) => mockEncryptedState.get(k) ?? null),
  saveEncryptedState: jest.fn(async (k: string, v: string) => {
    mockEncryptedState.set(k, v);
  }),
}));

// Imported after the mocks above so jest's hoisted factories can close over the
// mock* fixtures before pinBackup pulls in its dependencies.
// eslint-disable-next-line import/first
import { exportKeyBundle, importKeyBundle } from "../pinBackup";

const USER = "user-uuid-1234";

beforeEach(() => {
  jest.clearAllMocks();
  mockKvStore.clear();
  mockEncryptedState.clear();
  mockInsertedMessages.length = 0;
});

describe("exportKeyBundle (slimmed for hybrid archive)", () => {
  it("includes the archive_key but omits messageHistory", async () => {
    mockKvStore.set(`ik_priv_${USER}`, "deadbeef");
    mockKvStore.set(`archive_key_${USER}`, "a".repeat(64));
    mockKvStore.set(`opk_priv_${USER}_pub1`, "opk1");
    mockEncryptedState.set(`ratchetState_v3_${USER}_a:b`, "ratchet-plain");
    // Register the ratchet key so getAllByPrefix finds it.
    mockKvStore.set(`ratchetState_v3_${USER}_a:b`, "ignored-ciphertext");

    const bundle = JSON.parse(await exportKeyBundle(USER));

    expect(bundle.messageHistory).toBeUndefined();
    expect(bundle.keyEntries[`archive_key_${USER}`]).toBe("a".repeat(64));
    expect(bundle.keyEntries[`ik_priv_${USER}`]).toBe("deadbeef");
    expect(bundle.keyEntries[`opk_priv_${USER}_pub1`]).toBe("opk1");
    expect(bundle.ratchetStates[`ratchetState_v3_${USER}_a:b`]).toBe(
      "ratchet-plain",
    );
  });
});

describe("importKeyBundle backward compatibility", () => {
  it("restores keys and still re-inserts a legacy messageHistory", async () => {
    const legacy = JSON.stringify({
      keyEntries: { [`ik_priv_${USER}`]: "cafe" },
      ratchetStates: {},
      messageHistory: [
        {
          id: "m1",
          conversation_id: "a:b",
          sender_id: "alice",
          recipient_id: USER,
          created_at_server: "t1",
          timestamp: "t1",
          local_plaintext: "legacy hi",
        },
      ],
    });

    await importKeyBundle(legacy);

    expect(mockKvStore.get(`ik_priv_${USER}`)).toBe("cafe");
    expect(mockInsertedMessages).toHaveLength(1);
    expect(mockInsertedMessages[0]).toMatchObject({ id: "m1", local_plaintext: "legacy hi" });
  });

  it("imports a new-style blob with no messageHistory without error", async () => {
    const modern = JSON.stringify({
      keyEntries: { [`archive_key_${USER}`]: "b".repeat(64) },
      ratchetStates: {},
    });

    await importKeyBundle(modern);

    expect(mockKvStore.get(`archive_key_${USER}`)).toBe("b".repeat(64));
    expect(mockInsertedMessages).toHaveLength(0);
  });
});
