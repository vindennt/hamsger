// Session recovery for a desynced Double Ratchet.
//
// Because createSession is deterministic (SK + Alice's initial DH derived from the
// long-term identity-key ECDH), deleting a conversation's stored ratchet state makes
// getOrCreateRatchetState re-init a fresh session from the shared context. If BOTH
// sides do this, their chains converge again. This module owns the reset primitive
// plus the small bit of bookkeeping that decides WHEN to reset (so we don't reset on
// a single stray failure or loop-reset forever).
import { kv } from "../database/kv";

// Control message put on `message_queue` to tell the peer to reset too (carries no
// ciphertext/secret). Kept in sync with the literal on EncryptedDbMessage.type.
export const SESSION_RESET_TYPE = "session_reset" as const;

// Consecutive failed decrypts before we auto-reset (a stray old-chain straggler
// shouldn't wedge a healthy session). Skip-overflow bypasses this via `immediate`.
export const SESSION_RESET_THRESHOLD = 3;
// Minimum gap between resets on one conversation — stops reset ping-pong/storms.
export const RESET_COOLDOWN_MS = 15_000;

interface RecoveryState {
  failures: number;
  lastResetAt: number;
}

const byConv = new Map<string, RecoveryState>();
const hydrated = new Set<string>();

function entry(convId: string): RecoveryState {
  let s = byConv.get(convId);
  if (!s) {
    s = { failures: 0, lastResetAt: 0 };
    byConv.set(convId, s);
  }
  return s;
}

const cooldownKey = (convId: string) => `reset_cooldown_${convId}`;

/**
 * Load the persisted last-reset time once per conversation so the cooldown
 * carries over a reload
 */
export async function hydrateCooldown(convId: string): Promise<void> {
  if (hydrated.has(convId)) return;
  hydrated.add(convId);
  const stored = await kv.get(cooldownKey(convId));
  const ts = stored ? parseInt(stored, 10) : NaN;
  if (!Number.isNaN(ts)) {
    const s = entry(convId);
    s.lastResetAt = Math.max(s.lastResetAt, ts);
  }
}

/** Count a decrypt failure toward the auto-reset threshold. */
export function noteDecryptFailure(convId: string): void {
  entry(convId).failures += 1;
}

/** A good decrypt means we're in sync — clear the failure streak. */
export function clearDecryptFailures(convId: string): void {
  const s = byConv.get(convId);
  if (s) s.failures = 0;
}

/**
 * Whether a reset is warranted now: threshold reached (or `immediate`, e.g. a
 * skip-overflow), AND we're past the cooldown since the last reset. Pure read —
 * call markReset() when you actually perform the reset.
 */
export function shouldReset(
  convId: string,
  opts?: { immediate?: boolean },
): boolean {
  const s = entry(convId);
  const triggered = opts?.immediate || s.failures >= SESSION_RESET_THRESHOLD;
  if (!triggered) return false;
  return Date.now() - s.lastResetAt >= RESET_COOLDOWN_MS;
}

/** Record that a reset just happened (starts the cooldown, clears the streak). */
export function markReset(convId: string): void {
  const s = entry(convId);
  s.failures = 0;
  s.lastResetAt = Date.now();
  void kv.set(cooldownKey(convId), String(s.lastResetAt)); // persist for reload
}

/**
 * Delete the stored ratchet state so the next ratchet op re-inits from the
 * deterministic session. LOCK-FREE: the caller must already hold
 * withRatchetLock(convId) (the receive path does; the manual path wraps it).
 */
export async function resetConversationRatchet(
  userId: string,
  convId: string,
): Promise<void> {
  await kv.remove(`ratchetState_v3_${userId}_${convId}`);
}

/** Test-only: clear the in-memory recovery bookkeeping. */
export function __resetRecoveryState(): void {
  byConv.clear();
  hydrated.clear();
}
