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
