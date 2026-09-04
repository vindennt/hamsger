// kv is mocked so resetConversationRatchet's delete is observable without a real DB.
// jest.mock is hoisted above these imports by babel-jest, so `kv` resolves to the mock.
import { kv } from "../../database/kv";
import {
  __resetRecoveryState,
  clearDecryptFailures,
  hydrateCooldown,
  markReset,
  noteDecryptFailure,
  RESET_COOLDOWN_MS,
  resetConversationRatchet,
  SESSION_RESET_THRESHOLD,
  shouldReset,
} from "../ratchetRecovery";

jest.mock("../../database/kv", () => ({
  kv: {
    remove: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    getAllByPrefix: jest.fn().mockResolvedValue([]),
  },
}));

describe("recovery decision logic", () => {
  beforeEach(() => {
    __resetRecoveryState();
    jest.clearAllMocks();
  });

  it("resets only after the failure threshold, and immediate bypasses it", () => {
    const c = "conv1";
    expect(shouldReset(c)).toBe(false);
    for (let i = 0; i < SESSION_RESET_THRESHOLD - 1; i++) noteDecryptFailure(c);
    expect(shouldReset(c)).toBe(false);
    noteDecryptFailure(c); // hits threshold
    expect(shouldReset(c)).toBe(true);
    expect(shouldReset("other", { immediate: true })).toBe(true);
  });

  it("a good decrypt clears the streak", () => {
    const c = "conv2";
    noteDecryptFailure(c);
    noteDecryptFailure(c);
    clearDecryptFailures(c);
    noteDecryptFailure(c);
    expect(shouldReset(c)).toBe(false);
  });

  it("cooldown suppresses back-to-back resets", () => {
    const c = "conv3";
    const now = 1_000_000_000_000;
    const spy = jest.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect(shouldReset(c, { immediate: true })).toBe(true);
      markReset(c);
      expect(shouldReset(c, { immediate: true })).toBe(false); // within cooldown
      spy.mockReturnValue(now + RESET_COOLDOWN_MS + 1);
      expect(shouldReset(c, { immediate: true })).toBe(true); // past cooldown
    } finally {
      spy.mockRestore();
    }
  });

  it("resetConversationRatchet deletes every per-device ratchet state for the conversation", async () => {
    const prefix = "ratchetState_v3_user-1_a:b_";
    (kv.getAllByPrefix as jest.Mock).mockResolvedValueOnce([
      { key: `${prefix}dev-A`, value: "x" },
      { key: `${prefix}dev-B`, value: "y" },
    ]);
    await resetConversationRatchet("user-1", "a:b");
    expect(kv.getAllByPrefix).toHaveBeenCalledWith(prefix);
    expect(kv.remove).toHaveBeenCalledWith(`${prefix}dev-A`);
    expect(kv.remove).toHaveBeenCalledWith(`${prefix}dev-B`);
  });

  it("cooldown persists across a reload via hydrateCooldown", async () => {
    const c = "conv-persist";
    const now = 2_000_000_000_000;
    const spy = jest.spyOn(Date, "now").mockReturnValue(now);
    try {
      markReset(c);
      expect(kv.set).toHaveBeenCalledWith(`reset_cooldown_${c}`, String(now));

      // Simulate a reload: in-memory state gone, but KV still holds the timestamp.
      __resetRecoveryState();
      (kv.get as jest.Mock).mockResolvedValueOnce(String(now));
      await hydrateCooldown(c);

      expect(shouldReset(c, { immediate: true })).toBe(false); // still cooling down
      spy.mockReturnValue(now + RESET_COOLDOWN_MS + 1);
      expect(shouldReset(c, { immediate: true })).toBe(true); // past cooldown
    } finally {
      spy.mockRestore();
    }
  });
});
