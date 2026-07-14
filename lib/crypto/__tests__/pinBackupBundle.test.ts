// Tests exportKeyBundle / importKeyBundle around the P3 hybrid-archive change:
// the blob no longer carries messageHistory (that lives in message_archive and
// is restored via restoreArchive) but DOES carry the archive_key. Storage/network
// are mocked; see docs/impl/p3-cloud-archive-hybrid.md.
// jest hoists jest.mock() above imports, so captured vars must be `mock`-prefixed.
const mockKvStore = new Map<string, string>();
const mockEncryptedState = new Map<string, string>();

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

jest.mock("../secureStore", () => ({
  loadEncryptedState: jest.fn(async (k: string) => mockEncryptedState.get(k) ?? null),
  saveEncryptedState: jest.fn(async (k: string, v: string) => {
    mockEncryptedState.set(k, v);
  }),
  // Tolerant reader — the fixtures are plaintext, so it mirrors kv.get.
  readMaybeEncrypted: jest.fn(async (k: string) => mockKvStore.get(k) ?? null),
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

describe("importKeyBundle", () => {
  it("restores key entries and ratchet states from the blob", async () => {
    const bundle = JSON.stringify({
      keyEntries: {
        [`ik_priv_${USER}`]: "cafe",
        [`archive_key_${USER}`]: "b".repeat(64),
      },
      ratchetStates: { [`ratchetState_v3_${USER}_a:b`]: "ratchet-plain" },
    });

    await importKeyBundle(bundle);

    expect(mockKvStore.get(`ik_priv_${USER}`)).toBe("cafe");
    expect(mockKvStore.get(`archive_key_${USER}`)).toBe("b".repeat(64));
    expect(mockEncryptedState.get(`ratchetState_v3_${USER}_a:b`)).toBe(
      "ratchet-plain",
    );
  });

  it("does not overwrite a ratchet state that already exists locally", async () => {
    mockEncryptedState.set(`ratchetState_v3_${USER}_a:b`, "current-newer");
    const bundle = JSON.stringify({
      keyEntries: {},
      ratchetStates: { [`ratchetState_v3_${USER}_a:b`]: "stale-from-backup" },
    });

    await importKeyBundle(bundle);

    expect(mockEncryptedState.get(`ratchetState_v3_${USER}_a:b`)).toBe(
      "current-newer",
    );
  });
});
