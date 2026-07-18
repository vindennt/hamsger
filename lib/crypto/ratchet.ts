import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { KeyPair, X3DH, fromHex, toHex } from "./x3dh";

import cfg from "./config.json";

const ROOT_INFO: string = cfg.root_kdf_info;
export const MAX_SKIP: number = cfg.max_skip;

// Thrown when a message would require skipping more than MAX_SKIP keys in one chain.
// Typed so the receive path can treat it as a desync signal (→ session recovery)
// instead of a bare error that permanently wedges the conversation.
export class TooManySkippedError extends Error {
  constructor(name: string) {
    super(`${name}: too many skipped messages (>${MAX_SKIP})`);
    this.name = "TooManySkippedError";
  }
}

// KDF fxns

export function kdfRootChain(
  rootKeyHex: string,
  dhOutputHex: string,
): { newRK: string; newCK: string } {
  const rkBytes = fromHex(rootKeyHex);
  const dhBytes = fromHex(dhOutputHex);

  // DH output is IKM, Root Key is HKDF salt
  const derived = hkdf(
    sha256,
    dhBytes,
    rkBytes,
    new TextEncoder().encode(ROOT_INFO),
    64,
  );

  return {
    newRK: toHex(derived.slice(0, 32)),
    newCK: toHex(derived.slice(32, 64)),
  };
}

export function kdfMsgChain(chainKeyHex: string): {
  nextCK: string;
  messageKey: string;
} {
  const ckBytes = fromHex(chainKeyHex);

  // Message Key = HMAC-SHA256(Chain Key, 0x01)
  // Next Chain Key = HMAC-SHA256(Chain Key, 0x02)
  const mkBytes = hmac(sha256, ckBytes, new Uint8Array([1]));
  const nextCkBytes = hmac(sha256, ckBytes, new Uint8Array([2]));

  return {
    nextCK: toHex(nextCkBytes),
    messageKey: toHex(mkBytes),
  };
}

// State management

export interface RatchetState {
  name: string;
  DHs: KeyPair; // Our current DH ratchet key pair
  DHr: string | null; // Peer's current DH ratchet public key (hex)
  RK: string; // Root key (hex)
  CKs: string | null; // Sending chain key (hex)
  CKr: string | null; // Receiving chain key (hex)
  Ns: number; // Messages sent in current chain
  Nr: number; // Messages received in current chain
  PN: number; // Messages sent in previous sending chain
  skippedKeys: Map<string, string>; // Map of the"dhPubHex:index" -> messageKeyHex
}

export interface MessageHeader {
  DHpub: string; // Sender's current ratchet public key (hex)
  PN: number; // Messages sent in previous chain
  N: number; // This message's index in the current chain
}

export interface RatchetMessage {
  header: MessageHeader;
  ciphertext: string;
  iv: string;
  authTag: string;
}

// Init

export function initAlice(
  SKHex: string,
  bobRatchetPubHex: string,
  overrideDHs?: KeyPair,
): RatchetState {
  const DHs = overrideDHs || new KeyPair("Alice_DHs_0");
  const dhOut = DHs.dh(bobRatchetPubHex);
  const { newRK, newCK } = kdfRootChain(SKHex, dhOut);

  return {
    name: "Alice",
    DHs,
    DHr: bobRatchetPubHex,
    RK: newRK,
    CKs: newCK,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: new Map(),
  };
}

export function initBob(
  SKHex: string,
  bobSPK: KeyPair,
  aliceDHsPubHex: string,
): RatchetState {
  const state: RatchetState = {
    name: "Bob",
    DHs: bobSPK,
    DHr: aliceDHsPubHex,
    RK: SKHex,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: new Map(),
  };

  // Perform a preemptive DH ratchet step using Alice's deterministic initial DH public key
  // TODO: Need a cleaner way for te first ratchet, more hidden.
  const dhOut1 = state.DHs.dh(aliceDHsPubHex);
  const { newRK: rk1, newCK: newCKr } = kdfRootChain(state.RK, dhOut1);

  // Derive Bob's sending chain using his new DHs so he can send messages immediately
  const newDHs = new KeyPair(`${state.name}_DHs_${state.PN}`);
  const dhOut2 = newDHs.dh(aliceDHsPubHex);
  const { newRK: rk2, newCK: newCKs } = kdfRootChain(rk1, dhOut2);

  state.RK = rk2;
  state.DHs = newDHs;
  state.CKs = newCKs;
  state.CKr = newCKr;

  return state;
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
  log: (msg: string) => void,
): Promise<RatchetMessage> {
  if (!state.CKs) throw new Error(`${state.name}: no sending chain key`);

  const { nextCK, messageKey } = kdfMsgChain(state.CKs);

  log(
    `  [${state.name}] MSG-CHAIN step Ns=${state.Ns}: MK=${messageKey.substring(0, 16)}...`,
  );

  state.CKs = nextCK;

  const header: MessageHeader = {
    DHpub: state.DHs.publicKey,
    PN: state.PN,
    N: state.Ns,
  };

  state.Ns += 1;

  const { ciphertext, iv, authTag } = await X3DH.encrypt(messageKey, plaintext);
  return { header, ciphertext, iv, authTag };
}

