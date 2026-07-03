# hamsger

End-to-end encrypted messaging for iOS and web. Messages are encrypted on-device using X3DH key exchange and the Double Ratchet algorithm. Server should never see plaintext.

## How it works

- **X3DH** establishes a shared secret between two users without a key negotiation round trip
- **Double Ratchet** derives a new encryption key for every message, so compromising one message doesn't expose others
- **Keys never leave the device unencrypted.** A PIN-derived key wraps the key bundle before it's stored in the cloud. A 12-word BIP-39 recovery phrase provides a second decryption path if the PIN is lost.

## Stack

- Expo Router (iOS + web)
- Supabase (auth, realtime message queue, encrypted key backup)
- SQLite via expo-sqlite (local message store, encrypted at rest on native)

## Running locally

```bash
npm install
npx expo start
```

Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL and anon key.

## Deploying

```bash
npx expo export --platform web   # output goes to dist/
```

Vercel picks up `vercel.json` automatically on push.
