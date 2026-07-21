// The RPC itself needs a live DB (validated in the E2E); this only tests the
// client's parse/fallback contract. Mock ../supabase so onboarding.ts (which has
// no module-level side effects) imports cleanly. See pinBackup.test.ts for the
// same mock pattern.
import { popOneTimePrekey } from "../onboarding";

const mockRpc = jest.fn();
jest.mock("../../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const PEER = "peer-uuid-1234";

beforeEach(() => mockRpc.mockReset());

describe("popOneTimePrekey", () => {
  it("returns the mapped row when one is present", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "opk-id-1", public_key: "deadbeef" }],
      error: null,
    });
    await expect(popOneTimePrekey(PEER)).resolves.toEqual({
      id: "opk-id-1",
      publicKey: "deadbeef",
    });
    expect(mockRpc).toHaveBeenCalledWith("pop_one_time_prekey", {
      target: PEER,
    });
  });

  it("returns null when the pool is exhausted (empty array)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(popOneTimePrekey(PEER)).resolves.toBeNull();
  });

  it("returns null when data is null", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(popOneTimePrekey(PEER)).resolves.toBeNull();
  });

  it("returns null (not throw) on rpc error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "not_friends" },
    });
    await expect(popOneTimePrekey(PEER)).resolves.toBeNull();
  });
});