// decryption

export async function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage,
  log: (msg: string) => void,
): Promise<string> {
  const { header, ciphertext, iv, authTag } = message;
  const dhHex = header.DHpub;

  const skipKey = `${dhHex}:${header.N}`;
  if (state.skippedKeys.has(skipKey)) {
    const mk = state.skippedKeys.get(skipKey)!;
    state.skippedKeys.delete(skipKey);
    log(`  [${state.name}] Used skipped MK for N=${header.N}`);
    return await X3DH.decrypt(mk, ciphertext, iv, authTag);
  }

  const currentDHrHex = state.DHr;
  const isNewDH = dhHex !== currentDHrHex;

  if (isNewDH) {
    skipMessageKeys(state, header.PN, dhHex, log);

    log(`\n  [${state.name}] 🔄 DH-RATCHET — peer has a new DH key`);

    state.PN = state.Ns;
    state.Ns = 0;
    state.Nr = 0;

    const dhOut1 = state.DHs.dh(header.DHpub);
    const { newRK: rk1, newCK: newCKr } = kdfRootChain(state.RK, dhOut1);

    const newDHs = new KeyPair(`${state.name}_DHs_${state.PN}`);
    const dhOut2 = newDHs.dh(header.DHpub);
    const { newRK: rk2, newCK: newCKs } = kdfRootChain(rk1, dhOut2);

    state.RK = rk2;
    state.DHr = header.DHpub;
    state.DHs = newDHs;
    state.CKs = newCKs;
    state.CKr = newCKr;
  } else {
    skipMessageKeys(state, header.N, dhHex, log);
  }

  const { nextCK, messageKey } = kdfMsgChain(state.CKr!);
  log(
    `  [${state.name}] MSG-CHAIN step Nr=${state.Nr}: MK=${messageKey.substring(0, 16)}...`,
  );

  state.CKr = nextCK;
  state.Nr += 1;

  return await X3DH.decrypt(messageKey, ciphertext, iv, authTag);
}

// Desync helpers

function skipMessageKeys(
  state: RatchetState,
  until: number,
  dhHex: string,
  log: (msg: string) => void,
): void {
  if (!state.CKr) return;
  if (until - state.Nr > MAX_SKIP) {
    throw new TooManySkippedError(state.name);
  }
  while (state.Nr < until) {
    const { nextCK, messageKey } = kdfMsgChain(state.CKr);
    const key = `${dhHex}:${state.Nr}`;
    state.skippedKeys.set(key, messageKey);
    log(`  [${state.name}] 📦 Stored skipped MK for N=${state.Nr}`);
    state.CKr = nextCK;
    state.Nr += 1;
  }
}

export function serializeRatchetState(state: RatchetState): any {
  return {
    name: state.name,
    DHs: {
      label: state.DHs.label,
      privateKey: state.DHs.privateKey,
      publicKey: state.DHs.publicKey,
    },
    DHr: state.DHr,
    RK: state.RK,
    CKs: state.CKs,
    CKr: state.CKr,
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    skippedKeys: Array.from(state.skippedKeys.entries()),
  };
}

export function deserializeRatchetState(serialized: any): RatchetState {
  return {
    name: serialized.name,
    DHs: new KeyPair(serialized.DHs.label, serialized.DHs.privateKey),
    DHr: serialized.DHr,
    RK: serialized.RK,
    CKs: serialized.CKs,
    CKr: serialized.CKr,
    Ns: serialized.Ns,
    Nr: serialized.Nr,
    PN: serialized.PN,
    skippedKeys: new Map(serialized.skippedKeys),
  };
}
