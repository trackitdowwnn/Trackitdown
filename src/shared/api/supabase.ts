/**
 * WHAT:  The app's single Supabase client — one connection to our Postgres
 *        database, Auth, Storage, and Edge Functions.
 * WHY:   Every feature reads and writes through this client, so auth
 *        persistence and (later) the generated database types are
 *        configured in exactly one place.
 * LINKS: Reads EXPO_PUBLIC_SUPABASE_* from .env (see .env.example). Row
 *        Level Security is the real access control — docs/SECURITY_AND_TRUST.md §6.
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at startup rather than with a confusing network error later.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env and set ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

// TODO(oliver): the anon key is safe to ship, but the persisted auth session
// (access + refresh tokens) currently lives in AsyncStorage. Evaluate moving
// it to expo-secure-store before handling live payments. See
// docs/SECURITY_AND_TRUST.md.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native app: sessions never arrive via a URL fragment (a web concern).
    detectSessionInUrl: false,
  },
});
