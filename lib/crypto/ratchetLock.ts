/**
 * Per-conversation serialization for ratchet operations.
 *
 * The Double Ratchet is stateful: every encrypt/decrypt mutates the chain and
 * advances the message counter `n`. Concurrent operations on the SAME
 * conversation must run one at a time or state gets clobbered and messages go
 * out of sequence. This is a module-level lock (not component-local) so BOTH
 * the send path (chatActions) and the receive path (SessionManager) share it —
 * a send can't race a decrypt on the same conversation.
 *
 * Different conversations run in parallel (keyed by convId).
 */
const locks = new Map<string, Promise<void>>();

export function withRatchetLock<T>(
  convId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(convId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(convId, gate);
  // prev is a gate promise that only ever resolves (release runs in finally),
  // so the chain never rejects and never deadlocks.
  return prev.then(fn).finally(release);
}
