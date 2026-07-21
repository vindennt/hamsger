import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Use expo crypto only for RN
let ExpoCrypto: any;
try {
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    ExpoCrypto = require("expo-crypto");
  }
} catch (e) {
  // Ignore fallback error under non-RN environments
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Dynamically resolve Web Crypto Subtle to prevent mobile bundle issues
let subtle: any;
if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
  subtle = globalThis.crypto.subtle;
} else if (
  typeof navigator !== "undefined" &&
  navigator.product === "ReactNative"
) {
  try {
    const ExpoCryptoModule = require("expo-crypto");
    if (globalThis.crypto?.subtle) {
      subtle = globalThis.crypto.subtle;
    } else {
      subtle = ExpoCryptoModule.subtle || (globalThis as any).crypto?.subtle;
    }
  } catch (e) {
    console.warn("Failed to load expo-crypto subtle polyfill:", e);
  }
}

if (!subtle) {
  try {
    const nodeCrypto = Function("return require('crypto')")();
    subtle = nodeCrypto.webcrypto?.subtle;
  } catch (e) {
    console.warn(
      "Web Crypto Subtle not found, using global or mobile native fallback",
    );
  }
}

function getRandomValues(array: Uint8Array): Uint8Array {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(array);
  }
  // Node.js fallback
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    try {
      const nodeCrypto = Function("return require('crypto')")();
      const bytes = nodeCrypto.randomBytes(array.length);
      array.set(bytes);
      return array;
    } catch (e) {}
  }
  // React Native Expo fallback
  if (ExpoCrypto && ExpoCrypto.getRandomBytes) {
    const randomBytes = ExpoCrypto.getRandomBytes(array.length);
    array.set(randomBytes);
    return array;
  }
  throw new Error(
    "Secure random number generator not found in this environment",
  );
}

//  KeyPair (X25519)

export class KeyPair {
  public readonly privateKey: string; // hex
  public readonly publicKey: string; // hex
  public readonly label: string;

  constructor(label: string = "unnamed", overridePrivateKeyHex?: string) {
    this.label = label;
    if (overridePrivateKeyHex) {
      let privBytes: Uint8Array;
      if (/^[0-9a-fA-F]{64}$/.test(overridePrivateKeyHex)) {
        privBytes = fromHex(overridePrivateKeyHex);
      } else {
        privBytes = sha256(new TextEncoder().encode(overridePrivateKeyHex));
      }
      this.privateKey = toHex(privBytes);
      this.publicKey = toHex(x25519.getPublicKey(privBytes));
    } else {
      const privBytes = getRandomValues(new Uint8Array(32));
      this.privateKey = toHex(privBytes);
      this.publicKey = toHex(x25519.getPublicKey(privBytes));
    }
  }

  /** Real X25519 Diffie-Hellman: getSharedSecret(privA, pubB) == getSharedSecret(privB, pubA) */
  public dh(peerPublicKey: string): string {
    const myPriv = fromHex(this.privateKey);
    const peerPub = fromHex(peerPublicKey);
    const shared = x25519.getSharedSecret(myPriv, peerPub);
    return toHex(shared);
  }

  public getPublicBytes(): string {
    return this.publicKey;
  }

  public shortId(): string {
    return this.publicKey.substring(0, 16) + "...";
  }
}

//  SigningKeyPair (Ed25519)

export class SigningKeyPair {
  public readonly privateKey: string; // hex
  public readonly publicKey: string; // hex

  constructor(overridePrivateKeyHex?: string) {
    if (overridePrivateKeyHex) {
      let privBytes: Uint8Array;
      if (/^[0-9a-fA-F]{64}$/.test(overridePrivateKeyHex)) {
        privBytes = fromHex(overridePrivateKeyHex);
      } else {
        privBytes = sha256(new TextEncoder().encode(overridePrivateKeyHex));
      }
      this.privateKey = toHex(privBytes);
      this.publicKey = toHex(ed25519.getPublicKey(privBytes));
    } else {
      const privBytes = getRandomValues(new Uint8Array(32));
      this.privateKey = toHex(privBytes);
      this.publicKey = toHex(ed25519.getPublicKey(privBytes));
    }
  }

