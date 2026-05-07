import { KeyPair, X3DH, toHex } from "./x3dh";

// TODO: remove this hardcoded cofnig
// Import JSON statically so bundlers (Metro, Webpack) can resolve it without 'fs'
import cfg from "./config.json";

const SALT = "0000000000000000000000000000000000000000000000000000000000000000";
const ROOT_INFO: string = cfg.root_kdf_info;
const MSG_INFO: string = cfg.msg_kdf_info;
export const MAX_SKIP: number = cfg.max_skip;

// KDFs

export function kdfRootChain(
  rootKey: string,
  dhOutput: string,
): { newRK: string; newCK: string } {
  // Use X3DH's mock derive function to emulate HKDF expanding into 64 bytes
  const combined = X3DH.deriveSessionKey(
    dhOutput,
    rootKey,
    "root",
    SALT,
    ROOT_INFO,
  );
  // Split the output to mock the 32-byte keys
  return {
    newRK: `rk_${combined}`,
    newCK: `ck_${combined}`,
  };
}

export function kdfMsgChain(chainKey: string): {
  nextCK: string;
  messageKey: string;
} {
  const combined = X3DH.deriveSessionKey(
    chainKey,
    "msg",
    "msg",
    SALT,
    MSG_INFO,
  );
  return {
    nextCK: `next_ck_${combined}`,
    messageKey: `mk_${combined}`,
  };
}

// Track States.

export interface RatchetState {
  name: string;
  DHs: KeyPair; // our current DH ratchet key pair
  DHr: string | null; // peer's current DH ratchet public key
  RK: string; // root key
  CKs: string | null; // sending chain key
  CKr: string | null; // receiving chain key
  Ns: number; // messages sent in current chain
  Nr: number; // messages received in current chain
  PN: number; // messages sent in previous sending chain
  skippedKeys: Map<string, string>;
}

export interface MessageHeader {
  DHpub: string; // sender's current ratchet public key
  PN: number; // messages sent in previous chain (for skipped key recovery)
  N: number; // this message's index in the current chain
}

export interface RatchetMessage {
  header: MessageHeader;
  ciphertext: string;
  iv: string;
  authTag: string;
}

// Init

export function initAlice(
  SK: string,
  bobRatchetPub: string,
  overrideDHs?: KeyPair,
): RatchetState {
  const DHs = overrideDHs || new KeyPair("Alice_DHs_0");
  const dhOut = DHs.dh(bobRatchetPub);
  const { newRK, newCK } = kdfRootChain(SK, dhOut);

  return {
    name: "Alice",
    DHs,
    DHr: bobRatchetPub,
    RK: newRK,
    CKs: newCK,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: new Map(),
  };
}

export function initBob(SK: string, bobRatchetKP: KeyPair): RatchetState {
  return {
    name: "Bob",
    DHs: bobRatchetKP,
    DHr: null,
    RK: SK,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: new Map(),
  };
}

// Encryption

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
  log: (msg: string) => void,
): RatchetMessage {
  if (!state.CKs) throw new Error(`${state.name}: no sending chain key`);

  const { nextCK, messageKey } = kdfMsgChain(state.CKs);

  log(
    `  [${state.name}] MSG-CHAIN step Ns=${state.Ns}: MK=${toHex(messageKey).substring(0, 16)}...`,
  );

  state.CKs = nextCK;

  const header: MessageHeader = {
    DHpub: state.DHs.publicKey,
    PN: state.PN,
    N: state.Ns,
  };

  state.Ns += 1;

  const { ciphertext, iv, authTag } = X3DH.encrypt(messageKey, plaintext);
  return { header, ciphertext, iv, authTag };
}

// Decryption

export function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage,
  log: (msg: string) => void,
): string {
  const { header, ciphertext, iv, authTag } = message;
  const dhHex = toHex(header.DHpub);

  const skipKey = `${dhHex}:${header.N}`;
  if (state.skippedKeys.has(skipKey)) {
    const mk = state.skippedKeys.get(skipKey)!;
    state.skippedKeys.delete(skipKey);
    log(`  [${state.name}] Used skipped MK for N=${header.N}`);
    return X3DH.decrypt(mk, ciphertext, iv, authTag);
  }

  const currentDHrHex = state.DHr ? toHex(state.DHr) : null;
  const isNewDH = dhHex !== currentDHrHex;

  if (isNewDH) {
    skipMessageKeys(state, header.PN, dhHex, log);

    log(`\n  [${state.name}] 🔄 DH-RATCHET — peer has a new DH key`);

    state.PN = state.Ns;
    state.Ns = 0;
    state.Nr = 0;

    const dhOut1 = state.DHs.dh(header.DHpub);
    const { newRK: rk1, newCK: newCKr } = kdfRootChain(state.RK, dhOut1);

    const newDHs = new KeyPair(`${state.name}_DHs_${state.PN}`, rk1);
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
    `  [${state.name}] MSG-CHAIN step Nr=${state.Nr}: MK=${toHex(messageKey).substring(0, 16)}...`,
  );

  state.CKr = nextCK;
  state.Nr += 1;

  return X3DH.decrypt(messageKey, ciphertext, iv, authTag);
}

// Message Skipping (Out of order)

function skipMessageKeys(
  state: RatchetState,
  until: number,
  dhHex: string,
  log: (msg: string) => void,
): void {
  if (!state.CKr) return;
  if (until - state.Nr > MAX_SKIP) {
    throw new Error(`${state.name}: too many skipped messages (>${MAX_SKIP})`);
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
