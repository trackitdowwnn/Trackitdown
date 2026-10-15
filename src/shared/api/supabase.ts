/**
 * WHAT:  The app's single Supabase client — one connection to our Postgres
 *        database, Auth, Storage, and Edge Functions. The persisted auth
 *        session (access + refresh tokens) is stored in the OS keychain via
 *        expo-secure-store.
 * WHY:   Every feature reads and writes through this client, so auth
 *        persistence and (later) the generated database types are configured in
 *        exactly one place. SAFETY: session tokens are sensitive credentials —
 *        the keychain (Keychain / Keystore) is encrypted at rest, unlike
 *        AsyncStorage's plaintext store (docs/SECURITY_AND_TRUST.md §3/§6).
 * LINKS: Reads EXPO_PUBLIC_SUPABASE_* from .env (see .env.example). Row Level
 *        Security is the real access control — docs/SECURITY_AND_TRUST.md §6.
 *        src/features/auth (the sign-in flow that populates this session).
 */

import 'react-native-url-polyfill/auto';

import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at startup rather than with a confusing network error later.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env and set ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

// Supabase's storage adapter backed by the OS keychain. Supabase's key names
// (sb-<ref>-auth-token) are keychain-safe (alphanumerics + '-').
// CAVEAT: iOS historically rejects SecureStore values over ~2048 bytes. Base
// email-OTP sessions fit; if a provider ever returns an oversized session (many
// custom claims), swap this for an encrypted LargeSecureStore adapter (cipher
// key in SecureStore, ciphertext in AsyncStorage) — tracked in the auth README.
const secureStoreAdapter: SupportedStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Native app: sessions never arrive via a URL fragment (a web concern).
    detectSessionInUrl: false,
  },
});

/**
 * Keeps ONLY the PKCE code verifier, in the keychain, so it survives the app
 * being killed behind the browser; anything else the handshake client would
 * store (its copy of the session) lives in memory and is never persisted —
 * the real session belongs to `supabase` above.
 */
const verifierOnlyStorage = (): SupportedStorage => {
  const memory = new Map<string, string>();
  const persisted = (key: string) => key.endsWith('-code-verifier');
  return {
    getItem: (key) =>
      persisted(key) ? SecureStore.getItemAsync(key) : Promise.resolve(memory.get(key) ?? null),
    setItem: (key, value) => {
      if (persisted(key)) return SecureStore.setItemAsync(key, value);
      memory.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      if (persisted(key)) return SecureStore.deleteItemAsync(key);
      memory.delete(key);
      return Promise.resolve();
    },
  };
};

let handshake: ReturnType<typeof createClient> | null = null;

/**
 * A second client used ONLY to start a web sign-in (Sign in with Apple on
 * Android) and redeem its one-time code — PKCE (2026-10-15, security review).
 *
 * ⚠️ WHY A SECOND CLIENT. The return carries a code only THIS device can
 * redeem (it holds the verifier made when the sign-in started), so a forged
 * `trackitdown://auth-callback` link, an app that intercepts the scheme, or a
 * replayed return can sign nobody in. Switching `supabase` itself to PKCE
 * would change the flow for every sign-in path — the email code included —
 * so the handshake lives here and hands the session to `supabase` with
 * setSession. No auto-refresh, nothing persisted but the verifier: it never
 * holds a session of its own past the hand-over. Created on first use.
 */
export function supabaseOAuthHandshake(): ReturnType<typeof createClient> {
  handshake ??= createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      flowType: 'pkce',
      storage: verifierOnlyStorage(),
      // Its own key: never the main session's.
      storageKey: 'trackitdown-oauth-handshake',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return handshake;
}

/**
 * Drop the handshake client after each code exchange (security review,
 * 2026-10-15). It holds a copy of the session in memory once it has redeemed
 * a code; left alive, a later call could refresh with the same refresh token
 * and get the app's real session revoked. NOT `signOut()` — that would revoke
 * the real session on the server. The verifier stays in the keychain, where
 * the next sign-in replaces it.
 */
export function resetOAuthHandshake(): void {
  handshake = null;
}
