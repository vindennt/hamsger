export const toHex = (str: string): string => str; // In mock, we just pass strings

const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

// X255219
// TODO: make this have actaul initial x3dh

export class KeyPair {
  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly label: string;

  constructor(label: string = "unnamed", overrideCore?: string) {
    this.label = label;
    const core = overrideCore || Math.random().toString(36).substring(2, 10);
    this.privateKey = `priv_${core}`;
    this.publicKey = `pub_${core}`;
  }

  /** Commutative mock DH: dh(privA, pubB) == dh(privB, pubA) */
  public dh(peerPublicKey: string): string {
    const peerCore = peerPublicKey.replace("pub_", "");
    const myCore = this.privateKey.replace("priv_", "");
    const sorted = [myCore, peerCore].sort();
    return `dh_${sorted[0]}_${sorted[1]}`;
  }

  public getPublicBytes(): string {
    return this.publicKey;
  }

  public shortId(): string {
    return this.publicKey.substring(0, 16) + "...";
  }
}

// TODO: Actual Ed25519

export class SigningKeyPair {
  public readonly privateKey: string;
  public readonly publicKey: string;

  constructor() {
    this.privateKey = `sign_priv_${Math.random().toString(36).substring(2, 10)}`;
    this.publicKey = `sign_pub_${this.privateKey}`;
  }

  public sign(data: string): string {
    return `sig_${hashString(data)}_${this.privateKey}`;
  }

  public verify(data: string, signature: string): boolean {
    const expectedPrefix = `sig_${hashString(data)}_`;
    // Extract the signer's private key from the mock signature
    const signerPriv = signature.replace(expectedPrefix, "");
    const expectedPub = `sign_pub_${signerPriv}`;
    return this.publicKey === expectedPub;
  }
}

// SPK generation mock
// TODO: actual SPK on the web if necessary

export interface SPKBundle {
  spkPair: KeyPair;
  signature: string;
}

// X3DH

export const X3DH = {
  deriveSessionKey(
    dh1: string,
    dh2: string,
    dh3: string,
    salt: string,
    info: string,
  ): string {
    const ikm = `F|${dh1}|${dh2}|${dh3}`;
    return `hkdf_${hashString(ikm + salt + info)}`;
  },

  encrypt(
    key: string,
    plaintext: string,
  ): { ciphertext: string; iv: string; authTag: string } {
    const iv = `iv_${Math.random().toString(36).substring(2, 8)}`;
    // Simple XOR-like mock cipher representation
    const b64 = btoa(encodeURIComponent(plaintext));
    const ciphertext = `enc_${b64}_with_${key}`;
    const authTag = `tag_${hashString(ciphertext + key)}`;
    return { ciphertext, iv, authTag };
  },

  decrypt(
    key: string,
    ciphertext: string,
    ivHex: string,
    authTagHex: string,
  ): string {
    const expectedTag = `tag_${hashString(ciphertext + key)}`;
    if (authTagHex !== expectedTag) {
      throw new Error("Invalid auth tag - decryption failed");
    }
    const prefix = "enc_";
    const suffix = `_with_${key}`;
    if (!ciphertext.startsWith(prefix) || !ciphertext.endsWith(suffix)) {
      throw new Error("Invalid ciphertext format or wrong key");
    }
    const b64Plaintext = ciphertext.substring(
      prefix.length,
      ciphertext.length - suffix.length,
    );
    return decodeURIComponent(atob(b64Plaintext));
  },
};
