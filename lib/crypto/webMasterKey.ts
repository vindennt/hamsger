// WEB ONLY. Gives web a device-bound master key at parity with native's Keychain, so
// ratchet state + local message plaintext get AES-GCM encrypted at rest instead of
// stored plaintext. See docs/impl/p1a-web-at-rest.md.
//
// A non-extractable AES-GCM CryptoKey lives in IndexedDB (its raw bytes are never
// JS-readable) and wraps a random 32-byte masterKeyHex, which downstream code uses with
// the existing hex-keyed aesEncrypt/aesDecrypt (mirrors native getMasterKey()'s hex API).
//
// THREAT MODEL (be honest): this defeats at-rest/offline reads + key exfiltration — the
// raw key bytes never sit in readable storage and can't be copied out to attack
// elsewhere. It does NOT stop LIVE XSS: script running in the origin can still USE the
// key in-place to decrypt. That residual risk is mitigated by XSS/CSP hardening
// separately (see P1e), not here. Still a large net improvement (plaintext → attacker
// must run in-origin).

const DB_NAME = "hamsger_secure";
const STORE = "keys";
const WRAP_KEY_ID = "master_wrap_key_v1"; // non-extractable CryptoKey
const WRAPPED_HEX_ID = "master_key_wrapped_v1"; // { iv, ct }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(WRAP_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    /* extractable */ false, // raw bytes never leave IndexedDB
    ["encrypt", "decrypt"],
  );
  await idbSet(WRAP_KEY_ID, key); // structured-clone persists a non-extractable key
  return key;
}

/**
 * Returns the web device master key (hex), minting + persisting it on first call.
 * Mirrors native getMasterKey()'s hex contract so aesEncrypt/aesDecrypt work unchanged.
 */
export async function getWebMasterKeyHex(): Promise<string> {
  const wrapKey = await getOrCreateWrapKey();

  const wrapped = await idbGet<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }>(
    WRAPPED_HEX_ID,
  );
  if (wrapped) {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrapped.iv },
      wrapKey,
      wrapped.ct,
    );
    return new TextDecoder().decode(pt);
  }

  // First run: random 32-byte master key, stored wrapped by the non-extractable key.
  const masterKeyHex = toHex(crypto.getRandomValues(new Uint8Array(32)));
  // Back the IV with a concrete ArrayBuffer so it satisfies BufferSource under the
  // stricter DOM lib types (a bare Uint8Array is ArrayBufferLike, which SubtleCrypto
  // rejects).
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    new TextEncoder().encode(masterKeyHex),
  );
  await idbSet(WRAPPED_HEX_ID, { iv, ct });
  return masterKeyHex;
}
