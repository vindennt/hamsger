// kv is mocked so resetConversationRatchet's delete is observable without a real DB.
// The crypto (createSession/ratchet) runs for real to prove the convergence property.
// jest.mock is hoisted above these imports by babel-jest, so `kv` resolves to the mock.
import { kv } from "../../database/kv";
import { createSession } from "../createSession";
import { ratchetDecrypt, ratchetEncrypt } from "../ratchet";
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
import { KeyPair } from "../x3dh";

jest.mock("../../database/kv", () => ({
  kv: {
    remove: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

const noop = () => {};

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

  it("resetConversationRatchet deletes the conversation's ratchet state row", async () => {
    await resetConversationRatchet("user-1", "a:b");
    expect(kv.remove).toHaveBeenCalledWith("ratchetState_v3_user-1_a:b");
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

describe("deterministic reset converges a desynced conversation", () => {
  it("diverged decrypt fails, but re-init on both sides heals it", async () => {
    const aIK = new KeyPair("IK");
    const bIK = new KeyPair("IK");
    const alice = { name: "alice", uuid: "a", publicKey: aIK.publicKey };
    const bob = { name: "bob", uuid: "b", publicKey: bIK.publicKey };
    const build = () => {
      const s = createSession(alice, bob, aIK.privateKey, bIK.privateKey);
      return { a: s.initiatorState!, b: s.responderState! };
    };

    // Advance Alice past a DH-ratchet step (Bob replies, Alice receives).
    const s1 = build();
    await ratchetDecrypt(s1.b, await ratchetEncrypt(s1.a, "a0", noop), noop);
    await ratchetDecrypt(s1.a, await ratchetEncrypt(s1.b, "b0", noop), noop);

    // A message from advanced Alice can't be read by a fresh (rewound) Bob.
    const advanced = await ratchetEncrypt(s1.a, "a1", noop);
    await expect(ratchetDecrypt(build().b, advanced, noop)).rejects.toThrow();

    // Reset BOTH → fresh deterministic session → a new message decrypts.
    const s2 = build();
    const healed = await ratchetEncrypt(s2.a, "healed", noop);
    expect(await ratchetDecrypt(s2.b, healed, noop)).toBe("healed");
  });
});