  public sign(data: string | Uint8Array): string {
    const dataBytes = typeof data === "string" ? encoder.encode(data) : data;
    const sigBytes = ed25519.sign(dataBytes, fromHex(this.privateKey));
    return toHex(sigBytes);
  }

  public verify(data: string | Uint8Array, signature: string): boolean {
    const dataBytes = typeof data === "string" ? encoder.encode(data) : data;
    try {
      return ed25519.verify(
        fromHex(signature),
        dataBytes,
        fromHex(this.publicKey),
      );
    } catch {
      return false;
    }
  }
}

//  SPK Bundle

export interface SPKBundle {
  spkPair: KeyPair;
  signature: string;
}

/**
 * Verifies an Ed25519 signature over a signed prekey using the publisher's
 * public verify key. The signature is produced by SigningKeyPair.sign over the
 * SPK public key hex string, so we encode the same string here.
 */
export function verifySignedPrekey(
  signingPublicKeyHex: string,
  signedPrekeyHex: string,
  signatureHex: string,
): boolean {
  try {
    return ed25519.verify(
      fromHex(signatureHex),
      encoder.encode(signedPrekeyHex),
      fromHex(signingPublicKeyHex),
    );
  } catch {
    return false;
  }
}

// X3DH Core

export const X3DH = {
  deriveSessionKey(
    dh1: string,
    dh2: string,
    dh3: string,
    saltHex: string,
    info: string,
  ): string {
    const dh1Bytes = fromHex(dh1);
    const dh2Bytes = fromHex(dh2);
    const dh3Bytes = fromHex(dh3);

    // Concatenate DH inputs (IKM)
    const ikm = new Uint8Array(
      dh1Bytes.length + dh2Bytes.length + dh3Bytes.length,
    );
    ikm.set(dh1Bytes, 0);
    ikm.set(dh2Bytes, dh1Bytes.length);
    ikm.set(dh3Bytes, dh1Bytes.length + dh2Bytes.length);

    const saltBytes = fromHex(saltHex);
    const infoBytes = encoder.encode(info);

    const derived = hkdf(sha256, ikm, saltBytes, infoBytes, 32);
    return toHex(derived);
  },

  async encrypt(
    keyHex: string,
    plaintext: string,
  ): Promise<{ ciphertext: string; iv: string; authTag: string }> {
    const keyBytes = fromHex(keyHex);
    const cryptoKey = await subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    const ivBytes = getRandomValues(new Uint8Array(12));
    const plaintextBytes = encoder.encode(plaintext);

    const encrypted = await subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes },
      cryptoKey,
      plaintextBytes,
    );

    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertextBytes = encryptedBytes.slice(0, -16);
    const authTagBytes = encryptedBytes.slice(-16);

    return {
      ciphertext: toHex(ciphertextBytes),
      iv: toHex(ivBytes),
      authTag: toHex(authTagBytes),
    };
  },

  async decrypt(
    keyHex: string,
    ciphertextHex: string,
    ivHex: string,
    authTagHex: string,
  ): Promise<string> {
    const keyBytes = fromHex(keyHex);
    const ciphertextBytes = fromHex(ciphertextHex);
    const ivBytes = fromHex(ivHex);
    const authTagBytes = fromHex(authTagHex);

    const cryptoKey = await subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    // Reconstruct standard Web Crypto GCM input: ciphertext || tag
    const combinedBytes = new Uint8Array(
      ciphertextBytes.length + authTagBytes.length,
    );
    combinedBytes.set(ciphertextBytes, 0);
    combinedBytes.set(authTagBytes, ciphertextBytes.length);

    const decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      cryptoKey,
      combinedBytes,
    );

    return decoder.decode(decrypted);
  },
};
