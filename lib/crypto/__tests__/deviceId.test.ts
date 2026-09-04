// kv is mocked with an in-memory store so getDeviceId's persistence is observable
// without a real SQLite DB. jest.mock is hoisted above the imports by babel-jest.
import { __resetDeviceIdCache, getDeviceId } from "../deviceId";

jest.mock("../../database/kv", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    kv: {
      get: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      remove: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    },
  };
});

const kvMock = jest.requireMock("../../database/kv") as {
  __store: Map<string, string>;
  kv: { get: jest.Mock; set: jest.Mock };
};

const USER = "user-1";

beforeEach(() => {
  kvMock.__store.clear();
  kvMock.kv.get.mockClear();
  kvMock.kv.set.mockClear();
  __resetDeviceIdCache();
});

describe("getDeviceId", () => {
  it("mints a uuid once and returns the same value within a session", async () => {
    const a = await getDeviceId(USER);
    const b = await getDeviceId(USER);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(b).toBe(a);
    // Cached after first read: kv is written exactly once, never re-minted.
    expect(kvMock.kv.set).toHaveBeenCalledTimes(1);
  });

  it("is stable across a fresh module load (reads the persisted value, no re-mint)", async () => {
    const first = await getDeviceId(USER);
    __resetDeviceIdCache(); // simulate a new app launch on the same install
    kvMock.kv.set.mockClear();
    const second = await getDeviceId(USER);
    expect(second).toBe(first);
    expect(kvMock.kv.set).not.toHaveBeenCalled();
  });

  it("mints distinct ids for different users", async () => {
    const a = await getDeviceId(USER);
    const b = await getDeviceId("user-2");
    expect(a).not.toBe(b);
  });
});
