import { kv } from "../database/kv";
import { clearLocalKeyMaterial } from "../crypto/onboarding";
import { supabase } from "../supabase";

const LAST_ACTIVE_KEY = "last_active";
export const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function recordActivity(): Promise<void> {
  await kv.set(LAST_ACTIVE_KEY, Date.now().toString());
}

export async function isSessionExpired(): Promise<boolean> {
  const raw = await kv.get(LAST_ACTIVE_KEY);
  if (!raw) return false;
  const lastActive = parseInt(raw, 10);
  if (isNaN(lastActive)) return false;
  return Date.now() - lastActive > SESSION_EXPIRY_MS;
}

export async function forceExpireSession(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await clearLocalKeyMaterial(user.id);
  await supabase.auth.signOut();
  await kv.remove(LAST_ACTIVE_KEY);
}

