// exportKeyBundle / importKeyBundle for multi-device: the blob carries ONLY the
// SHARED account secrets (IK, signing key, archive_key). SPK, the OPK pool, and
// ratchet state are per-device and must never be exported or restored — a
// restored install is a distinct device that mints its own (see
// onboarding.registerThisDevice). Storage is mocked.
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
  },
}));

jest.mock("../secureStore", () => ({
  isSecretKvKey: jest.requireActual("../secureStore").isSecretKvKey,
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

describe("exportKeyBundle (multi-device: shared account secrets only)", () => {
  it("includes IK, signing key, and archive_key", async () => {
    mockKvStore.set(`ik_priv_${USER}`, "deadbeef");
    mockKvStore.set(`ik_pub_${USER}`, "ff".repeat(32));
    mockKvStore.set(`sig_priv_${USER}`, "5ec5e7");
    mockKvStore.set(`sig_pub_${USER}`, "aa".repeat(32));
    mockKvStore.set(`archive_key_${USER}`, "a".repeat(64));

    const bundle = JSON.parse(await exportKeyBundle(USER));

    expect(bundle.keyEntries[`ik_priv_${USER}`]).toBe("deadbeef");
    expect(bundle.keyEntries[`sig_priv_${USER}`]).toBe("5ec5e7");
    expect(bundle.keyEntries[`archive_key_${USER}`]).toBe("a".repeat(64));
  });

  it("OMITS the per-device SPK, OPK pool, and ratchet state", async () => {
    mockKvStore.set(`ik_priv_${USER}`, "deadbeef");
    // Per-device material present locally but which must NOT be exported.
    mockKvStore.set(`spk_priv_${USER}`, "spk-secret");
    mockKvStore.set(`opk_priv_${USER}_pub1`, "opk1");
    mockKvStore.set(`ratchetState_v3_${USER}_a:b`, "ratchet-ciphertext");

    const bundle = JSON.parse(await exportKeyBundle(USER));

    expect(bundle.keyEntries[`spk_priv_${USER}`]).toBeUndefined();
    expect(bundle.keyEntries[`opk_priv_${USER}_pub1`]).toBeUndefined();
    expect(bundle.ratchetStates).toBeUndefined();
    expect(
      Object.keys(bundle.keyEntries).some((k) =>
        k.startsWith("ratchetState_v3_"),
      ),
    ).toBe(false);
  });
});

describe("importKeyBundle (multi-device: restores shared secrets only)", () => {
  it("restores IK + archive_key, re-encrypted under this device's key", async () => {
    const bundle = JSON.stringify({
      keyEntries: {
        [`ik_priv_${USER}`]: "cafe",
        [`archive_key_${USER}`]: "b".repeat(64),
      },
    });

    await importKeyBundle(bundle);

    expect(mockEncryptedState.get(`ik_priv_${USER}`)).toBe("cafe");
    expect(mockEncryptedState.get(`archive_key_${USER}`)).toBe("b".repeat(64));
  });

  it("ignores per-device keys even if a legacy/foreign blob carries them", async () => {
    const bundle = JSON.stringify({
      keyEntries: {
        [`ik_priv_${USER}`]: "cafe",
        [`spk_priv_${USER}`]: "foreign-spk",
        [`opk_priv_${USER}_pub1`]: "foreign-opk",
      },
    });

    await importKeyBundle(bundle);

    expect(mockEncryptedState.get(`ik_priv_${USER}`)).toBe("cafe");
    expect(mockEncryptedState.get(`spk_priv_${USER}`)).toBeUndefined();
    expect(mockEncryptedState.get(`opk_priv_${USER}_pub1`)).toBeUndefined();
  });
});
