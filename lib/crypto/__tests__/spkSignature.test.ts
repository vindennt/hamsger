// Pure crypto: no supabase/kv, so no mocks needed.
import { KeyPair, SigningKeyPair, verifySignedPrekey } from "../x3dh";

describe("SPK signature verification", () => {
  it("accepts a signature made by the matching signing key", () => {
    const spk = new KeyPair("SPK");
    const sig = new SigningKeyPair();
    const signature = sig.sign(spk.publicKey);

    expect(verifySignedPrekey(sig.publicKey, spk.publicKey, signature)).toBe(
      true,
    );
  });

  it("rejects a tampered signed prekey", () => {
    const spk = new KeyPair("SPK");
    const attackerSpk = new KeyPair("SPK");
    const sig = new SigningKeyPair();
    const signature = sig.sign(spk.publicKey);

    // Same signature, swapped-in attacker prekey → must fail.
    expect(
      verifySignedPrekey(sig.publicKey, attackerSpk.publicKey, signature),
    ).toBe(false);
  });

  it("rejects a signature verified against the wrong signing key", () => {
    const spk = new KeyPair("SPK");
    const sig = new SigningKeyPair();
    const otherSig = new SigningKeyPair();
    const signature = sig.sign(spk.publicKey);

    expect(
      verifySignedPrekey(otherSig.publicKey, spk.publicKey, signature),
    ).toBe(false);
  });

  it("returns false (no throw) on malformed inputs", () => {
    expect(verifySignedPrekey("zz", "zz", "zz")).toBe(false);
  });
});
