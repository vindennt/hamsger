-- 20240101000008_prekey_signing_key.sql
-- Publish the Ed25519 verification key alongside each prekey bundle.
--
-- prekey_bundles stored `spk_signature` (Ed25519 signature over the signed
-- prekey) but never the public verify key, so the "signed" prekey was in fact
-- unverifiable: an initiator had nothing to check the signature against. This
-- adds `signing_key` (the Ed25519 public key) so the initiator can verify
-- `verify(signed_prekey, spk_signature)` before starting an X3DH handshake and
-- reject a tampered bundle.
--
-- Nullable only so the ALTER succeeds against existing rows. Pre-1.0: there is
-- no backfill path, so any bundle without signing_key is treated as unusable by
-- the client (strict verify) until that account re-onboards. No new
-- grants/policies: prekey_bundles is already world-readable and owner-writable.

alter table public.prekey_bundles
  add column if not exists signing_key text;
