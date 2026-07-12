// X3DH / PBKDF2 / Argon2 rely on Web Crypto `subtle`. Under jest's node/jsdom env it
// may be absent; expose Node's webcrypto (Node >= 20).
const { webcrypto } = require("crypto");
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
