# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hamsger is an end-to-end encrypted messenger for **iOS and web** (no Android). Messages are encrypted on-device with X3DH key exchange + the Double Ratchet; the server (Supabase) should never see plaintext. Expo Router app running on React Native (iOS) and react-native-web (browser).

## Commands

```bash
npm install
npx expo start          # dev server (or: npm start)
npm run ios             # expo start --ios
npm run web             # expo start --web
npm run lint            # expo lint (eslint)
npx expo export --platform web   # web build → dist/ (Vercel picks up vercel.json)
```

- **No test framework is configured yet** (no `test` script, no jest/vitest). If adding tests, `jest-expo` is the expected preset; the recovery-crypto in `lib/crypto/pinBackup.ts` is the first target.
- Requires `.env.local` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (copy from `.env.local.example`).

## Architecture (the parts that span multiple files)

**Provider/init order** (`app/_layout.tsx`): `AuthProvider` → `DatabaseProvider` → `RootLayoutNav`. `RootLayoutNav` is the auth guard: no session → `/(auth)/sign-in`; session in the auth group → upserts a `profiles` row then `/(tabs)`. Routes are grouped `(auth)` and `(tabs)` under Expo Router. Use `router.replace` for auth navigation and `useAuth()` for auth ops. `RootLayoutNav` also enforces an idle-session policy via `lib/session/sessionExpiry.ts` (records activity, force-expires stale sessions on app foreground / web focus). Supabase auth tokens persist in the Keychain on native and `localStorage` on web (`lib/supabase.ts`, PKCE flow).

**Database is a singleton wired at startup.** `DatabaseProvider` opens `hamsger.db` via `expo-sqlite` (native SQLite / WASM+OPFS on web), runs `migrateDbIfNeeded`, then calls `setKvDb(db)` and `setMessageDb(db)`. `lib/database/kv.ts` and `messageRepository.ts` **throw if used before this wiring**. Schema migrations (`lib/database/schema.ts`) are driven by `PRAGMA user_version` against an ordered `MIGRATIONS` array; to change schema, add a `migrateVNToVN+1` function, append it, and bump `LATEST_VERSION`.

**Crypto layer** (`lib/crypto/`): `x3dh.ts` holds the shared AES-256-GCM primitive (`X3DH.encrypt(keyHex, pt) → {ciphertext, iv, authTag}`, `X3DH.decrypt(...)`) plus X25519/Ed25519 keypairs. `createSession.ts` + `ratchetHelpers.ts` do X3DH session setup; `ratchet.ts` is the Double Ratchet (`ratchetEncrypt`/`ratchetDecrypt`). `onboarding.ts` owns key generation/verification (`verifyUserKeysExist`, `resetUserKeys`) — keep new crypto/onboarding logic here. Private keys live in the SQLite KV store; ratchet state is serialized per conversation.

**At-rest encryption is platform-split** (`lib/crypto/secureStore.ts`): `getMasterKey()` returns a Keychain-backed 32-byte key on **native** (via `expo-secure-store`), so ratchet state and local message plaintext are AES-GCM encrypted at rest. On **web** it returns `null`, so those are currently stored **plaintext** in origin storage (a known security gap being worked on). Anything keyed off `getMasterKey()` inherits this native-vs-web behavior.

**Backup / recovery** (`lib/crypto/pinBackup.ts`): `exportKeyBundle` bundles identity keys + ratchet state + message history; `encryptKeyBundle` double-wraps it under a 6-digit PIN **and** a 12-word BIP-39 mnemonic (both derive a wrapping key via PBKDF2, then encrypt the same random `kBackupHex`), stored as one row in Supabase `encrypted_backups`. Either PIN or mnemonic can restore. Setup UI: `app/(auth)/setup-pin.tsx`; restore UI: `app/(auth)/restore-keys.tsx`.

**Message flow.** Send (`components/ChatScreen/chatActions.ts`): ratchet-encrypt → insert into Supabase `message_queue` (`{sender_id, recipient_id, payload}`) → also store local plaintext + optimistic UI. Receive (`components/ChatScreen/SessionManager.tsx`): `fetchInitialMessages` (drain queue on load) + a realtime `message_queue` INSERT subscription → `decryptAndAddMessage` → `ratchetDecrypt` → write to SQLite + Zustand → **delete the queue row**. So `message_queue` is **ephemeral transport**; the durable stores are local SQLite and the `encrypted_backups` blob.

**Concurrency + trust invariants (easy to break):**
- `withRatchetLock(convId, fn)` in `SessionManager` serializes decrypt per conversation (the ratchet is stateful). Route ratchet operations through it.
- `messageRepo.messageExists(id)` is checked before decrypt to avoid double-advancing the ratchet when a prior queue-delete failed.
- **Never trust `payload.sender` / `payload.conversation_id`** (attacker-controlled). Use the authenticated `sender_id` from the queue row; `conversation_id` is derived via `makeConversationId(userId, sender_id)` = the two UUIDs sorted and joined by `:`.

**State**: a single Zustand store (`lib/store/useChatStore.ts`) holds identities, sessions, and `messagesDB` keyed by `conversationId`.

**Web vs native UI**: platform differences use **`.web.tsx` file splitting**, not `Platform.select` (e.g. `ChatScreen.tsx` vs `ChatScreen.web.tsx`, `styles/index.ts` vs `styles/index.web.ts`). The web chat has a desktop sidebar + main pane at a 768px breakpoint and a mobile drawer. Styling is hardcoded Apple HIG colors (no design-token system yet). Prefer `StyleSheet.create`.

## Supabase / RLS

Tables: `profiles`, `prekey_bundles`, `one_time_prekeys`, `friend_requests`, `contacts`, `message_queue`, `encrypted_backups`. Schema + policies live in `supabase/migrations/`. **RLS is the security boundary** and has previously drifted from the migration files due to hand-editing policies in the dashboard — **do not edit policies in the dashboard; write a migration.** Grants are scoped per role (`anon` has only `SELECT` on `profiles`; `authenticated` gets exactly the verbs each table's policies allow). `message_queue` INSERT is restricted to accepted friends and `auth.uid() = sender_id`.

## Roadmap / planning artifacts

Detailed, prioritized implementation specs (security → reliability → durability → performance → UI) live as self-contained per-item chunks in `docs/impl/` (start at `docs/impl/README.md`). Priority: security and reliability before UI polish.
