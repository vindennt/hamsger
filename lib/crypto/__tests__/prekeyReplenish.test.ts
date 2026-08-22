// prekeyReplenish tops up this device's OPK pool when it runs low and refreshes
// last_seen. Storage/network are mocked; KeyPair is real. jest hoists jest.mock()
// above imports, so captured vars must be `mock`-prefixed.
const mockKeystore = new Map<string, string>();
const mockInserted: any[] = [];
const mockUpdateCalls: any[] = [];
let mockOpkCount = 0;
let mockCountError: { message: string } | null = null;

// A chainable object that is also awaitable. select/insert/update/eq return it;
// awaiting resolves to the configured result for that table.
jest.mock("../../supabase", () => {
  const chain = (
    result: () => any,
    onInsert?: (rows: any[]) => void,
    onUpdate?: (patch: any) => void,
  ) => {
    const obj: any = {
      select: () => obj,
      insert: (rows: any[]) => {
        onInsert?.(rows);
        return obj;
      },
      update: (patch: any) => {
        onUpdate?.(patch);
        return obj;
      },
      eq: () => obj,
      then: (resolve: any) => resolve(result()),
    };
    return obj;
  };
  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === "one_time_prekeys") {
          return chain(
            () => ({
              count: mockCountError ? null : mockOpkCount,
              error: mockCountError,
            }),
            (rows) => mockInserted.push(...rows),
          );
        }
        return chain(
          () => ({ error: null }),
          undefined,
          (patch) => mockUpdateCalls.push(patch),
        );
      }),
    },
  };
});

jest.mock("../keystore", () => ({
  keystore: {
    set: jest.fn(async (k: string, v: string) => {
      mockKeystore.set(k, v);
    }),
    get: jest.fn(async (k: string) => mockKeystore.get(k) ?? null),
  },
}));

// eslint-disable-next-line import/first
import {
  __resetReplenishGuard,
  refreshDevicePresence,
  replenishOwnPrekeys,
} from "../prekeyReplenish";

const USER = "user-1";
const DEVICE = "device-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockKeystore.clear();
  mockInserted.length = 0;
  mockUpdateCalls.length = 0;
  mockOpkCount = 0;
  mockCountError = null;
  __resetReplenishGuard();
});

describe("replenishOwnPrekeys", () => {
  it("tops the pool up to TARGET when below the minimum", async () => {
    mockOpkCount = 2;
    await replenishOwnPrekeys(USER, DEVICE);
    // 10 target - 2 present = 8 new OPKs, each with a stored private and a
    // device-tagged public row.
    expect(mockInserted).toHaveLength(8);
    expect(mockKeystore.size).toBe(8);
    for (const row of mockInserted) {
      expect(row).toMatchObject({ user_id: USER, device_id: DEVICE });
      expect(mockKeystore.has(`opk_priv_${USER}_${row.public_key}`)).toBe(true);
    }
  });

  it("does nothing when the pool is at or above the minimum", async () => {
    mockOpkCount = 5;
    await replenishOwnPrekeys(USER, DEVICE);
    expect(mockInserted).toHaveLength(0);
  });

  it("only checks once per session", async () => {
    mockOpkCount = 2;
    await replenishOwnPrekeys(USER, DEVICE);
    expect(mockInserted).toHaveLength(8);
    mockInserted.length = 0;
    // Pool still low, but the session guard should short-circuit the second call.
    await replenishOwnPrekeys(USER, DEVICE);
    expect(mockInserted).toHaveLength(0);
  });

  it("retries after a count error (guard not set on failure)", async () => {
    mockCountError = { message: "boom" };
    await replenishOwnPrekeys(USER, DEVICE);
    expect(mockInserted).toHaveLength(0);

    mockCountError = null;
    mockOpkCount = 0;
    await replenishOwnPrekeys(USER, DEVICE);
    expect(mockInserted).toHaveLength(10);
  });
});

describe("refreshDevicePresence", () => {
  it("touches last_seen and replenishes", async () => {
    mockOpkCount = 0;
    await refreshDevicePresence(USER, DEVICE);
    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0]).toHaveProperty("updated_at");
    expect(mockInserted).toHaveLength(10);
  });
});
