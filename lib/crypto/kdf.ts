// Backup-key derivation. Argon2id (memory-hard) for new backups; PBKDF2 kept as a
// decrypt-only path so pre-Argon2id backups still restore. See docs/impl/p1b-argon2id-backup.md.
//
// Why: the cloud backup is double-wrapped under a 128-bit mnemonic (strong) AND a
// 6-digit PIN (only 10^6 possibilities). A ZK backup is only as strong as its weakest
// wrap, and under PBKDF2-100k the PIN-wrapped key is offline-brute-forceable by anyone
// with DB access. Argon2id raises the per-guess cost with memory hardness.
import { argon2id } from "@noble/hashes/argon2.js";
import { toHex } from "./x3dh";

export type KdfId = "pbkdf2" | "argon2id";
// Domain separation: the PIN wrap and the mnemonic wrap must never share a salt.
export type KdfDomain = "pin" | "mnemonic";

export interface Argon2Params {
  t: number; // time cost (iterations)
  m: number; // memory cost in KiB
  p: number; // parallelism
  dkLen: number; // output length in bytes
}

// Production defaults. m = 64 MiB. Argon2id is intentionally CPU+memory heavy; on
// low-end mobile JS this can be seconds and 64 MiB may be too much — tune on real
// devices. If these ever change, persist them per-payload (kdfParams) so old backups
// stay decryptable.
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  t: 3,
  m: 65536,
  p: 1,
  dkLen: 32,
};

let activeParams: Argon2Params = DEFAULT_ARGON2_PARAMS;

// Test hook: shrink params so unit tests stay fast. NEVER call in production code.
export function __setArgon2ParamsForTests(params: Argon2Params): void {
  activeParams = params;
}
export function __resetArgon2Params(): void {
  activeParams = DEFAULT_ARGON2_PARAMS;
}

const enc = new TextEncoder();
const subtle = globalThis.crypto?.subtle;

export async function deriveWrappingKeyHex(
  secret: string,
  userId: string,
  kdf: KdfId = "argon2id",
  domain: KdfDomain = "pin",
): Promise<string> {
  if (kdf === "argon2id") {
    // Domain-separated salt: `${userId}:pin` vs `${userId}:mnemonic`.
    const salt = enc.encode(`${userId}:${domain}`);
    const out = argon2id(enc.encode(secret), salt, {
      t: activeParams.t,
      m: activeParams.m,
      p: activeParams.p,
      dkLen: activeParams.dkLen,
    });
    return toHex(out);
  }

  // LEGACY PBKDF2 — decrypt-only path for pre-Argon2id backups.
  // Salt MUST stay the bare userId (no domain) to match how old payloads were wrapped.
  if (!subtle) throw new Error("Web Crypto subtle unavailable for PBKDF2");
  const keyMaterial = await subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(userId),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}
